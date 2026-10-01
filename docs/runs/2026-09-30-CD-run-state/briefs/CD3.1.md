# CD3 — critical-glob evaluation fails CLOSED (Tier 3)

Run CD, agents2 worktree `/home/darrell/work/agents2/.claude/worktrees/unifi-camera-streaming-7be695`,
branch `claude/codex-checker-lane`. Base = the tree after task CD2 was
accepted (CD2 changed `load_verdict` / `validateVerdictRecord`). SPEC.md
§3c; GH backlog B1 (`docs/runs/2026-09-29-GH-run-state/SPEC.md`, ruling 29g).

## Problem
`manifest_hits_glob` (swarm/gate.sh) runs an embedded python that reads
`critical.globs`, `test.globs` and every `manifests/<task>.*.files`. If any
of them cannot be opened or decoded, python dies, its exit status 1 is read
as "no hit", and the escalation trigger silently disappears — the gate fails
OPEN. The dashboard mirror (`manifestHitsGlob` in dashboard/lib/parse.mjs)
copies that on purpose (its comment says so). Also silent today: a directory
at `critical.globs` counts as "no globs", a directory at `test.globs` as
"use the defaults", and a non-regular entry matching `<task>.*.files` is
skipped.

## Rule
- `critical.globs` ABSENT → no hit (unchanged). `test.globs` ABSENT → the
  default test globs (unchanged). No manifests → no hit (unchanged).
- Any of those inputs PRESENT but not a readable regular file, or not valid
  UTF-8, or failing to read for any other reason → the evaluation result is
  UNREADABLE. That applies to `critical.globs`, `test.globs`, and every
  directory entry matching the gate's glob `<task>.*.files`.
- UNREADABLE counts as a hit, with its own reason token
  `critical-glob-unreadable` (instead of `critical-glob`) in
  `escalation_reasons` — so `escalate-scan` writes a flag with that REASON,
  and `check` / `done` refuse such a row with no flag exactly as they do for
  `critical-glob`. The gate prints one diagnostic line to stderr naming the
  offending path and the word `unreadable`.
- **Pinned semantics (surface census CD3.1):**
  1. Evaluation order: `critical.globs` absent (no directory entry at all)
     → no hit; no directory entry matches `<task>.*.files` → no hit (a row
     that has not started is never flagged). Only then is anything read.
  2. PRESENT means a directory entry exists (a dangling symlink or a
     symlink loop is present). Every present input must be a regular file
     after following symlinks — anything else (directory, dangling link,
     FIFO, device) is UNREADABLE and is NEVER opened (a FIFO would block).
  3. Decoding is explicit strict UTF-8 (`encoding='utf-8'`, BOM kept, as
     the dashboard already reads it) — never the locale's default; a valid
     UTF-8 file must read the same under `LC_ALL=C`.
  4. Precedence: any unreadable input makes the whole evaluation
     UNREADABLE, even if another input produced a hit.
  5. Any failure of the evaluator itself (python3 missing or killed, any
     exit status other than hit / no-hit) is UNREADABLE — never "no hit".
  6. Diagnostic: exactly one stderr line per evaluation that is unreadable,
     containing `unreadable` and naming the first offending path (or the
     evaluator failure); nothing on clean inputs. The `FAIL:` line on stdout
     carries the token `critical-glob-unreadable`.
  7. `parse()` must not throw because the CURRENT attempt's manifest or
     sidecar is unreadable or non-regular (today it rethrows EACCES/EISDIR →
     HTTP 500); its derived state must still agree with `gate.sh check`.
  8. Update the reason-list comments (gate.sh `escalation_reasons`,
     parse.mjs) and the now-wrong "unreadable … no hit" comments.
- Everything else about the matcher is unchanged (fnmatch semantics, the
  `**/` and `/**` candidates, the test-glob exemption, CRLF/BOM handling as
  GH2 mirrored it).
- `parse.mjs` mirrors it exactly: the same inputs are unreadable, the reason
  token is the same, and the dashboard's anti-lie property (gate `check`
  exits 0 ⇔ `derived.state === 'accepted'`) holds; its mismatch names the
  reason. Update the now-wrong comments ("unreadable input … reports no hit").

## Territory
CD3 may change ONLY: `swarm/gate.sh`, `dashboard/lib/parse.mjs`,
`dashboard/test/parse.test.mjs`, files under `smoketest/gate/`. Foreign:
task CD1's `swarm/codex-check.sh`, `swarm/codex/**`, `smoketest/codex/**`
(may be mid-edit); `SPEC.md` is the lead's.

## Acceptance criteria
(a) `.swarm/tier3/CD3/accept.sh` ends `ORACLE PASS`.
(b) `bash smoketest/gate/run_tests.sh` → ALL PASS.
(c) `node --test dashboard/test/*.test.mjs` → 0 fail.
(d) The rule holds in the gate and in parse.mjs for every input kind
    (permission-denied, invalid UTF-8, a directory in place of the file), for
    `critical.globs`, `test.globs` and manifests of any attempt, at tiers 1
    and 2 (tier 3 is never blocked inline, unchanged); escalate-scan writes
    the flag with `REASON: critical-glob-unreadable`; valid inputs behave
    exactly as before.
(e) The shipped tests catch the old behaviour: they fail against the
    post-CD2 `swarm/gate.sh` and `dashboard/lib/parse.mjs`.
(f) Only CD3-territory files change.

## Evidence
`.swarm/manifests/CD3.1.files` and `.swarm/manifests/CD3.1.sha256`, written
after your last edit.
