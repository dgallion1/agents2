# CD4 — the Codex lane in the gate, the dashboard and the docs (Tier 3)

Run CD, agents2 worktree `/home/darrell/work/agents2/.claude/worktrees/unifi-camera-streaming-7be695`,
branch `claude/codex-checker-lane`. Base = the tree after CD1, CD2 and CD3
are accepted (CD4 is dispatched only then). SPEC.md §1 (D1–D6), §3d,
rulings CD-e, CD-i (docs), CD-p (this brief's reconciliation with surface
census CD4.1 — the numbered rules below are the pinned versions).

## Background
`swarm/codex-check.sh` (CD1) writes, per (task, attempt), exactly one of:
- `verdicts/<t>.<a>.checker-codex.verdict` — `VERDICT: PASS|FAIL`,
  `CHECKER: checker-codex`, `FAMILY: crossvendor`, `TASK`, `ATTEMPT`,
  `MANIFEST_SHA256`, `CODEX_MODEL`, `CODEX_VERSION`, `---`, evidence;
- `verdicts/<t>.<a>.checker-codex.skip` — `REASON: <one of the list below>`,
  `DETAIL: <one line>`, `TASK`, `ATTEMPT` (no `---`).
Skip reasons: `no-exclude-policy no-criteria no-evidence no-codex
docker-unavailable unsafe-tree fingerprint-mismatch container-error auth
quota timeout schema-invalid evidence-free-pass secret-leak codex-error`.
Today the gate rejects `FAMILY: crossvendor` as invalid and never reads
`.skip` files. The trial rule (D2): a Codex FAIL counts, a Codex PASS never
does, an outage never blocks.

