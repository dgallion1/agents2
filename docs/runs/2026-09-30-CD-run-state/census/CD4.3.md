CENSUS: CD4
ATTEMPT: 3
---
Advisory input, not a verdict. Evidence from throwaway fixtures/mutant copies under the session scratchpad (never the repo tree, no Docker, no Codex).
Node v24.12.0, non-root (uid 1000). "opens=N" = count of fs.openSync/fs.readFileSync calls whose path string equals the entry's path.

## Consumers
dashboard/lib/parse.mjs:355-373 — readVerdictEntry: lstatSync(357), statSync().isFile() GUARD (364), openSync O_RDONLY|O_NONBLOCK (365), fstatSync(fd) (366), readFileSync(fd,'utf8') (367), closeSync (371). The ONLY opener of a `*.verdict` entry in parse() — read — in-scope
dashboard/lib/parse.mjs:381-411 — parseAllVerdicts: sole caller of readVerdictEntry; a name not matching VERDICT_FILENAME_RE (388-396, e.g. `.target`/`.fifo` helper entries, `.skip`) never reaches it — read — in-scope
dashboard/lib/parse.mjs:45-52 — listDirIfExists(verdicts): readdirSync opens the DIRECTORY, not an entry; rethrows non-ENOENT — read — out-of-scope (not an entry open)
dashboard/lib/parse.mjs:36-43 — readFileIfExists: path-based readFileSync, NO stat guard, NO O_NONBLOCK; callers ledger.tsv (89), flags/<id>.flag (570), tier3/<id>/oracle.<n>.log (961), spend.jsonl (998). Rethrows non-ENOENT (a directory there throws parse(); a FIFO would block) — read — out-of-scope (not `*.verdict`; brief is verdict-only)
dashboard/lib/parse.mjs:143-155 — parseManifest: isFile() then path readFileSync (no O_NONBLOCK; stat->read race window) — read — out-of-scope
dashboard/lib/parse.mjs:170-192 — parseFingerprint: same shape as parseManifest — read — out-of-scope
dashboard/lib/parse.mjs:515-537 — parseCodexSkip on verdicts/<id>.<a>.checker-codex.skip: same stat-guard(520)/NONBLOCK open(521)/fstat(522)/readFileSync(fd)(523) shape as readVerdictEntry. Guard removal alone survives the dashboard suite 126/126 (verified, copy n3) — read — out-of-scope (a `.skip`, not `*.verdict`)
dashboard/lib/parse.mjs:678-693 — readPyLines (critical.globs, test.globs, every manifests/<id>.*.files): same shape, guard at 681. Guard removal alone survives 126/126 (verified, copy n4) — read — out-of-scope
dashboard/lib/parse.mjs:54-81, 944-948, 958, 963, 870 — isDirectory/isFile/entryExists/isExecutable/existsSync/accessSync: stat/lstat/access only, no open — read — n/a
dashboard/lib/parse.mjs (whole file) — no fs.promises, createReadStream, fs.open/readFile callbacks, opendirSync; `fs` is the default import `import fs from 'node:fs'` (17-19), every call is a call-time property lookup `fs.X(...)`; no function captured at import time — read+grep — n/a
dashboard/server.mjs:236 — fs.watch(SWARM_DIR,{recursive}) only; server.mjs and render.mjs read no .swarm entry (verdictObj.path is carried, never read) — read+grep — out-of-scope
swarm/gate.sh load_verdict `[[ -f ]]` (bash side of the same property; "never opened" there is likewise only pinned by no-hang tests, run_check.sh:722-723, 848) — out-of-scope (brief: dashboard only)
dashboard/test/parse.test.mjs:2125-2135 — parseInChild: `node --input-type=module -e` with a STATIC `import { parse }`, JSON out, 20 s spawnSync timeout. Cannot be reused for "instrument before import" (static import hoists); a new helper is needed — read — in-scope (the file the worker edits)
dashboard/test/parse.test.mjs:2671-2678 — NON_REGULAR_ENTRIES has SIX kinds; the 6th is a mode-000 REGULAR file (non-root only). Shipped code DOES open it (opens=1, correct by design), so reusing this array under a "count is 0" assertion fails on the shipped tree — read — in-scope
dashboard/test/parse.test.mjs:2102, 2240, 2548 — tests named "(never opened)" that pin only no-hang/no-throw (not a count). "never opened" does not match N2's `never opens` — read — out-of-scope
dashboard/test/parse.test.mjs:2680 — existing names "…neither throws nor hangs on ${kind}…"; none contains "never opens" (grep + read) — read — in-scope

