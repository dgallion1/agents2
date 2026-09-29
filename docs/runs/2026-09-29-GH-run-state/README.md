# Run GH — land the 2026-09-18 gate hardening (2026-09-29)

Target: agents2 itself, branch `claude/gate-hardening` over master cae89ff.
Two Tier-3 tasks, both worker-coder, both accepted at attempt 1.

- **GH1** — ported the uncommitted 2026-09-18 hardening (built lead-direct
  in worktree `agents2-review-verification-de0532`, never committed or
  checked by a non-author) onto master: tier 3 honours the `checks` column;
  inline escalation triggers in `check`/`done`; tier-1 blank checks fails;
  legacy blind-arm `report.md` contract and scripts removed; manifest
  `.sha256` fingerprints with `MANIFEST_SHA256` on every checker PASS and a
  tree re-hash at `check`; checker-second scored on evidence; `stats` counts
  overruled FAILs clean and reports escalations/elapsed; CLAUDE.md Phase 0 /
  final pass scaled to the run. 39 files; the one merge conflict was
  CLAUDE.md (master's Superpowers section kept verbatim).
- **GH2** — added after GH1's checkers showed the port would make the
  dashboard say `accepted` for rows the new gate refuses: `parse.mjs` now
  mirrors the gate's three inline triggers and their precedence.

Why now: the Codex alongside-checker run (CD) changes the same files; the
gate it is designed against had to be settled first.

## Outcome (gate.sh, verbatim)

```
OK: GH1 accepted at tier 3 (attempt 1)          (ported gate and frozen master gate)
OK: GH2 accepted at tier 3 (attempt 1)          (ported gate and frozen master gate)
OK: all tasks accepted, evidence verified, no unresolved flags   (done, both gates)
stats: GH1 tier=3 first-attempt=1 clean (now: status=accepted attempt=1) elapsed=0h12m
stats: GH2 tier=3 first-attempt=1 clean (now: status=accepted attempt=1) elapsed=0h27m
first-attempt clean: 2/2 (no-evidence rows: 0)
escalated: 0/2
elapsed total: 0h40m (sum of per-task evidence spans)
```

Acceptance required BOTH master's gate (frozen at cae89ff) and the ported
gate. The ported gate requires fingerprints, so the run dogfooded the new
contract: every checker PASS carries `MANIFEST_SHA256`.

## Catches, by mechanism (full text: SPEC.md §7)

| Ruling | What | Mechanism |
|---|---|---|
| 29a | Criterion (e) demanded ACTIVE EXPERIMENT text verbatim while a source hunk edits it | oracle authoring (lead, pre-dispatch) |
| 29b | Criterion (c)'s `node --test dashboard/test/` does not run the suite on Node 24 | oracle calibration vs master (lead) |
| 29c | Reference sweep flagged `docs/superpowers/` history | oracle pass-end validation (lead) |
| 29e | Port creates a dashboard/gate disagreement on inline triggers → task GH2 | primary checker, confirmed by second checker; lead-reproduced |
| 29f | A judge-named PASS supplies a lane at tier 3 (both gates) | second checker; lead-reproduced; → run CD |
| — | GH2 oracle check C3 was satisfiable by a comment; replaced with a mutation kill | lead, pre-dispatch |
| 29g | GH2 oracle's D scenarios alone miss 3 mutants (shipped tests catch them) | primary checker |
| 29g/B1 | Gate fails OPEN when critical/test globs or a manifest is unreadable or non-UTF-8 | second checker |

Every catch was against a lead artifact (spec wording, oracle coverage) or a
pre-existing design gap — none against worker output. Both workers were
clean on the first attempt.

## Integration and models

#39 (surface census) landed on master mid-run and conflicted with six GH1
files; merged into the branch before PR #40 merged (ruling 29h). Only
`smoketest/doc_test.sh` needed hand resolution (union). On the merged tree
every oracle probe and consumer check still passes; only the scope checks
fail, listing exactly #39's files and this record. Models actually run
(transcript `model` field): lead and both checker-tests on
`claude-opus-5-5`; workers, checker-second and checker-a11y on
`claude-sonnet-5-5`.

## Backlog

See SPEC.md §7 (29f, backlog lists after 29d and 29g). Highest priority:
**B1 gate fail-open** and the **judge-named-PASS lane** (29f, for CD). Also:
dashboard/gate header-parser leniency, flag `TARGET_TIER` parsing, EISDIR on
a flag directory, stale text (`parse.test.mjs:693`,
`smoketest/e2e/RUNBOOK.md:17-18`), `.files` not itself fingerprinted,
`report.md` as a directory/dangling symlink, default-test-glob coverage.

Process lessons: concurrent checkers share the session scratchpad — briefs
must name a unique subdirectory (one checker's `mut/` was deleted by
another). The dashboard test suite leaves `dash-parse-test-*` dirs in TMPDIR.

## Files

`SPEC.md`, `ledger.tsv`, `critical.globs`, `manifests/`, `verdicts/`,
`tier3/GH1/` (oracle, its run log, both-end calibration logs, source
fingerprints) and `tier3/GH2/` (oracle + `differential.mjs`, run log,
calibration logs). The source patch and GH1's frozen `parse.mjs` are not
archived — both are recoverable from git (the commit's diff; cae89ff+GH1).
