// parse.mjs — pure reader for the `.swarm/` layout (SPEC.md §2a/§2b).
//
// Contract: `parse(swarmDir)` is synchronous, side-effect free (no HTTP, no
// process.exit, no console output) and returns a plain state object. It must
// never throw on malformed input — malformed lines/files land in
// `state.errors` instead. This module is the trust boundary the rest of the
// dashboard depends on: `derived.state` must never claim `accepted` unless a
// real PASS-quorum exists in the verdict files for the task's *current*
// attempt (the anti-lie property).
//
// Quorum rules mirror `swarm/gate.sh` exactly so the dashboard never
// disagrees with the mechanical gate about what is actually accepted. That
// includes the inline escalation triggers `gate.sh check` recomputes when no
// flag file exists (see "inline escalation triggers" below).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const VALID_VERDICTS = new Set(['PASS', 'FAIL', 'UPHOLD', 'OVERRULE']);
// FAMILY names an independence LANE (gate.sh load_verdict): anthropic /
// adversarial / impact are current; glm and local validate only so
// pre-2026-08-19 verdicts still parse.
const VALID_FAMILIES = new Set(['anthropic', 'adversarial', 'impact', 'glm', 'local']);
const VERDICT_FILENAME_RE = /^(.+)\.(\d+)\.(.+)\.verdict$/;
const REQUIRED_VERDICT_HEADERS = ['VERDICT', 'CHECKER', 'FAMILY', 'TASK', 'ATTEMPT'];

// ---------------------------------------------------------------------------
// small fs helpers (all synchronous, all tolerant of missing files/dirs)
// ---------------------------------------------------------------------------

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function listDirIfExists(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Mirrors bash `[[ -f ... ]]`: a regular file (symlinks followed).
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// Mirrors bash `[[ -e p || -L p ]]`: a directory entry exists at p. A dangling
// symlink or a symlink loop is PRESENT (only lstat can see it); an entry whose
// parent cannot be searched is not.
function entryExists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ledger.tsv
// ---------------------------------------------------------------------------

function parseLedger(swarmDir, errors) {
  const filePath = path.join(swarmDir, 'ledger.tsv');
  const content = readFileIfExists(filePath);
  const rows = [];
  if (content === null) return rows;

  const lines = content.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    if (rawLine === '' || rawLine.startsWith('#')) return;

    const fields = rawLine.split('\t');
    if (fields.length !== 7) {
      errors.push({
        file: 'ledger.tsv',
        message: `line ${lineNo}: expected 7 tab-separated fields, got ${fields.length}`,
      });
      return;
    }

    const [id, tierRaw, checksRaw, status, attemptRaw, worker, reason] = fields;

    if (!/^[123]$/.test(tierRaw)) {
      errors.push({ file: 'ledger.tsv', message: `line ${lineNo}: bad tier '${tierRaw}'` });
      return;
    }
    if (!/^\d+$/.test(attemptRaw)) {
      errors.push({ file: 'ledger.tsv', message: `line ${lineNo}: bad attempt '${attemptRaw}'` });
      return;
    }

    const checks = checksRaw === '-' || checksRaw === '' ? [] : checksRaw.split(',');

    rows.push({
      id,
      tier: Number.parseInt(tierRaw, 10),
      checks,
      status,
      attempt: Number.parseInt(attemptRaw, 10),
      worker,
      reason,
    });
  });

  return rows;
}

// ---------------------------------------------------------------------------
// manifests/<task>.<attempt>.files
// ---------------------------------------------------------------------------

// The CURRENT attempt's manifest must never make parse() throw (CD3): gate.sh
// check_fingerprint tests `[[ -f ]]` first — so an absent file, a dangling
// link, a directory or a FIFO is "no manifest" and is never opened — and a
// regular file it cannot read fails its `grep -q '[^[:space:]]'` step, which
// the gate reports as an empty manifest. Same two outcomes here (null / []).
function parseManifest(swarmDir, taskId, attempt) {
  const filePath = path.join(swarmDir, 'manifests', `${taskId}.${attempt}.files`);
  if (!isFile(filePath)) return null;
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }
  return content
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// manifests/<task>.<attempt>.sha256 — fingerprint sidecar (2026-09-18)
// ---------------------------------------------------------------------------
// sha256sum format: `<64 hex>  <path>` or `deleted  <path>`. Mirrors gate.sh
// check_fingerprint in its `done` mode: evidence consistency only. The
// dashboard never re-hashes the tree — tree currency is a `gate.sh check`
// property, and the dashboard is not told where the tree is.

const FP_LINE = /^([0-9a-f]{64}|deleted) [ *](.+)$/;

// Same rule for the sidecar (CD3): `[[ -f ]]` false -> "no fingerprint
// sidecar" and never opened; a regular file the gate cannot read yields no
// fingerprint lines, so every manifest path is reported as unfingerprinted.
function parseFingerprint(swarmDir, taskId, attempt) {
  const filePath = path.join(swarmDir, 'manifests', `${taskId}.${attempt}.sha256`);
  if (!isFile(filePath)) return null;
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return { sha256: '', entries: new Map(), badLines: [] };
  }
  const entries = new Map();
  const badLines = [];
  for (const line of content.split(/\r?\n/)) {
    if (line.length === 0) continue;
    const m = FP_LINE.exec(line);
    if (!m) { badLines.push(line); continue; }
    entries.set(m[2], m[1]);
  }
  return {
    sha256: createHash('sha256').update(content).digest('hex'),
    entries,
    badLines,
  };
}

