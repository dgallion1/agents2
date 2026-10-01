# CD4 attempt 3 — one test (Tier 3; user reopen after a codex-only FAIL)

This AMENDS `.swarm/briefs/CD4.2.md` and `CD4.1.md`; everything there still
holds. SPEC.md rulings CD-z (the Codex finding) and CD-aa (the reopen).

## The finding (Codex, verified by the lead)
Brief CD4.2 item 2b: `parse()` "must never open a non-regular `*.verdict`
entry". The shipped code satisfies it — `readVerdictEntry` checks
`fs.statSync(filePath).isFile()` BEFORE `fs.openSync`. But no shipped test
pins "never opens": a mutation that deletes exactly this line

    if (!fs.statSync(filePath).isFile()) return { error: 'not a regular file' };

keeps the O_NONBLOCK open and the fstat re-check, so nothing hangs or throws
and the entry is still classified invalid — and the dashboard suite stays
126/126 while `parse()` now opens a FIFO verdict entry (an fs.openSync
counter shows 1 open instead of 0).

## Scope — this, nothing else (reconciled with surface census CD4.3)
Add to `dashboard/test/parse.test.mjs` (the ONLY file you may change) a test
— or tests — whose names contain the literal words `never opens`, that:
- builds fixtures for each of these kinds: a FIFO, a directory, a dangling
  symlink, a symlink loop, a symlink to a FIFO, a symlink to a directory, and
  a symlink to `/dev/null` (a device). NOT a mode-000 regular file — regular
  files are opened by design;
- does so for BOTH entries: the verdict entry `<t>.<a>.<checker>.verdict`,
  and the Codex skip record `<t>.<a>.checker-codex.skip` on a row whose
  `checks` names `codex` (CD4.1 rule 3: "non-regular ones are never opened";
  `parseCodexSkip` has the same guard and the same untested gap);
- runs `parse()` in a CommonJS child (`node -e`) with a timeout, where
  `fs.openSync` and `fs.readFileSync` are patched to count calls whose path
  argument is the entry's path, then `require('node:module')
  .syncBuiltinESMExports()` is called, and only THEN `parse.mjs` is
  dynamically imported (the census showed an ESM child that imports `fs`
  first misses named-import openers; the existing `parseInChild` helper is
  that ESM form — do not reuse it here);
- asserts the count is 0 for every kind and entry, and that the row is still
  refused/blocked exactly as today.
Each of these mutations, applied alone, must make the dashboard suite fail
on a `never opens` test:
- m1: delete the verdict guard line quoted above (`readVerdictEntry`);
- m2: narrow that guard to `isFIFO() || isDirectory()` (a device then opens);
- m3: delete `parseCodexSkip`'s guard line
  `    if (!fs.statSync(filePath).isFile()) return null;`.
Do not change `parse.mjs`, `gate.sh`, the docs or any other test file.
Backlog, out of scope: `readPyLines` (the CD3 globs reader) has the same
guard shape and the same untested gap.

## Acceptance
(a) `.swarm/tier3/CD4/accept.sh` ends `ORACLE PASS`. It now also checks
    that no territory file other than `parse.test.mjs` changed or appeared
    since attempt 2, that the shipped `parse()` opens no non-regular verdict
    or skip entry of the seven kinds, and that the suite fails a `never
    opens` test on each of m1, m2 and m3.
(b)–(h) and CD4.2's items as before.

## Evidence
`.swarm/manifests/CD4.3.files` and `.swarm/manifests/CD4.3.sha256` (all 11
territory files, written after your last edit).
