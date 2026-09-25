# Run WS — what-if save-path integrity (budget2, 2026-09-22 → 09-24)

Opened from the 2026-09-22 read-only review of /whatif (three isolated
reviewers, lead source-verified every P1). The user chose "run A": values the
page rewrites or refuses to save, schedules that drift, a crash that bricks
the page, errors nobody sees. Five tasks, all Tier 3. `SPEC.md` here is the
constitution as of run close (D1–D8, facts, task contracts, every ruling
with the mechanism that caught it).

| Task | What | Commit | Shipped |
|---|---|---|---|
| WS1 | untouched inputs never rewrite or block the saved plan (live Rate Assumptions form was unsavable: Cost Basis 276146.86 vs `step=1000`) | a12477f (attempt 6) | simpleBudget #121 → ba952f4 |
| WS2 | a manual start-date change keeps every schedule on its calendar month | 58ad664 (attempt 1) | #120 → 72c7e7f, deployed 2026-09-24 |
| WS3 | a chain step never crashes the projection (D3′: the viewed scenario's guardrails govern the chain); a failed analysis keeps the page | 8b02147 (attempt 4) | #120 |
| WS4 | request errors show next to their form and never wipe input | c0eda67 (attempt 3) | #120 |
| WS5 | glide path saves only when complete; removing a person saves; persons errors name the right person | d9bf7ef (attempt 7) | third PR (pending at close) |

## Outcome (gate.sh, verbatim)

```
OK: all tasks accepted, evidence verified, no unresolved flags
stats: WS1 tier=3 first-attempt=1 failed (now: status=accepted attempt=6)
stats: WS2 tier=3 first-attempt=1 clean (now: status=accepted attempt=1)
stats: WS3 tier=3 first-attempt=1 clean (now: status=accepted attempt=4)
stats: WS4 tier=3 first-attempt=1 failed (now: status=accepted attempt=3)
stats: WS5 tier=3 first-attempt=1 failed (now: status=accepted attempt=7)
first-attempt clean: 2/5 (no-evidence rows: 0)
```

Fresh ledger for this run (per the 2026-09-18 gate hardening).

## Catches, by mechanism

| Task/attempt | Mechanism | What |
|---|---|---|
| all (pre-dispatch) | oracle both-ends calibration | seven lead oracle bugs: WS2 never pressed Tab (number fields save on blur); WS1 fixture wrong JSON key + missing `cola_rate_set`; `networkidle` wait → in-flight counter; WS1 1e-9 tolerance hid 1-ulp drift → exact identity; E2/E8 fixture values that never triggered the artifact; WS3 had no events/caption check |
| WS3.1 | lead review of the worker report | oracle could not see Monte Carlo adaptive spending |
| WS1.1 | primary checker | "round-trip" tests never rendered a template (all passed on base); three Quick Adjust regressions; a converted slider without aria-valuetext |
| WS1.2 | second checker (hard stop) | slider displays switched to formatDollars (half-up) while the Coverage Timeline kept formatNumber (half-even): 1800.50 showed "$1,801" and "$1,800" on one card → contract pins ONE rounding rule for Go and JS |
| WS1.3–1.5 | second + primary | 1-ulp COLA drift under the lead's tolerance; kill-list gaps; served text must be authoritative (no load-time rewrite) |
| WS1.4, WS5.1 | lead premise check vs base | two FAILs factually wrong: -0.0 unreachable (min=0); new-row blocking also on base (as a 500) |
| WS3.2 | second checker (hard stop) | chart trigger lines and caption still gated on the PRIMARY settings under per-step governance ("Cut if balance ≤ $0.00" after an on→off transition) — the contract never enumerated guardrail renderers → user decision D3′ |
| WS4.1 | a11y + primary | nested role="alert" announced every error twice; the "nearest form" fallback inserted poll-failure alerts into the page grid (results pushed ~10,650 px down) and into `<html>` |
| WS4.2 | primary + gate escalation | two single-guard mutants survived (sentinels sat under hosts both guards reject) |
| WS5.1–5.3 | a11y, primary, second, gate | glide fields required but unmarked; single-missing-field enable survived; "after start" and "unparseable" both reported as "needs a birth month" (false) → hard stop |
| WS5.4 | second checker + **judge panel, UPHELD 2–1 against the lead** | regex over %q-escaped names; judge-claude showed a browser-reachable FALSE message (`Pat\X`/`Pat\\X`) the lead had called "only polish" |
| WS5.5 | primary | %q-on-value mutation survived; NBSP case was a plain space (brief said "name or value") |
| WS5.6 | primary + second | the ` ` escape was decoded to a raw byte in the tool-call JSON → tautological guard; comment claimed the start-date error carries an ID |

Every defect that failed an attempt traces to a lead artifact (oracle, brief
wording, spec design) or a real defect a non-author checker found. The
lean-verification machinery stays.

## Lessons

1. **Identify by ID, never by error text.** WS5 failed three attempts
   (2, 3, 4) on one class — working out which person failed by parsing
   `prepare.ValidatePersons` error strings. The fix was a contract rewrite
   (typed errors carrying the person's ID), not a better regex.
2. **Non-ASCII test data does not survive a brief.** "Write it as a Go
   ` ` escape" reached the file as the raw character (tool-call JSON
   decodes it). Specify such data as ASCII construction
   (`string(rune(0x00A0))`) and check the bytes (`od -c`, `grep -c
   $'\xc2\xa0'`) before dispatching checkers.
3. **Name every mutation separately.** "%q on the name or the value" was read
   as either one.
4. **Premise-check before overruling, and expect to lose.** The lead's
   overrule instinct was right twice (checked against base) and wrong once
   (WS5.4) — the panel exists for exactly that.
5. **Throttle heavy verification.** A checker's parallel 327-mutation harness
   drove load to 173 on 32 cores; every brief now carries `nice -n 19`,
   `GOMAXPROCS=4`, `-p=2`, one test process, targeted mutations only.
6. **The rtk hook rewrites bare `diff`.** Compare files with python/`cmp`.

## Backlog (recorded, not fixed)

- F1: the healthcare cost clamp still makes round trips lossy (user kept it).
- WS1: Go test pins the aria attribute's value not its element; node test
  does not assert the QA range's aria text; accurate client preview would
  need one-formula parity tests; `step="any"` arrow-key granularity.
- WS3: events "% of plan" arithmetic has no absolute-value test.
- WS4: exact-string role assertion; healthcare slot role untested;
  `make check` never runs the node tests; `reportValidityOfForms` is
  sitewide; `hasOwnHxVerb()` drop survives.
- WS5: removal clicked during an in-flight save is dropped (base too);
  Remove buttons' accessible name lacks the person; focus after a successful
  removal falls to `<body>` (base too); siblings S1/S2 survive.
- Derived age shows "Age 18307" on an invalid start date; QA
  investment-return light-mode contrast; guardrails summary contrast
  (pre-existing).

## Contents

`SPEC.md`, `ledger.tsv`, `critical.globs`, `manifests/`, `verdicts/`
(including the judge panel's WS5.4 votes and the final sweep's
`WS-final.1`), `final-a11y-sweep.md` (full-site sweep at close: no
violations introduced by run WS — every axe finding reproduces node for
node on base 643fa54), `tier3/` (oracles, probes, validation and attempt
logs; `integration/*.integration3.log` = all five oracles PASS on d9bf7ef).
Per-attempt diffs are not archived; the accepted code is in the simpleBudget
commits above. The oracles build fixtures at run time from an anonymised
copy of the live plan (`tier3/lib/base_plan.py`); no plan data file is
archived.

Final pass: `bash smoketest/gate/run_tests.sh` → ALL PASS; `gate.sh done`
exit 0.
