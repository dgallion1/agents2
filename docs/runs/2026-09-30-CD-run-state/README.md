# Run CD — Codex as an alongside checker lane (2026-09-29 → 2026-09-30)

Target: agents2 itself, branch `claude/codex-checker-lane` over master
12f6413 (#40, run GH). Four Tier-3 tasks, all worker-coder, all accepted.
Phase 0 decisions (user): Codex runs ALONGSIDE `checker-second`, never
instead of it; the trial rule — a Codex FAIL counts, a Codex PASS never
does, an outage never blocks; a data-free copy of the tree in a container
with an egress allowlist; both gate defects found while designing it fixed
as separate tasks; `PLANNING_LOG.md` excluded. Model switched to
`gpt-6-sol` before the first counted verdict (user, CD-v).

- **CD1** — `swarm/codex-check.sh` + `swarm/codex/**`: runs the user's Codex
  CLI in a container (private CODEX_HOME, read-only auth, internal network,
  tinyproxy allowlist chatgpt.com/auth.openai.com/api.openai.com) against a
  data-free copy of the tree; writes exactly one verdict
  (`FAMILY: crossvendor`) or skip record (15 fixed reasons); keep-or-drop
  audit dir with no secret in any recognised form; freshness gate so Codex
  never rotates the user's refresh token in the container. Accepted at
  attempt 4 after a hard stop and two user reopens (CD-j…CD-u).
- **CD2** — gate: PASS/FAIL only from `checker-*`, UPHOLD/OVERRULE only from
  `judge-*`/`boss` (gate + dashboard). Attempt 1.
- **CD3** — critical-glob evaluation fails CLOSED (`critical-glob-unreadable`).
  Attempt 1.
- **CD4** — the Codex lane in the gate, the dashboard mirror and the docs
  (crossvendor pairing, `codex` in `checks`, `.skip` records as evidence,
  the trial rule, `stats` fields + `codex:` line, CLAUDE.md/TIERS.md/README).
  Accepted at attempt 3 (CD-w…CD-ac).

## Outcome (gate.sh, verbatim)

```
OK: CD1 accepted at tier 3 (attempt 4)          (tree gate and frozen master gate 12f6413)
OK: CD2 accepted at tier 3 (attempt 1)          (both gates)
OK: CD3 accepted at tier 3 (attempt 1)          (both gates)
OK: CD4 accepted at tier 3 (attempt 3)          (both gates)
OK: all tasks accepted, evidence verified, no unresolved flags
stats: CD1 tier=3 first-attempt=1 failed (now: status=accepted attempt=4) elapsed=17h50m codex=none second=PASS
stats: CD2 tier=3 first-attempt=1 clean (now: status=accepted attempt=1) elapsed=0h35m codex=none second=PASS
stats: CD3 tier=3 first-attempt=1 clean (now: status=accepted attempt=1) elapsed=0h32m codex=none second=PASS
stats: CD4 tier=3 first-attempt=1 failed (now: status=accepted attempt=3) elapsed=7h16m codex=none second=PASS
first-attempt clean: 2/4 (no-evidence rows: 0)
escalated: 0/4
elapsed total: 26h15m (sum of per-task evidence spans)
codex: ran 0/0, FAIL 0, same-verdict-as-second 0, codex-only FAIL 0
```

The run's own ledger never names `codex` (master's gate rejects
`crossvendor`, so CD4 could not dogfood itself — CD-p). The Codex trial ran
on CD4 in a COPY, `.swarm-codex-trial/`, evaluated by the new gate:

```
codex: ran 2/2, FAIL 1, same-verdict-as-second 1, codex-only FAIL 1
```

- CD4 attempt 2 (accepted by both Claude lanes) → **Codex FAIL, verified
  true**: `parse()` never opens a non-regular verdict entry, but no test
  pinned it — a mutant that opens a FIFO kept the suite 126/126. The user
  reopened CD4 for that one test (CD-z, CD-aa).
- CD4 attempt 3 → Codex PASS, agreeing with both Claude lanes (CD-ad).
- Live calibrations: `gpt-6-astra` (CD-f, found the unmounted code-mode
  host) and `gpt-6-sol` on `codex-cli 0.159.0` (CD-v). Auth file
  byte-identical across every real run.

## Catches, by mechanism (full text: SPEC.md §8 Rulings)

- **census** — CD1.1/1.3/1.4, CD3.1, CD4.1/4.2/4.3: every pre-dispatch
  census changed the brief or the oracle. Notable: the CD1.4 draft
  over-reached the user's "label fix" (CD-s); the CD4.2 draft claimed the
  dashboard already handled non-regular entries — it threw on them and hung
  on a FIFO (CD-x); CD4.3 widened the one test to the skip record and a
  device kind (CD-ab).
- **oracle** (lead calibration) — the first A4 group-signal barrages never
  reproduced G1 (fired before teardown); redesigned to fire during
  `compose down` (CD-s).
- **primary checker** — CD1 a1 (secret hygiene), a2 (PATH_MAX scrub), a3
  (secrets in `env` argv; absolute paths in DETAIL); CD4 a1 (locale split,
  dangling-link split, a false doc sentence).
- **second checker** — CD1 a2 (signal during cleanup), a3 (process-group
  signals kill `compose down`); CD4 a1 (locale split, same defect).
- **codex** — CD4 a2: the untested "never opens" property (codex-only).
- **worker (own test)** — CD1 a4: an INT→TERM ordering race the brief's own
  exit-code pin required fixing (CD-t).
- **gate** — no catch of its own this run; every acceptance was checked
  under the tree gate and the frozen master gate.

## Models (from the subagent transcripts)

Lead `claude-opus-5-5`; checker-tests `claude-opus-5-5`; worker-coder,
checker-second, surface-census `claude-sonnet-5-5`. Codex: `gpt-6-astra`
(calibration only), then `gpt-6-sol`, `codex-cli 0.159.0`.

## Backlog (from rulings CD-q, CD-u, CD-w, CD-y, CD-ac)

- Harness: a caller-exported `SECRETS_JSON`/`res`/`r1` keeps its export
  attribute (`declare +x` at the top); SIGQUIT untrapped; the wait loop forks
  `sleep` 5×/s; `dropped.txt` unbounded; duplicate-key auth JSON keeps the
  last value; the `codex-check.sh` header still says "only after task CD4".
- Gate/dashboard: verdict-HEADER parsing splits (gate `field_of` locale and
  first-match vs the dashboard's Unicode trim and last-match — CD-h class);
  trailing comma in `checks`; tier-1 judge-identity check on the dashboard
  only (F-1) and duplicate-family judges at tiers 2/3 (F-2); `readPyLines`
  has the same untested "never opens" gap; the `never opens` counter matches
  the entry path, so a resolve-then-open mutant evades it (count by opened
  file type instead).
- Docs: `swarm/start.sh` still says "no second vendor".

## What is not in this record

`.swarm-codex-trial/codex/**` (the Codex event streams, proxy logs and file
lists of a copy of the tree) is never archived verbatim; the two Codex
verdicts, the attempt-3 criteria and the trial ledger are in `codex-trial/`.