// The first fingerprint defect gate.sh would report for an otherwise
// acceptable row, or null. Same order as check_fingerprint. Every PASS that
// reaches here is a checker-* PASS (validateVerdictRecord rejects any other
// pairing), so no PASS can dodge the MANIFEST_SHA256 requirement.
function fingerprintProblem(task, verdicts) {
  const man = `manifests/${task.id}.${task.attempt}.files`;
  const side = `manifests/${task.id}.${task.attempt}.sha256`;
  if (task.manifest === null) return `no manifest at ${man}`;
  if (task.manifest.length === 0) return `manifest ${man} is empty`;
  if (task.fingerprint === null) return `no fingerprint sidecar at ${side}`;
  if (task.fingerprint.badLines.length > 0) {
    return `unparseable fingerprint line in ${side}: '${task.fingerprint.badLines[0]}'`;
  }
  for (const p of task.manifest) {
    if (!task.fingerprint.entries.has(p)) return `manifest path '${p}' has no fingerprint line in ${side}`;
  }
  for (const v of verdicts) {
    if (v.verdict !== 'PASS' || !v.checker.startsWith('checker-')) continue;
    const file = `${task.id}.${task.attempt}.${v.checker}.verdict`;
    if (!v.manifestSha256) return `${file} has no MANIFEST_SHA256 header`;
    if (v.manifestSha256 !== task.fingerprint.sha256) {
      return `${file} verified fingerprint set ${v.manifestSha256} but the sidecar hashes to ${task.fingerprint.sha256}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// verdicts/<task>.<attempt>.<checker>.verdict
// ---------------------------------------------------------------------------

function parseHeaderAndEvidence(content) {
  const lines = content.split('\n');
  let sepIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    // Exact `---` line required (gate.sh uses grep -qx -- '---').
    if (lines[i] === '---') {
      sepIndex = i;
      break;
    }
  }
  const hasSeparator = sepIndex !== -1;
  const headerLines = hasSeparator ? lines.slice(0, sepIndex) : lines;
  const evidence = hasSeparator ? lines.slice(sepIndex + 1).join('\n') : '';

  const headers = {};
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return { headers, evidence, hasSeparator };
}

/**
 * Validate a verdict against SPEC.md §2a + filename/header agreement + the
 * lane-accounting pairing rule (run CD, CD2): PASS/FAIL are valid only from a
 * CHECKER that starts with `checker-`; UPHOLD/OVERRULE only from one that
 * starts with `judge-` or is exactly `boss`. Any other pairing is invalid.
 * Returns { ok: true, verdict } or { ok: false, message }.
 * Mirrors swarm/gate.sh load_verdict().
 */
function validateVerdictRecord(filename, headers, hasSeparator, fileTask, fileAttempt, fileChecker) {
  if (!hasSeparator) {
    return { ok: false, message: `missing '---' separator` };
  }

  for (const key of REQUIRED_VERDICT_HEADERS) {
    if (headers[key] === undefined || headers[key] === '') {
      return { ok: false, message: `missing ${key}` };
    }
  }

  const verdictValue = headers.VERDICT;
  if (!VALID_VERDICTS.has(verdictValue)) {
    return { ok: false, message: `invalid VERDICT value: ${verdictValue}` };
  }

  const family = headers.FAMILY;
  if (!VALID_FAMILIES.has(family)) {
    return { ok: false, message: `invalid FAMILY value: ${family}` };
  }

  if (!/^\d+$/.test(headers.ATTEMPT)) {
    return { ok: false, message: `invalid ATTEMPT value: ${headers.ATTEMPT}` };
  }

  if (headers.CHECKER !== fileChecker) {
    return {
      ok: false,
      message: `CHECKER '${headers.CHECKER}' != filename checker '${fileChecker}'`,
    };
  }
  if (headers.TASK !== fileTask) {
    return {
      ok: false,
      message: `TASK '${headers.TASK}' != filename task '${fileTask}'`,
    };
  }
  if (headers.ATTEMPT !== String(fileAttempt)) {
    return {
      ok: false,
      message: `ATTEMPT '${headers.ATTEMPT}' != filename attempt '${fileAttempt}'`,
    };
  }

  // Lane accounting: exact prefixes (`checker-`, `judge-`, dash included) and
  // the exact name `boss`; anything else (`worker-coder`, `lead`, `boss-2`,
  // `Boss`, a bare `checker`) may cast nothing.
  const castsChecker = verdictValue === 'PASS' || verdictValue === 'FAIL';
  const allowed = castsChecker
    ? headers.CHECKER.startsWith('checker-')
    : headers.CHECKER.startsWith('judge-') || headers.CHECKER === 'boss';
  if (!allowed) {
    return {
      ok: false,
      message:
        `VERDICT ${verdictValue} not allowed from CHECKER '${headers.CHECKER}' ` +
        `(PASS/FAIL come from checker-*; UPHOLD/OVERRULE from judge-* or boss)`,
    };
  }

  return {
    ok: true,
    verdict: {
      checker: headers.CHECKER,
      family,
      verdict: verdictValue,
      task: headers.TASK,
      attempt: fileAttempt,
      // Optional (2026-09-18): the sha256 of the manifest's .sha256 sidecar
      // the checker verified. Required on every PASS (always a checker-* PASS
      // once the pairing rule holds) by fingerprintProblem(); judges never
      // carry it.
      manifestSha256: headers.MANIFEST_SHA256 || null,
    },
  };
}

// Scans the whole verdicts/ dir once. Returns:
//   byTaskAttempt — Map keyed by `${task}.${attempt}` -> array of verdict
//     objects (all belonging to that task+attempt, any checker). Invalid
//     files are excluded from this map and reported in errors[].
//   filenames — every entry in verdicts/, verbatim, so per-task blocking can
//     later mirror gate.sh's glob semantics (see blockingVerdictFiles).
function parseAllVerdicts(swarmDir, errors) {
  const dirPath = path.join(swarmDir, 'verdicts');
  const filenames = listDirIfExists(dirPath);
  const byTaskAttempt = new Map();

  for (const filename of filenames) {
    const match = VERDICT_FILENAME_RE.exec(filename);
    if (!match) {
      if (filename.endsWith('.verdict')) {
        errors.push({
          file: `verdicts/${filename}`,
          message: `unparseable verdict filename`,
        });
      }
      continue;
    }
    const [, task, attemptStr, checker] = match;
    const attempt = Number.parseInt(attemptStr, 10);

    const filePath = path.join(dirPath, filename);
    const content = readFileIfExists(filePath);
    if (content === null) continue; // vanished between readdir and read; ignore

    const { headers, evidence, hasSeparator } = parseHeaderAndEvidence(content);
    const validated = validateVerdictRecord(
      filename,
      headers,
      hasSeparator,
      task,
      attempt,
      checker
    );

    if (!validated.ok) {
      errors.push({
        file: `verdicts/${filename}`,
        message: validated.message,
      });
      continue; // excluded entirely from quorum
    }

    const verdictObj = {
      checker: validated.verdict.checker,
      family: validated.verdict.family,
      verdict: validated.verdict.verdict,
      task: validated.verdict.task,
      attempt: validated.verdict.attempt,
      manifestSha256: validated.verdict.manifestSha256,
      evidence,
      path: filePath,
      filename,
    };

    const key = `${task}.${attempt}`;
    if (!byTaskAttempt.has(key)) byTaskAttempt.set(key, []);
    byTaskAttempt.get(key).push(verdictObj);
  }

  return { byTaskAttempt, filenames };
}

// gate.sh walk_verdicts (tiers 2/3) globs `<task>.<attempt>.*.verdict` and
// hard-FAILS the task on ANY matching file it cannot load as a valid verdict
// for exactly that task+attempt — bad headers, filename/header mismatch, an
// unparseable filename, even a perfectly valid verdict belonging to a
// dot-prefix sibling task (task `A.1.b` attempt 2 lands in task A attempt 1's
// glob). Mirror the glob exactly: `*` matches anything, including nothing and
// dots, so match = prefix + suffix without overlap. Anything the glob catches
// that did not validate as this task+attempt's own verdict blocks the task.
// Tier 1 is different — gate.sh only loads the named checkers' exact files —
// so callers must apply this only at tiers 2/3.
function blockingVerdictFiles(filenames, validVerdicts, taskId, attempt) {
  const prefix = `${taskId}.${attempt}.`;
  const suffix = '.verdict';
  const validNames = new Set(validVerdicts.map((v) => v.filename));
  return filenames.filter(
    (fn) =>
      fn.startsWith(prefix) &&
      fn.endsWith(suffix) &&
      fn.length >= prefix.length + suffix.length &&
      !validNames.has(fn)
  );
}

// ---------------------------------------------------------------------------
// flags/<task>.flag
// ---------------------------------------------------------------------------

function parseFlag(swarmDir, taskId, ledgerTier) {
  const filePath = path.join(swarmDir, 'flags', `${taskId}.flag`);
  const content = readFileIfExists(filePath);
  if (content === null) return null;

  const lines = content.split(/\r?\n/);
  let targetTier = null;
  let reason = null;
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === 'TARGET_TIER') targetTier = Number.parseInt(value, 10);
    else if (key === 'REASON') reason = value;
  }

  if (targetTier === null || Number.isNaN(targetTier)) return null;

  // A flag is OPEN only if ledger tier < target tier; otherwise it is
  // resolved and treated as absent.
  if (!(ledgerTier < targetTier)) return null;

  return { targetTier, reason };
}

// ---------------------------------------------------------------------------
// inline escalation triggers (gate.sh escalation_reasons, 2026-09-18)
// ---------------------------------------------------------------------------
// With no flag FILE on disk, `gate.sh check` recomputes the escalation
// triggers and refuses an `accepted` row whose triggers are live below its
// target tier (escalate-scan was never run for this evidence; ruling
// 2026-09-29e). Everything here reproduces that recomputation read-only —
// writing the flag stays escalate-scan's job — so the dashboard cannot show
// `accepted` for a row the gate refuses.

// gate.sh escalation_target: one tier up, capped at 3.
function escalationTarget(tier) {
  return Math.min(tier + 1, 3);
}

// gate.sh unresolved_fail_at: a valid FAIL at this attempt that no judge panel
// set aside. The panel test is judges_overruled_at's — every valid
// UPHOLD/OVERRULE at the attempt counts, with NO identity de-duplication
// (unlike tallyJudges) — so the two halves of the gate agree. Validity carries
// the lane-accounting pairing rule: a FAIL is only ever checker-*-cast, and an
// UPHOLD/OVERRULE only ever judge-* or boss cast (a checker-cast one is
// invalid and never reaches byTaskAttempt).
function unresolvedFailAt(byTaskAttempt, taskId, attempt) {
  const verdicts = byTaskAttempt.get(`${taskId}.${attempt}`) ?? [];
  if (!verdicts.some((v) => v.verdict === 'FAIL')) return false;
  let ups = 0;
  let ovs = 0;
  for (const v of verdicts) {
    if (v.verdict === 'UPHOLD') ups += 1;
    else if (v.verdict === 'OVERRULE') ovs += 1;
  }
  return !(ups + ovs >= 3 && ovs > ups);
}

// gate.sh overrule_exists, for every task at once: ids owning a valid
// `VERDICT: OVERRULE` from `CHECKER: boss` at ANY attempt. byTaskAttempt holds
// only valid verdicts, each filed under its own filename-parsed task, which is
// the ownership overrule_exists confirms (a dot-prefix sibling's file is
// not this task's).
function tasksWithBossOverrule(byTaskAttempt) {
  const ids = new Set();
  for (const verdicts of byTaskAttempt.values()) {
    for (const v of verdicts) {
      if (v.verdict === 'OVERRULE' && v.checker === 'boss') ids.add(v.task);
    }
  }
  return ids;
}

// gate.sh DEFAULT_TEST_GLOBS — used only when test.globs is absent; a present
// test.globs replaces the list entirely.
const DEFAULT_TEST_GLOBS = [
  '**/*_test.go',
  '**/*_test.py',
  '**/test_*.py',
  '**/*.test.ts',
  '**/*.spec.ts',
  'smoketest/**',
  'tests/**',
];

// manifest_hits_glob hands its files to an embedded python3, so the parts of
// python that decide the outcome are reproduced here rather than approximated
// with their JS lookalikes:
//   - str.strip(): python's whitespace set (isspace) differs from JS trim().
//   - open(): strict UTF-8 (a BOM stays as U+FEFF) and universal newlines.
//     A file that is not valid UTF-8 — or not a regular file, or not readable —
//     makes the evaluation UNREADABLE (run CD, CD3: the gate fails CLOSED and
//     escalates with the reason `critical-glob-unreadable`); this mirror does
//     the same, never "no hit".
//   - fnmatch.fnmatch (case-sensitive on posix): see compileFnmatch.
const PY_STRIP_RE =
  /^[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g;

function pyStrip(s) {
  return s.replace(PY_STRIP_RE, '');
}

// The lines python's `for l in open(path)` yields (blank ones included), or
// null when the input is UNREADABLE: not a regular file after following
// symlinks (a directory, dangling link, FIFO or device is never opened — a
// FIFO would block), unreadable for any reason, or not valid UTF-8. The open is
// O_NONBLOCK and re-checked on the descriptor, so a FIFO swapped in after the
// stat cannot block either.
function readPyLines(filePath) {
  let fd = -1;
  try {
    if (!fs.statSync(filePath).isFile()) return null;
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    if (!fs.fstatSync(fd).isFile()) return null;
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      fs.readFileSync(fd)
    );
    return text.split(/\r\n|\r|\n/);
  } catch {
    return null;
  } finally {
    if (fd >= 0) fs.closeSync(fd);
  }
}

// gate.sh's embedded `load`: stripped, non-empty lines that do not start with
// '#' — the '#' test is on the RAW line, so an indented "  # x" is a glob.
function loadGlobs(lines) {
  return lines.filter((l) => pyStrip(l) !== '' && !l.startsWith('#')).map(pyStrip);
}

const FN_STAR = Symbol('fnmatch-star');

// python fnmatch.translate's `[...]` branch, on the pattern's code points:
// pat[i:j] is the class body (j is its closing ']'). Reproduces the
// hyphen-chunking and empty-range removal, then reads the resulting body the
// way python's re module does. Returns a code-point predicate.
function fnmatchClass(pat, i, j) {
  let stuff;
  const raw = pat.slice(i, j);
  if (!raw.includes('-')) {
    stuff = raw.join('').replace(/\\/g, '\\\\');
  } else {
    const chunks = [];
    let start = i;
    let k = pat[i] === '!' ? i + 2 : i + 1;
    for (;;) {
      let found = -1;
      for (let x = k; x < j; x++) {
        if (pat[x] === '-') { found = x; break; }
      }
      if (found < 0) break;
      chunks.push(pat.slice(start, found));
      start = found + 1;
      k = found + 3;
    }
    const chunk = pat.slice(start, j);
    if (chunk.length > 0) chunks.push(chunk);
    else chunks[chunks.length - 1].push('-');
    // Remove empty (reversed) ranges.
    for (let m = chunks.length - 1; m > 0; m--) {
      const prev = chunks[m - 1];
      if (prev[prev.length - 1].codePointAt(0) > chunks[m][0].codePointAt(0)) {
        chunks[m - 1] = prev.slice(0, -1).concat(chunks[m].slice(1));
        chunks.splice(m, 1);
      }
    }
    // Only the joins between chunks stay unescaped hyphens (range operators).
    stuff = chunks
      .map((c) => c.join('').replace(/\\/g, '\\\\').replace(/-/g, '\\-'))
      .join('-');
  }
  stuff = stuff.replace(/([&~|])/g, '\\$1');
  if (stuff === '') return () => false; // empty range: never matches
  if (stuff === '!') return () => true; // negated empty range: any character
  const negate = stuff[0] === '!';
  const body = Array.from(negate ? stuff.slice(1) : stuff);
  const singles = new Set();
  const ranges = [];
  let b = 0;
  const atom = () => {
    if (body[b] === '\\') { b += 2; return body[b - 1]; }
    b += 1;
    return body[b - 1];
  };
  while (b < body.length) {
    const lo = atom();
    if (body[b] !== '-') { singles.add(lo); continue; }
    b += 1;
    if (b >= body.length) { singles.add(lo); singles.add('-'); break; }
    ranges.push([lo.codePointAt(0), atom().codePointAt(0)]);
  }
  const inSet = (ch) => {
    if (singles.has(ch)) return true;
    const cp = ch.codePointAt(0);
    return ranges.some(([lo, hi]) => cp >= lo && cp <= hi);
  };
  return negate ? (ch) => !inSet(ch) : inSet;
}

// python fnmatch.fnmatch(name, pattern) on posix: case-sensitive, the whole
// string must match, `*` crosses '/', `?` is one code point, `[seq]`/`[!seq]`
// are classes. Returns a predicate over names.
function compileFnmatch(pattern) {
  const pat = Array.from(pattern);
  const n = pat.length;
  const toks = [];
  let i = 0;
  while (i < n) {
    const c = pat[i];
    i += 1;
    if (c === '*') {
      if (toks[toks.length - 1] !== FN_STAR) toks.push(FN_STAR);
    } else if (c === '?') {
      toks.push(() => true);
    } else if (c === '[') {
      let j = i;
      if (j < n && pat[j] === '!') j += 1;
      if (j < n && pat[j] === ']') j += 1;
      while (j < n && pat[j] !== ']') j += 1;
      if (j >= n) {
        toks.push((ch) => ch === '['); // unclosed: a literal '['
      } else {
        toks.push(fnmatchClass(pat, i, j));
        i = j + 1;
      }
    } else {
      toks.push((ch) => ch === c);
    }
  }
  return (name) => {
    const s = Array.from(name);
    let si = 0;
    let ti = 0;
    let starTi = -1;
    let starSi = 0;
    while (si < s.length) {
      if (toks[ti] === FN_STAR) {
        starTi = ti;
        starSi = si;
        ti += 1;
      } else if (ti < toks.length && toks[ti](s[si])) {
        ti += 1;
        si += 1;
      } else if (starTi !== -1) {
        ti = starTi + 1;
        starSi += 1;
        si = starSi;
      } else {
        return false;
      }
    }
    while (toks[ti] === FN_STAR) ti += 1;
    return ti === toks.length;
  };
}

// gate.sh's embedded `matches`: the glob itself, plus `**/X` also tried as `X`
// (zero leading dirs) and any `/**` also tried as `/*`.
function globMatcher(glob) {
  const candidates = new Set([glob]);
  if (glob.startsWith('**/')) candidates.add(glob.slice(3));
  if (glob.includes('/**')) candidates.add(glob.split('/**').join('/*'));
  const tests = Array.from(candidates, compileFnmatch);
  return (p) => tests.some((t) => t(p));
}

// gate.sh manifest_hits_glob: 'hit' when a NON-TEST path in any of the task's
// manifests matches critical.globs (a test glob exempts only the test path
// itself, never the whole manifest), 'none' for no hit, and 'unreadable' when
// an input the evaluation needs cannot be read — it FAILS CLOSED (run CD,
// CD3), exactly as the gate does. Same evaluation order and rules:
//   1. critical.globs ABSENT (no directory entry) -> none; no
//      manifests/<task>.*.files entry -> none (a row that has not started is
//      never flagged). Only then is anything read.
//   2. PRESENT means a directory entry exists (a dangling symlink is present).
//      critical.globs, a present test.globs and EVERY matching manifest must be
//      a regular file (see readPyLines) holding strict UTF-8; test.globs absent
//      -> the defaults. A manifests/ directory that exists but cannot be listed
//      is unreadable ("no entry matches" cannot be established).
//   3. Any unreadable input makes the whole evaluation unreadable, even when
//      another input produced a hit.
//   4. Any failure of the evaluation itself is unreadable, never no hit.
const GLOB_HIT = 'hit';
const GLOB_NONE = 'none';
const GLOB_UNREADABLE = 'unreadable';

function manifestHitsGlob(swarmDir, taskId) {
  try {
    const criticalFile = path.join(swarmDir, 'critical.globs');
    if (!entryExists(criticalFile)) return GLOB_NONE;
    // gate.sh globs manifests/<task>.*.files: a prefix+suffix match, not a
    // task-id boundary, so it also catches every OLDER attempt's manifest and
    // a dot-prefix sibling task's (`k` sees `k.1.x.1.files`). Mirrored, not
    // fixed — same shape as blockingVerdictFiles. Every entry the glob catches
    // counts, whatever its kind: a non-regular one is read as unreadable below.
    const manifestsDir = path.join(swarmDir, 'manifests');
    let names = [];
    if (entryExists(manifestsDir)) {
      try {
        fs.accessSync(manifestsDir, fs.constants.R_OK | fs.constants.X_OK);
        names = fs.readdirSync(manifestsDir);
      } catch {
        return GLOB_UNREADABLE;
      }
    }
    const prefix = `${taskId}.`;
    const suffix = '.files';
    const manifestFiles = names
      .filter(
        (fn) =>
          fn.startsWith(prefix) && fn.endsWith(suffix) && fn.length >= prefix.length + suffix.length
      )
      .sort();
    if (manifestFiles.length === 0) return GLOB_NONE;

    const testFile = path.join(swarmDir, 'test.globs');
    const criticalLines = readPyLines(criticalFile);
    const testLines = entryExists(testFile) ? readPyLines(testFile) : DEFAULT_TEST_GLOBS;
    const manifestLines = manifestFiles.map((fn) => readPyLines(path.join(manifestsDir, fn)));
    if (criticalLines === null || testLines === null || manifestLines.includes(null)) {
      return GLOB_UNREADABLE; // unreadable beats a hit
    }
    const paths = [];
    for (const lines of manifestLines) {
      for (const line of lines) {
        if (pyStrip(line) !== '') paths.push(pyStrip(line));
      }
    }
    const critical = loadGlobs(criticalLines).map(globMatcher);
    const tests = loadGlobs(testLines).map(globMatcher);
    return paths.some((p) => critical.some((m) => m(p)) && !tests.some((m) => m(p)))
      ? GLOB_HIT
      : GLOB_NONE;
  } catch {
    return GLOB_UNREADABLE; // the evaluation itself failed: fail closed, never "no hit"
  }
}

// gate.sh escalation_reasons: the live triggers for a row, space-separated in
// gate order ("two-consecutive-fails checker-overruled critical-glob"), or ''.
// The reason tokens are two-consecutive-fails, checker-overruled, critical-glob
// and critical-glob-unreadable — the last is the fail-CLOSED outcome of
// manifestHitsGlob and replaces critical-glob for that evaluation.
function escalationReasons(swarmDir, row, byTaskAttempt, bossOverruled) {
  const reasons = [];
  if (
    row.attempt >= 1 &&
    unresolvedFailAt(byTaskAttempt, row.id, row.attempt) &&
    unresolvedFailAt(byTaskAttempt, row.id, row.attempt - 1)
  ) {
    reasons.push('two-consecutive-fails');
  }
  if (bossOverruled.has(row.id)) reasons.push('checker-overruled');
  const glob = manifestHitsGlob(swarmDir, row.id);
  if (glob === GLOB_HIT) reasons.push('critical-glob');
  else if (glob !== GLOB_NONE) reasons.push('critical-glob-unreadable');
  return reasons.join(' ');
}

// ---------------------------------------------------------------------------
// tier3/<task>/ — oracle contract (gate.sh check_tier3)
// ---------------------------------------------------------------------------

// Mirrors gate.sh `tail -n1`: a trailing newline does not add an empty last
// line, but any other trailing content (extra blank line, \r) counts as-is.
function lastLine(content) {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines[lines.length - 1];
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function parseTier3(swarmDir, taskId, attempt) {
  const dirPath = path.join(swarmDir, 'tier3', taskId);
  if (!isDirectory(dirPath)) return null;

  // A report.md is the pre-2026-08-26 blind-arm artefact. The legacy
  // contract was removed 2026-09-18: its presence now BLOCKS the row
  // (gate.sh check_tier3), so a reused directory cannot bypass the oracle.
  const hasReport = fs.existsSync(path.join(dirPath, 'report.md'));

  const scriptPath = path.join(dirPath, 'accept.sh');
  const logContent = readFileIfExists(path.join(dirPath, `oracle.${attempt}.log`));
  const oracle = {
    scriptExists: fs.existsSync(scriptPath),
    scriptExecutable: isExecutable(scriptPath),
    logExists: logContent !== null,
    oraclePass: logContent !== null && lastLine(logContent) === 'ORACLE PASS',
  };

  return { hasReport, oracle };
}

// The tier-3 evidence contract (gate.sh check_tier3, 2026-09-18): no stale
// report.md, an executable accept.sh, and an oracle log at the current
// attempt whose last line is ORACLE PASS.
function tier3ContractOk(tier3) {
  if (!tier3) return false;
  if (tier3.hasReport) return false;
  const o = tier3.oracle;
  return o.scriptExists && o.scriptExecutable && o.logExists && o.oraclePass;
}

function tier3ContractReason(tier3) {
  if (!tier3) return 'no tier-3 oracle (accept.sh)';
  if (tier3.hasReport) return 'stale blind-arm report.md in tier-3 dir (legacy contract removed 2026-09-18)';
  const o = tier3.oracle;
  if (!o.scriptExists) return 'no tier-3 oracle (accept.sh)';
  if (!o.scriptExecutable) return 'tier-3 oracle accept.sh is not executable';
  if (!o.logExists) return 'no oracle run log at the current attempt';
  return 'oracle log does not end with ORACLE PASS';
}

// ---------------------------------------------------------------------------
// spend.jsonl
// ---------------------------------------------------------------------------

function parseSpendRows(swarmDir, errors) {
  const filePath = path.join(swarmDir, 'spend.jsonl');
  const content = readFileIfExists(filePath);
  if (content === null) return null;

  const rows = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (line.trim() === '') return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      errors.push({ file: 'spend.jsonl', message: `line ${idx + 1}: invalid JSON` });
      return;
    }
    if (
      typeof obj.alias !== 'string' ||
      typeof obj.family !== 'string' ||
      typeof obj.prompt_tokens !== 'number' ||
      typeof obj.completion_tokens !== 'number' ||
      typeof obj.cost_usd !== 'number'
    ) {
      errors.push({ file: 'spend.jsonl', message: `line ${idx + 1}: missing/invalid required fields` });
      return;
    }
    rows.push(obj);
  });

  return rows;
}