## Gate (`swarm/gate.sh`) and its mirror (`dashboard/lib/parse.mjs`)
1. **Identity.** `crossvendor` is a valid `FAMILY` ONLY together with
   `CHECKER: checker-codex`, and `checker-codex` is valid ONLY with
   `FAMILY: crossvendor` — any other pairing is an invalid verdict file
   (same consequences as CD2's pairing rule). Everything below keys on the
   CHECKER name `checker-codex`.
2. **The checks column.** `codex` may appear at any tier. It never counts as
   a named checker: a column whose only entry is `codex` is refused exactly
   like a blank one (tiers 1–3).
3. **Evidence when `codex` is named.** The CURRENT ledger attempt must hold a
   valid `checker-codex` verdict (PASS or FAIL) OR a valid
   `checker-codex.skip` record — else refused with
   `missing checker-codex evidence (attempt N)`. This presence test is the
   ONLY thing a Codex PASS does. Evidence at an older attempt does not
   count. A valid skip record is a REGULAR file (non-regular ones are never
   opened and count as absent) whose FIRST `REASON:`, `DETAIL:`, `TASK:` and
   `ATTEMPT:` lines (the gate's first-match header rule — the dashboard must
   parse `.skip` files the same way) give: `REASON` one of the 15 listed
   reasons, a non-empty `DETAIL`, and `TASK`/`ATTEMPT` equal to the
   filename's. A valid verdict AND a valid skip record at the same attempt →
   refused (tampering fails closed). An invalid verdict file keeps its
   existing consequences (tiers 2/3 hard fail; tier 1 fails a named file).
   This evidence test runs at every tier before the PASS/dispute logic.
4. **A Codex PASS never counts** — named or not, at any tier: it is excluded
   from every named-checker requirement and from every lane count (tier-2
   `second` span, tier-3 two-lane rule). It still needs `MANIFEST_SHA256`
   (the existing check on `checker-*` PASS applies unchanged).
5. **A Codex FAIL is a FAIL** wherever the file is loaded: tier 1 when
   `codex` is named (`checker-codex returned FAIL`); tiers 2/3 always (the
   dispute path — judge panel — applies unchanged); escalation
   (two-consecutive-fails) and `stats` first-attempt outcomes count it.
6. **When `codex` is NOT named:** tier 1 ignores `checker-codex` files like
   any unnamed file; tiers 2/3 load valid `checker-codex` verdicts (a FAIL
   counts per rule 5; a PASS never counts per rule 4); `.skip` records are
   ignored entirely.
7. **`stats`.** Each per-task line of the `first-attempt=` shape gains, at
   its END, ` codex=<X> second=<Y>` for the ledger's CURRENT attempt:
   X ∈ `PASS|FAIL|skip:<reason>|none` (from valid files only; a valid
   verdict wins over a skip), Y ∈ `PASS|FAIL|none` (`checker-second`).
   No-change and no-evidence lines are unchanged. After the existing
   summary lines, one more line:
   `codex: ran <n>/<m>, FAIL <k>, same-verdict-as-second <j>, codex-only FAIL <c>`
   over every (row, attempt) pair with attempt 0..the ledger attempt that
   holds a valid `checker-codex` verdict or skip record (files owned by the
   row's task — no dot-prefix sibling leakage): m = such pairs; n = those
   with a verdict; k = those whose verdict is FAIL; j = those with a valid
   `checker-second` verdict at the same attempt whose VERDICT equals
   Codex's; c = those with a Codex FAIL and no `checker-second` FAIL at that
   attempt. With no pairs: `codex: ran 0/0, FAIL 0, same-verdict-as-second 0, codex-only FAIL 0`.
   Rows with status `no-change` are excluded from the `codex:` line exactly
   as they are from first-attempt counting.
   `elapsed=` is unchanged (a Codex verdict's mtime counts like any verdict's).
8. **The dashboard mirrors rules 1–6 exactly** (gate `check` exits 0 ⇔
   `derived.state === 'accepted'`), incl. `derived.familiesPassed` excluding
   Codex PASSes (it must equal the gate's lane set) and a mismatch message
   naming `missing checker-codex evidence` when that is the cause; `parse()`
   never throws on a directory, FIFO or mode-000 `.skip` entry. `render.mjs`
   stays unchanged.
9. **`done`** refuses exactly what `check` refuses (it already runs
   `check_task`); keep it that way.

## Docs
- `CLAUDE.md`: in the Tier 2 / Tier 3 sections — the Codex trial (name
  `codex` in `checks` beside `second` on every Tier-3 task and every Tier-2
  task naming `second`; the trial rule; the lead writes
  `.swarm/codex/<t>.<a>.criteria.md` — the same criteria the Claude
  checkers get, never the census — then runs `swarm/codex-check.sh <t> <a>`
  after the worker's evidence exists; the lead never writes a Codex verdict
  or skip record). In Phase 0 — every run writes `.swarm/codex.exclude`
  (budget2 runs list `PLANNING_LOG.md`; agents2 runs list `docs/runs/` and
  `*.png`). In ACTIVE EXPERIMENT — `codex` joins the attribution
  mechanisms, and `gate.sh stats`' `codex:` line is reported verbatim at
  the end of a run. In the run-record practice — `.swarm/codex/**` is never
  archived to `docs/runs/` verbatim. The CD3 rule: a present-but-unreadable
  `critical.globs`, `test.globs` or manifest escalates
  (`critical-glob-unreadable`); only an absent file keeps its old meaning.
- `TIERS.md` and `README.md`: the same, briefly; README no longer says
  there is no second vendor (the Codex lane is one, in trial).
- Also correct every existing statement the Codex lane falsifies (surface
  census CD4.1): CLAUDE.md's valid-FAMILY-values sentence, the "PASS from
  EVERY named checker" sentence (codex is the exception), the Tier-1 blank
  column sentence (codex does not count), the Phase-0 `mkdir` line (add
  `.swarm/codex`), and the "all lanes / all agents on Claude" lines; README's
  "no second vendor", "every role authenticates the same way your `claude`
  CLI does", "not a second vendor", "All lanes run on Claude" and the
  now-false "inline escalation triggers not mirrored" (the dashboard mirrors
  them since GH2); TIERS.md's "a PASS from every one named" and the CD3
  fail-closed rule where critical.globs is documented. CLAUDE.md also says:
  if `swarm/codex-check.sh` cannot record an outcome (exit 1, or a killed
  run), re-run it — a row naming `codex` needs a record.
- `smoketest/doc_test.sh`: pins for the new doc statements, written so they
  FAIL against today's CLAUDE.md/TIERS.md/README.md (the oracle checks that).

## Territory
CD4 may change: `swarm/gate.sh`, `dashboard/lib/parse.mjs`,
`dashboard/test/parse.test.mjs`, `smoketest/gate/**`, `smoketest/doc_test.sh`,
`CLAUDE.md`, `TIERS.md`, `README.md`. Nothing else (not CD1's
`swarm/codex*` files, not `render.mjs`, not the agent briefs).

## Acceptance criteria
(a) `.swarm/tier3/CD4/accept.sh` ends `ORACLE PASS`.
(b) `bash smoketest/gate/run_tests.sh` → ALL PASS.
(c) `node --test dashboard/test/*.test.mjs` → 0 fail.
(d) Rules 1–8 hold in the gate and parse.mjs, at every tier.
(e) Integration: a verdict and a skip record produced by the real
    `swarm/codex-check.sh` (with a stub Codex) are accepted by the gate
    under the rules; a harness-written Codex FAIL is refused as a FAIL.
(h) The shipped tests catch the old behaviour: `smoketest/gate/run_tests.sh`
    fails against the pre-CD4 `swarm/gate.sh`, and the dashboard suite
    against the pre-CD4 `parse.mjs`, on tests whose names or FAIL lines
    mention codex.
(f) The docs state everything in "Docs"; `doc_test.sh` pins it.
(g) Only CD4-territory files change.

## Evidence
`.swarm/manifests/CD4.1.files` and `.swarm/manifests/CD4.1.sha256`.