## Brief claims
CD4.3.md "readVerdictEntry checks fs.statSync(filePath).isFile() BEFORE fs.openSync" — CONFIRMED — parse.mjs:364 then 365
CD4.3.md the quoted line `if (!fs.statSync(filePath).isFile()) return { error: 'not a regular file' };` — CONFIRMED — parse.mjs:364, 4-space indent, exactly one line matches `grep -cxF`; the other two statSync guards end `return null` (520, 681)
CD4.3.md "keeps the O_NONBLOCK open and the fstat re-check, so nothing hangs or throws and the entry is still classified invalid" — CONFIRMED — mutant copy v0: all 5 kinds state=blocked, no hang/throw
CD4.3.md "dashboard suite stays 126/126" under the mutation — CONFIRMED — mutant copy n2: ℹ tests 126, pass 126, fail 0
CD4.3.md "fs.openSync counter shows 1 open instead of 0" — CONFIRMED — shipped: opens=0 for FIFO; mutant: opens=1 (also directory, dangling, loop, symlink-to-FIFO)
CD4.3.md "(as the existing 'neither throws nor hangs' tests do)" child + timeout — CONFIRMED — parse.test.mjs:2125-2135, 2680
CD4.3.md "no shipped test pins 'never opens'" — CONFIRMED — grep "never opens"/"openSync" in dashboard/test: none counts opens
CD4.3.md "(a)... accept.sh now also checks that only parse.test.mjs changed since attempt 2" — PARTLY CONTRADICTED — N0 (accept.sh:183-192) hashes only the 11 files in .swarm/manifests/CD4.2.sha256 (all 11 currently match); territory files outside those 11 (smoketest/gate/run_tests.sh, smoketest/gate/agents_test.sh, any NEW file under smoketest/gate/**, SPEC.md, .swarm/*) are skipped by S's terr() (accept.sh:20) and not in the sidecar
CD4.3.md "Evidence: all 11 territory files" — CONFIRMED — CD4.2.files has 11 lines; CD4.1.md Territory lists `smoketest/gate/**` (6 files; 4 are in the 11, agents_test.sh and run_tests.sh are not)
SPEC.md CD-z "an fs.openSync counter shows the mutant opens the FIFO once, the shipped code zero times" — CONFIRMED — never-open.mjs run both ends
CD4.2.md item 2b "never open a non-regular *.verdict entry" — CONFIRMED vs shipped (never-open.mjs on shipped tree: 5/5 opens=0; extra kinds symlink-to-dir, symlink-to-/dev/null, 2-link chain to FIFO also opens=0)

## Oracle gaps
N0 passes today (verified: all 11 sidecar hashes equal the tree). Gap: files outside the 11 are not covered (see claim above).
N1 passes today (verified, rc=0, 5/5 opens=0 state=blocked). N1 tests only the shipped parse.mjs, not the worker's test.
N2 fails today for the right reason (verified: mutant applied with exactly one line removed per difflib; suite 126/126, nf=0, so `[[ "$nf" -gt 0 ]]` is false). Not a harness error.
N2's grep matches the node v24.12.0 non-TTY reporter (spec): `✖ <name> (N ms)` lines, and the end-of-run "failing tests:" block repeats them. Verified with a toy suite and with a 5-test prototype (copy in scratchpad proto/): on the mutant 5/5 `✖ ... never opens ...`, grep MATCH; on shipped 5/5 pass. Requires the test NAME to contain the literal `never opens` (not "never opened", "never-open", "never open").
N2 pins ONE mutant (guard removed). Nothing asserts the worker's test builds all five kinds or counts readFileSync; a FIFO-only test satisfies N2.
Mutants that survive a five-kind, openSync+readFileSync count-0 test (verified where noted): (a) guard narrowed to isFIFO()||isDirectory() — five kinds opens=0 but a symlink to /dev/null opens=1 (copy v4); (b) a guard-free "resolve then open" via realpath — symlink-to-FIFO reports 0 while the target FIFO opens (copy v3), though FIFO/directory kinds still catch it overall; (c) named/namespace import of openSync in an ESM child that did `import fs from 'node:fs'` before patching (copy v2: n=0; the CJS `-e` child and an ESM child using syncBuiltinESMExports() or createRequire do see it); (d) opens by readdirSync/opendirSync/createReadStream (not instrumented); (e) removal of O_NONBLOCK or of the fstat re-check (unreachable with static non-regular fixtures; needs a stat-then-swap hook).