function buildSpend(rows, acceptedCount) {
  if (rows === null) return null;

  const total = rows.reduce((sum, r) => sum + r.cost_usd, 0);

  const aliasMap = new Map();
  for (const r of rows) {
    const tokens = r.prompt_tokens + r.completion_tokens;
    if (!aliasMap.has(r.alias)) {
      aliasMap.set(r.alias, { alias: r.alias, family: r.family, tokens: 0, cost: 0 });
    }
    const entry = aliasMap.get(r.alias);
    entry.tokens += tokens;
    entry.cost += r.cost_usd;
  }
  const perAlias = Array.from(aliasMap.values());

  const tierMap = new Map();
  for (const r of rows) {
    if (r.tier === null || r.tier === undefined) continue;
    if (!tierMap.has(r.tier)) tierMap.set(r.tier, { cost: 0, tasks: new Set() });
    const entry = tierMap.get(r.tier);
    entry.cost += r.cost_usd;
    if (r.task !== null && r.task !== undefined) entry.tasks.add(r.task);
  }
  const perTier = Array.from(tierMap.entries()).map(([tier, v]) => ({
    tier,
    tasks: v.tasks.size,
    avgCost: v.tasks.size === 0 ? null : v.cost / v.tasks.size,
  }));

  const verificationCost = rows
    .filter((r) => r.alias.startsWith('checker-') || r.alias.startsWith('judge-'))
    .reduce((sum, r) => sum + r.cost_usd, 0);
  const disputeOverhead = rows
    .filter((r) => r.alias.startsWith('judge-'))
    .reduce((sum, r) => sum + r.cost_usd, 0);
  const localTokens = rows
    .filter((r) => r.family === 'local')
    .reduce((sum, r) => sum + r.prompt_tokens + r.completion_tokens, 0);

  const derived = {
    perAcceptedTask: acceptedCount > 0 ? total / acceptedCount : null,
    verificationSharePct: total > 0 ? Math.round((verificationCost / total) * 100) : 0,
    disputeOverhead,
    localTokens,
  };

  return { total, perAlias, perTier, derived };
}

