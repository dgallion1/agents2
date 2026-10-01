#!/usr/bin/env python3
"""Helpers for swarm/codex-check.sh (run CD, task CD1, attempt 4).

Every subcommand prints exactly one result line on stdout:
    ok[<TAB>value]
    skip<TAB><reason><TAB><code>[<TAB><tree-relative path>]
and exits 0 whenever it handled its input; a crash (traceback, non-zero exit)
is a harness bug that the caller turns into a `container-error` skip. A skip
carries a CODE, never text: the caller owns the table of fixed DETAIL sentences
(SPEC ruling CD-n) — nothing Codex wrote and no host path can reach a DETAIL. The
one thing a skip may add is a single tree-relative path, and only if safe_path()
accepts it: plain segments of [A-Za-z0-9._-] joined by single slashes (no leading
or trailing slash, no empty segment), no `.` or `..` segment, at most 200 bytes,
and no secret — so an absolute or escaping manifest path can never reach a DETAIL.

  copy      data-free copy of a git work tree + fingerprint re-check in the copy
  auth      login freshness gate + the auth secrets (JSON list, on stdout only)
  classify  quota / auth / codex-error from stderr + error events
  tools     did Codex report that it could not run commands?
  verdict   check last.json (secret, size, schema) and render the verdict file
  keep      keep-or-drop: copy the private output into the audit dir — nothing
            Codex wrote is ever redacted; a file holding a secret is dropped

The auth secrets never touch a disk: `auth` prints them, the caller keeps them
in memory and hands them to later commands ONLY in the CD_SECRETS environment
of the python process that needs them (never as an argument of any program);
commands may also read the live auth file (`--auth FILE`).
"""
import base64
import datetime
import fnmatch
import hashlib
import json
import os
import posixpath
import re
import shutil
import stat
import subprocess
import sys
import time

SIDECAR_LINE = re.compile(r'^([0-9a-f]{64}|deleted) [ *](.+)$')   # the gate's grammar
SEGMENTS_NEVER = ('.codex', '.claude', '.agents')
MAX_LAST_JSON = 4 * 1024 * 1024
MAX_KEEP_FILE = 1024 * 1024
MAX_KEEP_LOG = 16 * 1024 * 1024
MAX_KEEP_ENTRIES = 64
KEEP_NAME = re.compile(r'[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}')       # fullmatch; no leading dot
SAFE_PATH = re.compile(r'[A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)*')    # fullmatch: no leading/trailing/empty segment
SAFE_PATH_MAX = 200                                                 # bytes
STALE_DAYS = 7
STALE_MARGIN = 600


def ok(value=None):
    print('ok' if value is None else 'ok\t%s' % value)


def bkey(path):
    return os.fsencode(path)                                  # byte order (LC_ALL=C)


def read_text(path):
    with open(path, 'rb') as fh:
        return os.fsdecode(fh.read())


# --- secrets ------------------------------------------------------------------------
# The secret set is every JSON string VALUE of length >= 20 in the auth file. It is
# read before the container starts, lives in the caller's memory, and reaches these
# commands through the CD_SECRETS environment variable (a JSON list) — never a file.
# `--auth FILE` adds the values of the live file (in case it changed during the run).

def strings_in(obj, out):
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            strings_in(v, out)
    elif isinstance(obj, list):
        for v in obj:
            strings_in(v, out)
    return out


def auth_strings(raw):
    """String values of length >= 20 of an auth file's bytes ([] when it is not JSON)."""
    try:
        doc = json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError, RecursionError):
        return []
    try:
        return [s for s in strings_in(doc, []) if len(s) >= 20]
    except RecursionError:
        return []


_SIMPLE = {b'"': b'"', b'\\': b'\\', b'/': b'/', b'b': b'\x08', b'f': b'\x0c', b'n': b'\n', b'r': b'\r', b't': b'\t'}
_ESC = re.compile(rb'\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})|\\u([0-9a-fA-F]{4})|\\(["\\/bfnrt])')


