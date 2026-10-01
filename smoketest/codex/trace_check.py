#!/usr/bin/env python3
"""Attempt-4 item 1 test helper: no secret in any process's argv.

    trace_check.py <strace -f -v -e trace=execve,execveat log> <secret>...

Parses every execve/execveat line into its argv and envp lists and prints one
line per problem (secrets shown as <secret>), exiting 1 when
  - any argv element contains a secret, or
  - an exec whose ENVIRONMENT carries a secret is not a tools.py python process
    (no argv element ends in tools.py), or
  - no exec had a parsed environment (strace -v was not in effect: vacuous).
Otherwise prints "ok <execs> <with-env> <secret-env-execs>" and exits 0.
"""
import sys


def parse_list(s, i):
    """s[i] == '[': the quoted strings of the list and the index after its ']'."""
    items, i = [], i + 1
    while i < len(s) and s[i] != ']':
        if s[i] == '"':
            j, buf = i + 1, []
            while j < len(s) and s[j] != '"':
                if s[j] == '\\' and j + 1 < len(s):
                    buf.append(s[j:j + 2])
                    j += 2
                else:
                    buf.append(s[j])
                    j += 1
            items.append(''.join(buf))
            i = j + 1
        else:
            i += 1
    return items, i + 1


def main():
    log, secrets = sys.argv[1], [x for x in sys.argv[2:] if x]
    execs = with_env = secret_env = 0
    problems = []
    with open(log, encoding='utf-8', errors='replace') as fh:
        for line in fh:
            at = -1
            for call in ('execveat(', 'execve('):
                at = line.find(call)
                if at != -1:
                    break
            if at == -1:
                continue
            start = line.find('[', at)
            if start == -1:
                continue
            argv, end = parse_list(line, start)
            execs += 1
            env = None
            rest = line[end:].lstrip(', ')
            if rest.startswith('['):
                env, _ = parse_list(rest, 0)
                with_env += 1
            for sec in secrets:
                if any(sec in a for a in argv):
                    problems.append('secret in argv of: ' + (argv[0] if argv else '?'))
                if env is not None and any(sec in e for e in env):
                    secret_env += 1
                    if not any(a.endswith('tools.py') for a in argv):
                        problems.append('secret in the environment of a non-tools.py exec: ' + ' '.join(argv[:3]))
    if with_env == 0:
        problems.append('no exec had a parsed environment list (strace -v not in effect)')
    for p in dict.fromkeys(problems):
        for sec in secrets:
            p = p.replace(sec, '<secret>')
        print(p)
    if problems:
        sys.exit(1)
    print('ok', execs, with_env, secret_env)


main()