// ---------------------------------------------------------------------------
// derived.state — the anti-lie computation
// ---------------------------------------------------------------------------

/**
 * Count judge votes with unique CHECKER and FAMILY identities (mirrors gate.sh).
 * Duplicate judge checker or family identities are ignored for vote tallies and
 * surface as schema/identity problems via errors when the ledger claims accepted.
 */
function tallyJudges(verdicts) {
  const seenChecker = new Set();
  const seenFamily = new Set();
  let ups = 0;
  let ovs = 0;
  let identityError = null;

  for (const v of verdicts) {
    if (v.verdict !== 'UPHOLD' && v.verdict !== 'OVERRULE') continue;
    if (seenChecker.has(v.checker)) {
      identityError = identityError || `duplicate judge identity '${v.checker}'`;
      continue;
    }
    if (seenFamily.has(v.family)) {
      identityError = identityError || `duplicate judge family '${v.family}'`;
      continue;
    }
    seenChecker.add(v.checker);
    seenFamily.add(v.family);
    if (v.verdict === 'UPHOLD') ups += 1;
    else ovs += 1;
  }
  return { ups, ovs, identityError };
}

function computeQuorum(tier, checks, verdicts, tier3, hasFail, disputeResolved, majorityOverrule) {
  if (tier === 1) {
    // gate.sh check_tier1 (2026-09-18): a blank checks column hard-fails.
    if (checks.length === 0) return false;
    return checks.every((c) =>
      verdicts.some((v) => v.checker === `checker-${c}` && v.verdict === 'PASS')
    );
  }

  // Only validated verdicts reach this point (invalid files were excluded in
  // parseAllVerdicts; at tiers 2/3 computeDerived separately voids the quorum
  // when any current-attempt file failed validation, mirroring walk_verdicts'
  // hard fail). Any FAIL at the attempt replaces the PASS requirement with
  // the judge-panel quorum — at both tiers (gate.sh walk_verdicts).
  const passCheckers = new Set();
  const familiesPassed = new Set();
  for (const v of verdicts) {
    if (v.verdict !== 'PASS' || !v.family) continue;
    if (passCheckers.has(v.checker)) continue; // unique checker for PASS
    passCheckers.add(v.checker);
    familiesPassed.add(v.family);
  }
  const disputeQuorum = disputeResolved && majorityOverrule;

  if (tier === 2) {
    // Lean tier-2 contract (gate.sh check_tier2, 2026-08-31): PASS from every
    // checker named in the ledger checks column; an empty column is a hard
    // error; the two-lane span applies only when `second` is among the names.
    if (checks.length === 0) return false;
    if (hasFail) return disputeQuorum;
    if (!checks.every((c) => passCheckers.has(`checker-${c}`))) return false;
    if (checks.includes('second') && familiesPassed.size < 2) return false;
    return true;
  }

  // Tier 3 (gate.sh check_tier3, 2026-09-18): evidence contract first, then
  // a PASS from EVERY named checker (empty column hard-fails) AND the
  // unconditional two-lane span.
  if (!tier3ContractOk(tier3)) return false;
  if (checks.length === 0) return false;
  if (hasFail) return disputeQuorum;
  if (!checks.every((c) => passCheckers.has(`checker-${c}`))) return false;
  return familiesPassed.size >= 2;
}

