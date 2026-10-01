#!/usr/bin/env python3
"""CD1 oracle helper (A4 item 1). Usage: argv-env-check.py <strace -f -v log> <secret>...

Parses every execve/execveat line of an `strace -f -v` log into argv and envp
lists. Prints one line per problem and exits 1 when:
  - any argv element contains a secret, or
  - an exec whose environment contains a secret is not a tools.py process
    (argv has no element ending in tools.py), or
  - no exec had a parsed environment list (-v did not take effect: the env
    check would be vacuous).
Exit 0 and prints 'ok <execs> <with-env> <secret-env-execs>' otherwise.
"""
import sys


def parse_list(s, i):
    """s[i] == '[' ; returns (items, index after ']')."""
    items, i = [], i + 1
    while i < len(s) and s[i] != ']':
        if s[i] == '"':
            j, buf = i + 1, []
            while j < len(s) and s[j] != '"':
                if s[j] == '\\' and j + 1 < len(s):
                    buf.append(s[j:j + 2]); j += 2
                else:
                    buf.append(s[j]); j += 1
            items.append(''.join(buf)); i = j + 1
        else:
            i += 1
    return items, i + 1


def main():
    log, secrets = sys.argv[1], [x for x in sys.argv[2:] if x]
    execs = with_env = secret_env = 0
    bad = []
    for line in open(log, encoding='utf-8', errors='replace'):
        for call in ('execveat(', 'execve('):
            k = line.find(call)
            if k != -1:
                break
        else:
            continue
        a = line.find('[', k)
        if a == -1:
            continue
        argv, i = parse_list(line, a)
        execs += 1
        env = None
        rest = line[i:].lstrip(', ')
        if rest.startswith('['):
            env, _ = parse_list(rest, 0)
            with_env += 1
        for sec in secrets:
            if any(sec in x for x in argv):
                bad.append('secret in argv: ' + (argv[0] if argv else '?'))
            if env is not None and any(sec in x for x in env):
                secret_env += 1
                if not any(x.endswith('tools.py') for x in argv):
                    bad.append('secret in the environment of a non-tools.py exec: ' + ' '.join(argv[:3]))
    if with_env == 0:
        bad.append('no exec had a parsed environment list (strace -v not in effect)')
    for b in dict.fromkeys(bad):
        for sec in secrets:
            b = b.replace(sec, '<secret>')
        print(b)
    if bad:
        sys.exit(1)
    print('ok', execs, with_env, secret_env)


main()
