# CD2 — lane accounting: only the right identities may cast each verdict (Tier 3)

Run CD, agents2 worktree `/home/darrell/work/agents2/.claude/worktrees/unifi-camera-streaming-7be695`,
branch `claude/codex-checker-lane`, base 12f6413. SPEC.md §3b; ruling GH-29f
(`docs/runs/2026-09-29-GH-run-state/SPEC.md`).

## Problem
`swarm/gate.sh` accepts a PASS verdict from any identity. Reproduced
(GH ruling 29f): a tier-3 row with `checks=tests`, a `checker-tests` PASS
(FAMILY anthropic) and a file `verdicts/<t>.1.judge-x.verdict` saying
`VERDICT: PASS`, `FAMILY: adversarial` (no MANIFEST_SHA256) is accepted —
the judge-named file supplies the second lane, and the fingerprint check
skips it because it only inspects `checker-*` PASS verdicts.

## Rule (both the gate and its mirror)
A verdict file is VALID only if its VERDICT/CHECKER pairing is allowed:
- `PASS` or `FAIL` — only when CHECKER starts with `checker-`;
- `UPHOLD` or `OVERRULE` — only when CHECKER starts with `judge-` or is exactly `boss`.
Any other pairing makes the file INVALID, with a message naming both, e.g.
`VERDICT PASS not allowed from CHECKER 'judge-x' (PASS/FAIL come from checker-*; UPHOLD/OVERRULE from judge-* or boss)`.
Invalid files already have defined consequences everywhere and those stay
as they are: at tiers 2/3 any invalid current-attempt file hard-fails the
row; tier 1 loads only the named checkers' files; escalation helpers,
`stats` and `any_verdict_exists` treat invalid files as they already do.

## Where
- `swarm/gate.sh` — `load_verdict` (the single validator every path uses).
- `dashboard/lib/parse.mjs` — `validateVerdictRecord` (its mirror); the
  dashboard's anti-lie property (gate `check` exits 0 ⇔ `derived.state ===
  'accepted'`) must keep holding.
- Tests: `smoketest/gate/*.sh` (add cases; fix any fixture that relied on a
  now-invalid pairing) and `dashboard/test/parse.test.mjs` (unit tests +
  `DIFFERENTIAL_SCENARIOS` covering the rule).
- Nothing else. `dashboard/lib/render.mjs` unchanged. Docs are CD4's.

## What the rule reaches (surface census CD2.1)
Put the rule in `load_verdict` so every consumer sees it: `walk_verdicts`,
`has_fail_at` (a judge- or boss-cast FAIL no longer counts toward
two-consecutive-fails), `judges_overruled_at` (a checker-cast UPHOLD/OVERRULE
no longer counts toward the panel that sets a FAIL aside), `overrule_exists`,
`any_verdict_exists`, `stats` and `done`. The dashboard's trigger mirror (GH2)
reads only validated verdicts, so validating in `validateVerdictRecord`
carries through. Identity matching is EXACT: `checker-` and `judge-` are
prefixes including the dash; `boss` is the whole name (not `boss-2`, not
`Boss`); anything else (e.g. `worker-coder`, `lead`) may cast nothing.
Update the now-stale comments in both files. Known PRE-EXISTING gate/dashboard
splits (GH backlog — out of scope, do not fix, and keep them out of your
differential scenarios): the gate reads the FIRST `KEY:` line while
parse.mjs reads the LAST header before `---`; the gate refuses duplicate
judge FAMILY among UPHOLD/OVERRULE even with no FAIL, the dashboard only
when a FAIL exists (so never pair a current-attempt `boss` vote with a
same-family judge in a no-FAIL scenario).

## Territory (a concurrent task shares this tree)
CD2 may change ONLY: `swarm/gate.sh`, `dashboard/lib/parse.mjs`,
`dashboard/test/parse.test.mjs`, files under `smoketest/gate/`.
Foreign territory of task CD1 (running at the same time — do not touch, do
not FAIL on it): `swarm/codex-check.sh`, `swarm/codex/**`, `smoketest/codex/**`.
`SPEC.md` is the lead's.

## Acceptance criteria
(a) `.swarm/tier3/CD2/accept.sh` ends `ORACLE PASS`.
(b) `bash smoketest/gate/run_tests.sh` → ALL PASS.
(c) `node --test dashboard/test/*.test.mjs` (repo root) → 0 fail.
(d) The rule holds in the gate and in parse.mjs for every pairing, at every
    tier, with the consequences above unchanged.
(e) The shipped tests catch the old behaviour: `smoketest/gate/run_tests.sh`
    fails against the base (12f6413) `swarm/gate.sh`, and the dashboard
    suite fails against the base `dashboard/lib/parse.mjs`.
(f) Only CD2-territory files change; `render.mjs` byte-identical to base.

## Evidence
Manifest `.swarm/manifests/CD2.1.files` (every path you changed) and
`.swarm/manifests/CD2.1.sha256` (`sha256sum` of each), written after your
last edit.