function computeDerived(task, verdicts, flagOpen, escalation) {
  const hasFail = verdicts.some((v) => v.verdict === 'FAIL');
  const { ups, ovs, identityError } = tallyJudges(verdicts);

  const disputeOpen = hasFail && ups + ovs < 3;
  const disputeResolved = hasFail && ups + ovs >= 3;
  const majorityOverrule = disputeResolved && ovs > ups;
  const majorityUphold = disputeResolved && !majorityOverrule;

  const familiesPassed = Array.from(
    new Set(verdicts.filter((v) => v.verdict === 'PASS' && v.family).map((v) => v.family))
  );
  const isDispute = hasFail;

  let quorumHolds = computeQuorum(
    task.tier,
    task.checks,
    verdicts,
    task.tier3,
    hasFail,
    disputeResolved,
    majorityOverrule
  );
  // A dispute resolved only with duplicate judge identities is not a real quorum.
  if (hasFail && identityError) quorumHolds = false;
  // gate.sh walk_verdicts fails the whole task on any current-attempt file it
  // cannot validate (tiers 2/3 only — tier 1 loads only the named checkers'
  // files, so a stray malformed file does not block there).
  const invalidBlocking = task.tier >= 2 && task.invalidVerdicts.length > 0;
  if (invalidBlocking) quorumHolds = false;

  let state;
  let mismatch = null;

  // Mirror gate.sh check_task precedence: the escalation check comes
  // *before* tier acceptance and blocks 'accepted' outright, even when a
  // genuine PASS-quorum exists for the current attempt. An OPEN flag file
  // blocks; with no flag file at all, so does a live inline trigger
  // (`escalation`, computed only in that case — see parse()).
  if (flagOpen && task.status === 'accepted') {
    state = 'flagged';
    mismatch = `task ${task.id}: ledger says accepted but escalation flag open (target tier ${task.flag.targetTier})`;
  } else if (task.status === 'accepted' && escalation !== '') {
    state = 'flagged';
    mismatch = `task ${task.id}: ledger says accepted but escalation trigger (${escalation}) and no flag — run gate.sh escalate-scan`;
  } else if (task.status === 'accepted') {
    // gate.sh runs check_fingerprint AFTER the tier checks, so a fingerprint
    // defect is reported only for a row whose quorum otherwise holds.
    const fpProblem = quorumHolds ? fingerprintProblem(task, verdicts) : null;
    if (quorumHolds && fpProblem === null) {
      state = 'accepted';
    } else if (quorumHolds) {
      state = 'blocked';
      mismatch = `task ${task.id}: ledger says accepted but ${fpProblem}`;
    } else {
      state = 'blocked';
      let reason;
      const missingChecker =
        task.tier >= 2 && !hasFail
          ? task.checks.find(
              (c) => !verdicts.some((v) => v.checker === `checker-${c}` && v.verdict === 'PASS')
            )
          : undefined;
      if (task.tier === 3 && !tier3ContractOk(task.tier3)) {
        // gate.sh checks the tier-3 evidence contract before the quorum walk.
        reason = tier3ContractReason(task.tier3);
      } else if (task.checks.length === 0) {
        // gate.sh check_tier1/2/3 fail on an empty checks column before
        // walking any verdict files, so this outranks invalid-file blocking.
        reason = `tier ${task.tier} requires named checkers in the ledger checks column`;
      } else if (invalidBlocking) {
        reason = `invalid verdict file(s) at attempt ${task.attempt}: ${task.invalidVerdicts.join(', ')}`;
      } else if (identityError) {
        reason = identityError;
      } else if (disputeOpen) {
        reason = `open dispute (${ups} uphold / ${ovs} overrule, need >=3 judges)`;
      } else if (majorityUphold) {
        reason = `judges upheld the FAIL (${ovs} overrule / ${ups} uphold)`;
      } else if (hasFail) {
        reason = 'unresolved FAIL in current-attempt verdicts';
      } else if (task.tier === 1) {
        reason = 'not all required checkers returned PASS';
      } else if (missingChecker !== undefined) {
        reason = `missing PASS from checker-${missingChecker}`;
      } else if (task.tier === 2) {
        reason = `checks include 'second' but PASSes span ${familiesPassed.length} lane(s), need 2`;
      } else {
        reason = `need PASS from 2 families, have ${familiesPassed.length}`;
      }
      mismatch = `task ${task.id}: ledger says accepted but ${reason}`;
    }
  } else if (majorityUphold) {
    state = 'blocked';
  } else if (disputeOpen) {
    state = 'disputed';
  } else if (flagOpen) {
    state = 'flagged';
  } else if (verdicts.length >= 1) {
    state = 'checking';
  } else {
    state = 'building';
  }

  return {
    derived: { state, familiesPassed, isDispute },
    mismatch,
  };
}