def _unescape_sub(m):
    if m.group(1):
        hi, lo = int(m.group(1), 16), int(m.group(2), 16)
        return chr(0x10000 + ((hi - 0xD800) << 10) + (lo - 0xDC00)).encode('utf-8')
    if m.group(3):
        return chr(int(m.group(3), 16)).encode('utf-8', 'surrogatepass')
    return _SIMPLE[m.group(4)]


def unescape(data):
    """One pass of JSON-escape decoding over ANY bytes (keys, values, plain text)."""
    return _ESC.sub(_unescape_sub, data)


class SecretSet:
    def __init__(self, secrets):
        self.secrets = sorted({s for s in secrets if len(s) >= 20}, key=len, reverse=True)
        self.forms = []
        for s in self.secrets:
            for enc in ('utf-8', 'utf-16-le', 'utf-16-be'):
                self.forms.append(s.encode(enc, 'surrogatepass'))

    def __bool__(self):
        return bool(self.secrets)

    def _raw(self, data):
        return any(f in data for f in self.forms)

    def contains(self, data):
        """A secret as raw UTF-8, as UTF-16LE/BE, or in the text after decoding JSON
        escapes (repeated until nothing changes, at most 3 passes)."""
        if not self.forms:
            return False
        if self._raw(data):
            return True
        cur = data
        for _ in range(3):
            nxt = unescape(cur)
            if nxt == cur:
                return False
            cur = nxt
            if self._raw(cur):
                return True
        return False


def load_secret_set(auths=()):
    found = []
    env = os.environ.get('CD_SECRETS', '')
    if env:
        try:
            listed = json.loads(env)
            found += [s for s in listed if isinstance(s, str)]
        except ValueError:
            pass
    for path in auths:
        try:
            with open(path, 'rb') as fh:
                found += auth_strings(fh.read())
        except OSError:
            continue
    return SecretSet(found)


def take_auth(args):
    """Split ['--auth', F, ..., rest...] into ([F, ...], rest)."""
    auths, rest, i = [], [], 0
    while i < len(args):
        if args[i] == '--auth' and i + 1 < len(args):
            auths.append(args[i + 1])
            i += 2
        else:
            rest.append(args[i])
            i += 1
    return auths, rest


def safe_path(path, secrets):
    """A tree-relative path fit for a DETAIL, else None. The ONE place every DETAIL path passes through:
    plain segments joined by single slashes (so never absolute, never a trailing or empty segment),
    no `.` or `..` segment, at most 200 bytes, and no secret."""
    if not path or not SAFE_PATH.fullmatch(path):
        return None
    if len(os.fsencode(path)) > SAFE_PATH_MAX or any(seg in ('.', '..') for seg in path.split('/')):
        return None
    return None if secrets.contains(os.fsencode(path)) else path


def skip(reason, code, path=None, secrets=None):
    parts = ['skip', reason, code]
    if path is not None:
        p = safe_path(path, secrets if secrets is not None else load_secret_set())
        if p:
            parts.append(p)
    print('\t'.join(parts))


# --- exclusion rules ----------------------------------------------------------------

def load_policy(path):
    patterns = []
    for line in read_text(path).split('\n'):
        pat = line.strip()
        if not pat or pat.startswith('#'):
            continue
        if pat.startswith('/'):                               # never let an anchored-looking line silently match nothing
            pat = pat.lstrip('/')
        if pat:
            patterns.append(pat)
    return patterns


def builtin_excluded(path):
    segs = path.split('/')
    base = segs[-1]
    if '.git' in segs:                                        # never .git
        return True
    if 'data' in segs:                                        # a directory OR a file named data
        return True
    if base.startswith('.env') or base.endswith('.pem') or base.endswith('.key'):
        return True
    if any(s in SEGMENTS_NEVER or s.startswith('.swarm') for s in segs):
        return True
    return base in ('AGENTS.md', 'AGENTS.override.md')


def policy_excluded(path, patterns):
    segs = path.split('/')
    for pat in patterns:
        if pat.endswith('/'):                                 # everything under it
            d = pat.rstrip('/')
            if d and any(fnmatch.fnmatchcase('/'.join(segs[:i]), d) for i in range(1, len(segs))):
                return True
        elif fnmatch.fnmatchcase(path, pat):                  # whole relative path; * crosses /
            return True
    return False


def is_excluded(path, patterns):
    return builtin_excluded(path) or policy_excluded(path, patterns)


# --- copy ---------------------------------------------------------------------------

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def git_env():
    env = dict(os.environ)
    for k in ('GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_PREFIX', 'CD_SECRETS'):
        env.pop(k, None)
    return env


def parents_state(tree, path, cache):
    """'ok' | 'missing' | 'linked': every component above the last must be a real directory."""
    segs = path.split('/')[:-1]
    cur = tree
    for i, seg in enumerate(segs):
        cur = os.path.join(cur, seg)
        key = '/'.join(segs[:i + 1])
        if key not in cache:
            try:
                mode = os.lstat(cur).st_mode
                cache[key] = 'ok' if stat.S_ISDIR(mode) else 'linked'
            except OSError:
                cache[key] = 'missing'
        if cache[key] != 'ok':
            return cache[key]
    return 'ok'