// ---------------------------------------------------------------------------
// main entry point
// ---------------------------------------------------------------------------

export function parse(swarmDir) {
  const errors = [];

  const ledgerRows = parseLedger(swarmDir, errors);
  const { byTaskAttempt: verdictsByTaskAttempt, filenames: verdictFilenames } =
    parseAllVerdicts(swarmDir, errors);

  const bossOverruled = tasksWithBossOverrule(verdictsByTaskAttempt);

  const tasks = ledgerRows.map((row) => {
    const manifest = parseManifest(swarmDir, row.id, row.attempt);
    const verdicts = verdictsByTaskAttempt.get(`${row.id}.${row.attempt}`) ?? [];
    const flag = parseFlag(swarmDir, row.id, row.tier);
    const tier3 = parseTier3(swarmDir, row.id, row.attempt);
    const fingerprint = parseFingerprint(swarmDir, row.id, row.attempt);
    const invalidVerdicts = blockingVerdictFiles(verdictFilenames, verdicts, row.id, row.attempt);

    const task = {
      id: row.id,
      tier: row.tier,
      checks: row.checks,
      status: row.status,
      attempt: row.attempt,
      worker: row.worker,
      reason: row.reason,
      manifest,
      fingerprint,
      verdicts,
      invalidVerdicts,
      flag,
      tier3,
      derived: null, // filled below
    };

    // gate.sh check_task recomputes the triggers only when NO flag file exists
    // (open or closed — parseFlag hides a closed one) and only below the
    // escalation target, so a tier-3 row is never blocked this way.
    const flagFile = isFile(path.join(swarmDir, 'flags', `${row.id}.flag`));
    const escalation =
      row.status === 'accepted' && !flagFile && row.tier < escalationTarget(row.tier)
        ? escalationReasons(swarmDir, row, verdictsByTaskAttempt, bossOverruled)
        : '';

    const { derived, mismatch } = computeDerived(task, verdicts, flag !== null, escalation);
    task.derived = derived;
    if (mismatch) errors.push({ file: 'ledger.tsv', message: mismatch });

    return task;
  });

  const summary = {
    accepted: 0,
    inVerification: 0,
    disputed: 0,
    flagsOpen: 0,
    byTier: { '1': 0, '2': 0, '3': 0 },
  };

  for (const task of tasks) {
    summary.byTier[String(task.tier)] = (summary.byTier[String(task.tier)] ?? 0) + 1;
    if (task.derived.state === 'accepted') summary.accepted += 1;
    if (task.derived.state === 'checking' || task.derived.state === 'disputed') {
      summary.inVerification += 1;
    }
    if (task.derived.state === 'disputed') summary.disputed += 1;
    if (task.flag) summary.flagsOpen += 1;
  }

  const spendRows = parseSpendRows(swarmDir, errors);
  const acceptedCount = tasks.filter((t) => t.derived.state === 'accepted').length;
  const spend = buildSpend(spendRows, acceptedCount);

  return { tasks, summary, spend, errors };
}