def copy_file(src, dst, mode):
    fd = os.open(src, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as fi:
        if not stat.S_ISREG(os.fstat(fi.fileno()).st_mode):
            raise OSError('not a regular file')
        with open(dst, 'wb') as fo:
            shutil.copyfileobj(fi, fo, 1 << 20)
    os.chmod(dst, mode & 0o777)


def write_list(path, items):
    data = ''.join(p + '\n' for p in sorted(set(items), key=bkey))
    with open(path, 'wb') as fh:
        fh.write(os.fsencode(data))


def cmd_copy(a):
    tree, dest, exclude, manifest, sidecar, files_out, excl_out = a
    sec = load_secret_set()

    def fail(reason, code, path=None):
        skip(reason, code, path, sec)

    tree = os.path.abspath(tree)
    dest = os.path.abspath(dest)
    try:
        r = subprocess.run(['git', '-C', tree, 'rev-parse', '--is-inside-work-tree'],
                           capture_output=True, env=git_env(), timeout=60)
    except (OSError, subprocess.SubprocessError):
        return fail('unsafe-tree', 'gitfail')
    if r.returncode != 0 or r.stdout.strip() != b'true':
        return fail('unsafe-tree', 'notgit')
    r = subprocess.run(['git', '-C', tree, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
                       capture_output=True, env=git_env(), timeout=300)
    if r.returncode != 0:
        return fail('unsafe-tree', 'gitfail')
    patterns = load_policy(exclude)

    cands = sorted({os.fsdecode(b) for b in r.stdout.split(b'\0') if b}, key=bkey)
    regs, links, excluded = [], [], []
    pcache = {}
    for raw in cands:
        p = raw.rstrip('/')
        if not p:
            continue
        if '\n' in p or '\r' in p:
            return fail('unsafe-tree', 'newline')
        dir_entry = raw.endswith('/')
        if is_excluded(p + '/_' if dir_entry else p, patterns):     # decided on the NAME — never read, never followed
            excluded.append(raw)
            continue
        state = parents_state(tree, p, pcache)
        if state == 'missing':
            continue                                                # a tracked path missing on disk is skipped
        if state != 'ok':
            return fail('unsafe-tree', 'linkedparent', p)
        try:
            st = os.lstat(os.path.join(tree, p))
        except OSError:
            continue                                                # a tracked path missing on disk is skipped
        if dir_entry or stat.S_ISDIR(st.st_mode):                   # nested repo / submodule
            excluded.append(p + '/')
        elif stat.S_ISLNK(st.st_mode):
            links.append(p)
        elif stat.S_ISREG(st.st_mode):
            regs.append((p, st.st_mode))
        else:
            excluded.append(p)                                      # fifo, socket, device: never opened

    os.makedirs(dest, exist_ok=True)
    os.chmod(dest, 0o755)
    made = {dest}

    def mkparent(rel):
        d = os.path.dirname(os.path.join(dest, rel))
        missing = []
        while d not in made and not os.path.isdir(d):
            missing.append(d)
            d = os.path.dirname(d)
        for m in reversed(missing):
            os.mkdir(m)
            os.chmod(m, 0o755)
            made.add(m)

    for p, mode in regs:
        mkparent(p)
        try:
            copy_file(os.path.join(tree, p), os.path.join(dest, p), mode)
        except OSError:
            return fail('unsafe-tree', 'cannotcopy', p)
    for p in sorted(links, key=bkey):
        target = os.readlink(os.path.join(tree, p))
        if os.path.isabs(target) or not target:
            return fail('unsafe-tree', 'symlink', p)
        mkparent(p)
        os.symlink(target, os.path.join(dest, p))
    real_tree = os.path.realpath(tree)
    real_dest = os.path.realpath(dest)

    def inside(path, root):
        return path == root or path.startswith(root + os.sep)

    for p in sorted(links, key=bkey):                               # must resolve to a copied regular file, in BOTH places
        real = os.path.realpath(os.path.join(dest, p))              # in the copy: excluded targets dangle
        real_src = os.path.realpath(os.path.join(tree, p))          # in the tree: must not leave it either
        if not (inside(real, real_dest) and inside(real_src, real_tree)
                and os.path.relpath(real, real_dest) == os.path.relpath(real_src, real_tree)):
            return fail('unsafe-tree', 'symlink', p)
        try:
            is_file = stat.S_ISREG(os.stat(real).st_mode)
        except OSError:
            is_file = False
        if not is_file:                                             # dangling, a directory, or an excluded path
            return fail('unsafe-tree', 'symlink', p)

    copied = [p for p, _ in regs] + links
    write_list(files_out, copied)
    write_list(excl_out, excluded)

    # --- fingerprints, re-checked IN THE COPY ---------------------------------------
    side_bytes = open(sidecar, 'rb').read()
    want = {}
    for line in os.fsdecode(side_bytes).split('\n'):
        if not line:
            continue
        m = SIDECAR_LINE.match(line)
        if not m:
            return fail('fingerprint-mismatch', 'sidecar')
        want[m.group(2)] = m.group(1)
    extra = []
    for mpath in read_text(manifest).split('\n'):
        if not mpath:
            continue
        if mpath not in want:
            return fail('fingerprint-mismatch', 'noline', mpath)
        norm = posixpath.normpath(mpath)
        if posixpath.isabs(norm) or norm == '..' or norm.startswith('../') or norm == '.':
            return fail('fingerprint-mismatch', 'badpath')
        if is_excluded(norm, patterns):
            extra.append(norm)                                      # listed, skipped
            continue
        target = os.path.join(dest, norm)
        if want[mpath] == 'deleted':
            if os.path.lexists(target):
                return fail('fingerprint-mismatch', 'deletedexists', mpath)
            continue
        if not os.path.isfile(target):
            return fail('fingerprint-mismatch', 'missing', mpath)
        if sha256_file(target) != want[mpath]:
            return fail('fingerprint-mismatch', 'drift', mpath)
    if extra:
        write_list(excl_out, excluded + extra)
    ok(hashlib.sha256(side_bytes).hexdigest())


# --- login: freshness gate + secrets --------------------------------------------------

_TS = re.compile(r'(\d{4})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?\s*(Z|z|[+-]\d{2}(?::?\d{2})?)?')


def parse_timestamp(text):
    """ISO-8601 -> aware datetime; parsed by hand so it works on any Python >= 3.8
    (a trailing Z and a 9-digit fraction included). None when it does not parse."""
    m = _TS.fullmatch(text.strip())
    if not m:
        return None
    y, mo, d, h, mi, s, frac, tz = m.groups()
    micro = int((frac or '0')[:6].ljust(6, '0'))
    if not tz or tz in ('Z', 'z'):
        offset = datetime.timedelta(0)
    else:
        sign = -1 if tz[0] == '-' else 1
        digits = tz[1:].replace(':', '')
        offset = sign * datetime.timedelta(hours=int(digits[:2]), minutes=int(digits[2:4] or 0))
    try:
        return datetime.datetime(int(y), int(mo), int(d), int(h), int(mi), int(s), micro,
                                 tzinfo=datetime.timezone(offset))
    except (ValueError, OverflowError):
        return None


def jwt_exp(token):
    """The `exp` of a JWT's payload, or None when it is not a JWT with a numeric exp."""
    parts = token.split('.')
    if len(parts) < 2:
        return None
    try:
        payload = parts[1] + '=' * (-len(parts[1]) % 4)
        exp = json.loads(base64.urlsafe_b64decode(payload.encode('ascii')).decode('utf-8')).get('exp')
    except (ValueError, UnicodeError, AttributeError, TypeError):
        return None
    return exp if isinstance(exp, (int, float)) and not isinstance(exp, bool) else None


def cmd_auth(a):                                              # auth <auth-file> <codex-timeout-seconds>
    path, timeout = a[0], int(a[1])
    try:
        with open(path, 'rb') as fh:
            raw = fh.read()
    except OSError:
        return skip('auth', 'unreadable')
    secrets = sorted(set(auth_strings(raw)))
    if not secrets:                                           # a login without secrets cannot work
        return skip('auth', 'nosecret')
    try:
        doc = json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        doc = None
    now = time.time()
    if isinstance(doc, dict):
        last = doc.get('last_refresh')
        if isinstance(last, str):
            when = parse_timestamp(last)
            if when is not None and now - when.timestamp() > STALE_DAYS * 86400:
                return skip('auth', 'stale')
        tokens = doc.get('tokens')
        access = tokens.get('access_token') if isinstance(tokens, dict) else None
        if isinstance(access, str):
            exp = jwt_exp(access)
            if exp is not None and exp < now + timeout + STALE_MARGIN:
                return skip('auth', 'stale')
    ok(json.dumps(secrets))


# --- classification -----------------------------------------------------------------

def read_events(path):
    events = []
    try:
        with open(path, 'rb') as fh:
            for line in fh:
                try:
                    ev = json.loads(line.decode('utf-8'))
                except (ValueError, RecursionError):
                    continue
                if isinstance(ev, dict):
                    events.append(ev)
    except OSError:
        pass
    return events


def message_texts(obj, out):
    """Every string stored under a key named "message" — and nothing else: an id or a
    status field in the same event (a request_id such as req_4291) is not message text."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == 'message' and isinstance(v, str):
                out.append(v)
            else:
                message_texts(v, out)
    elif isinstance(obj, list):
        for v in obj:
            message_texts(v, out)
    return out


def error_texts(events):
    """Message text of `error` and `turn.failed` events only — ordinary events quote repo text."""
    out = []
    for ev in events:
        if ev.get('type') in ('error', 'turn.failed'):
            message_texts(ev, out)
    return out


def tool_error_texts(events):
    """Message text of events whose type is `error` or whose item.type is `error`."""
    out = []
    for ev in events:
        item = ev.get('item')
        if ev.get('type') == 'error' or (isinstance(item, dict) and item.get('type') == 'error'):
            message_texts(ev, out)
    return out


QUOTA = re.compile(r'429|usage limit|rate limit|quota', re.I)
AUTHERR = re.compile(r'401|unauthori[sz]ed|not logged in|log in|refresh token', re.I)
NOTOOLS = re.compile(r'failed to spawn|code mode is unavailable', re.I)


def cmd_classify(a):                                          # classify <events> <stderr-file> -> quota|auth|codex-error
    events, stderr = a
    try:
        err = read_text(stderr)
    except OSError:
        err = ''
    blob = '\n'.join([err] + error_texts(read_events(events)))
    if QUOTA.search(blob):
        ok('quota')
    elif AUTHERR.search(blob):
        ok('auth')
    else:
        ok('codex-error')


def cmd_tools(a):                                             # tools <events>
    hit = any(NOTOOLS.search(t) for t in tool_error_texts(read_events(a[0])))
    ok('unavailable' if hit else 'available')


# --- verdict ------------------------------------------------------------------------

def validate(inst, sch):
    """The JSON-Schema subset verdict.schema.json uses; True when inst conforms."""
    t = sch.get('type')
    if t == 'object':
        if not isinstance(inst, dict):
            return False
        props = sch.get('properties', {})
        if any(k not in inst for k in sch.get('required', [])):
            return False
        if sch.get('additionalProperties') is False and any(k not in props for k in inst):
            return False
        return all(validate(inst[k], sub) for k, sub in props.items() if k in inst)
    if t == 'array':
        if not isinstance(inst, list) or len(inst) < sch.get('minItems', 0):
            return False
        return all(validate(item, sch.get('items', {})) for item in inst)
    if t == 'string':
        return isinstance(inst, str) and ('enum' not in sch or inst in sch['enum'])
    if t == 'boolean':
        return isinstance(inst, bool)
    return True


def indent(text, pad):
    lines = str(text).replace('\r\n', '\n').replace('\r', '\n').split('\n')
    return ('\n' + pad).join(lines)


def one_line(text, limit=200):
    text = re.sub(r'\s+', ' ', str(text)).strip()
    return text if len(text) <= limit else text[:limit - 3] + '...'


def read_regular(path, limit):
    """Bytes of a regular file (never following a link) of at most `limit` bytes.
    Returns (data, why) with why in {None, 'notregular', 'toobig', 'unreadable'}."""
    try:
        st = os.lstat(path)
    except OSError:
        return None, 'unreadable'
    if not stat.S_ISREG(st.st_mode):
        return None, 'notregular'
    if st.st_size > limit:
        return None, 'toobig'
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as fh:
            if not stat.S_ISREG(os.fstat(fh.fileno()).st_mode):
                return None, 'notregular'
            data = fh.read(limit + 1)
    except OSError:
        return None, 'unreadable'
    if len(data) > limit:
        return None, 'toobig'
    return data, None


def cmd_verdict(a):        # verdict <last.json> <schema> <task> <attempt> <sha> <model> <version> <out> [--auth F]...
    auths, rest = take_auth(a)
    last, schema, task, attempt, sha, model, version, out = rest
    sec = load_secret_set(auths)
    # step 7: last.json — never followed, regular, at most 4 MiB; a secret in it -> secret-leak
    data, why = read_regular(last, MAX_LAST_JSON)
    if data is None:
        return skip('schema-invalid', 'lastfile')
    if sec.contains(data):
        return skip('secret-leak', 'answer')
    # step 8: the schema, consistency, evidence
    try:
        doc = json.loads(data.decode('utf-8'))
    except (ValueError, UnicodeDecodeError, RecursionError):
        return skip('schema-invalid', 'json')
    with open(schema, 'rb') as fh:
        if not validate(doc, json.load(fh)):
            return skip('schema-invalid', 'schema')
    passed = [c['pass'] for c in doc['criteria']]
    if (doc['verdict'] == 'PASS' and not all(passed)) or (doc['verdict'] == 'FAIL' and all(passed)):
        return skip('schema-invalid', 'inconsistent')             # the verdict must agree with its own criteria
    if doc['verdict'] == 'PASS':
        for c in doc['criteria']:
            if not c['command'].strip() or not c['result'].strip():
                return skip('evidence-free-pass', 'evidence')
    body = []
    for c in doc['criteria']:
        body.append('criterion %s: %s' % (one_line(c['id']), 'PASS' if c['pass'] else 'FAIL'))
        for key in ('attack', 'command', 'result'):
            body.append('    %s: %s' % (key, indent(c[key], '        ')))
    body.append('observations:')
    for o in doc['observations']:
        body.append('    - %s' % indent(o, '      '))
    head = [('VERDICT', doc['verdict']), ('CHECKER', 'checker-codex'), ('FAMILY', 'crossvendor'),
            ('TASK', task), ('ATTEMPT', attempt), ('MANIFEST_SHA256', sha),
            ('CODEX_MODEL', model), ('CODEX_VERSION', version)]
    text = ''.join('%s: %s\n' % (k, one_line(v)) for k, v in head) + '---\n' + '\n'.join(body) + '\n'
    encoded = text.encode('utf-8', 'replace')
    if sec.contains(encoded):                                     # the rendered file, too, must be secret-free
        return skip('secret-leak', 'rendered')
    with open(out, 'wb') as fh:
        fh.write(encoded)
    ok()


# --- keep or drop ---------------------------------------------------------------------

def write_new(path, data):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o644)
    with os.fdopen(fd, 'wb') as fh:
        fh.write(data)


def cmd_keep(a):                                              # keep <private-out> <events> <proxy.log> <audit-dir> [--auth F]...
    auths, rest = take_auth(a)
    priv, events, proxy, aud = rest
    sec = load_secret_set(auths)
    out_dir = os.path.join(aud, 'out')
    os.makedirs(out_dir, exist_ok=True)
    dropped = []

    def drop(name, why):
        printable = name
        try:
            if not KEEP_NAME.fullmatch(name) or sec.contains(os.fsencode(name)):
                printable = '<unprintable name>'
        except (ValueError, UnicodeError):
            printable = '<unprintable name>'
        dropped.append('%s\t%s' % (printable, why))

    try:
        names = os.listdir(priv)
    except OSError:
        names = []
        drop('out', 'the private output dir could not be listed')
    ordered = ([n for n in names if n == 'last.json'] + sorted((n for n in names if n != 'last.json'), key=bkey))
    kept = 0
    for name in ordered:                                          # depth 1 only: nothing is ever descended into
        if not KEEP_NAME.fullmatch(name):
            drop(name, 'name not allowed')
            continue
        if sec.contains(os.fsencode(name)):
            drop(name, 'name holds a secret')
            continue
        path = os.path.join(priv, name)
        try:
            st = os.lstat(path)
        except OSError:
            drop(name, 'unreadable')
            continue
        if stat.S_ISLNK(st.st_mode):
            drop(name, 'symlink')
            continue
        if stat.S_ISDIR(st.st_mode):
            drop(name, 'directory')
            continue
        if not stat.S_ISREG(st.st_mode):
            drop(name, 'not a regular file')
            continue
        data, why = read_regular(path, MAX_KEEP_FILE)
        if data is None:
            drop(name, {'toobig': 'larger than 1 MiB', 'unreadable': 'unreadable'}.get(why, 'not a regular file'))
            continue
        if sec.contains(data):
            drop(name, 'contains a secret')
            continue
        if kept >= MAX_KEEP_ENTRIES:
            drop(name, 'over the 64-entry limit')
            continue
        try:
            write_new(os.path.join(out_dir, name), data)
        except OSError:
            drop(name, 'could not be copied')
            continue
        kept += 1
    for label, src in (('events.jsonl', events), ('proxy.log', proxy)):
        if not os.path.lexists(src):
            continue
        data, why = read_regular(src, MAX_KEEP_LOG)
        if data is None:
            drop(label, {'toobig': 'larger than 16 MiB', 'unreadable': 'unreadable'}.get(why, 'not a regular file'))
        elif sec.contains(data):
            drop(label, 'contains a secret')
        else:
            try:
                write_new(os.path.join(aud, label), data)
            except OSError:
                drop(label, 'could not be copied')
    with open(os.path.join(aud, 'dropped.txt'), 'wb') as fh:
        fh.write(''.join(line + '\n' for line in dropped).encode('utf-8', 'replace'))
    ok('%d\t%d' % (kept, len(dropped)))


COMMANDS = {'copy': cmd_copy, 'auth': cmd_auth, 'classify': cmd_classify, 'tools': cmd_tools,
            'verdict': cmd_verdict, 'keep': cmd_keep}

if __name__ == '__main__':
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        sys.exit('usage: tools.py {%s} args...' % '|'.join(COMMANDS))
    COMMANDS[sys.argv[1]](sys.argv[2:])
