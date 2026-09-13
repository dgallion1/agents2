# SPEC.md — Spending plan: restore every form value after a reload (SP run)

Run prefix: **SP**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **94820b7** (master,
2026-09-13, PR #110). Implementation worktree
`.worktrees/spending-plan-restore` on branch `fix/spending-plan-restore`.
All manifest paths and globs are budget2-repo-relative. This run's
`.swarm/` lives in THIS agents2 worktree (gitignored).

## 0. Status — autonomous bug fix, 2026-09-13

User report (verbatim): "Not all values in the spending plan are restore
after a reload."

## 1. Diagnosis (evidence, not vibes)

Rendered `/whatif` on the live server (94820b7) against `data/settings/
whatif.json`:

| Form field (`#spending-optimizer-form`) | Saved on Apply? | Restored on reload? |
|---|---|---|
| `floor_monthly_real` | yes (`Guardrails.MinMonthlySpendingReal`) | yes (6000.00) |
| `boost_enabled` / `boost_monthly_real` / `boost_stop_month` | yes (`LivingSpendingBoost`) | yes |
| `max_shortfall_pct` | **no** | **no** — template hardcodes `value="5"` |
| `near_term_years` | **no** | **no** — always blank |
| `search_min/max/step_monthly_real` | **no** | **no** — always blank |

Root cause: `handleApplySpendingOptimizerWithHook` writes only base living,
boost and guardrails; `spendingOptimizerFormData` has nothing to read for
the other five inputs. The manual "Adjust spending rules manually" form
restores all seven of its inputs correctly (verified on the same render).

## 2. Design

- New `models.SpendingSearchPreferences` (json `spending_search`, pointer,
  omitempty on `WhatIfSettings`): `max_shortfall_pct` (no omitempty — 0 is
  the strict rule), `near_term_years`, `search_min_monthly_real`,
  `search_max_monthly_real`, `search_step_monthly_real` (0 = left blank /
  automatic). nil = never applied → form shows the default 5 and blanks.
- The preview retains the RAW parsed request (`form`) separately from the
  normalized `request`, so blanks stay blank instead of being restored as
  the normalizer's canonical values.
- Apply writes `SpendingSearch` from the retained raw form in the same
  single `SaveWithRevisionIfScenario` write as the other three settings.
- `spendingOptimizerFormData` emits `MaxShortfallPctText` (Go-formatted,
  `strconv.FormatFloat(v,'f',-1,64)` — one formatter), `NearTermYearsSaved`,
  `SearchMinMonthlyReal/SearchMaxMonthlyReal/SearchStepMonthlyReal`; the
  template renders them like the existing floor pattern (`%.2f`, blank on 0).
- Default 5 lives in ONE constant `models.DefaultSpendingMaxShortfallPct`
  used by the parser and the form; the template no longer hardcodes it.
- Preview/graph/cancel never write settings (unchanged).

## 3. Tasks

| Task | Tier | Checks | Acceptance criteria |
|---|---|---|---|
| SP1 | 2 | tests,second | (a) After Apply, `rm.Load()` returns `SpendingSearch` equal to the raw form values (shortfall 7.5, near-term 3, min/max/step) in the same revision increment; every other serialized setting unchanged. (b) A form left at defaults applies as `{MaxShortfallPct:5}` with zero advanced fields. (c) `spendingOptimizerFormData` with saved prefs yields the five keys; with nil prefs yields `MaxShortfallPctText=="5"`, blank advanced. (d) Rendered partial shows `value="7.5"`, `value="3"`, `value="7000.00"` etc. on the matching inputs; nil prefs render `value="5"` and empty values (not `<no value>`). (e) The live page (`GET /whatif` on a scratch server with copied demo data) after a real Apply round-trip shows the entered shortfall and advanced values. (f) `go build ./... && go vet ./... && go test ./internal/handlers/whatif/ ./internal/models/ ./internal/services/retirement/...` green. |

Tier rationale: value formatting shown to users (dual-formatter class) and
money fields → `second` named per the lean rules.

## 4. Rulings

SP1 — ACCEPTED attempt 1 (gate: `OK: SP1 accepted at tier 2 (attempt 1)`;
`gate.sh done`: `OK: all tasks accepted, evidence verified, no unresolved
flags`; `gate.sh stats`: `first-attempt clean: 1/1`). No catches this run.

Findings recorded for the backlog (neither a FAIL; both out of scope):
- primary checker F1: the `<no value>` guard in
  `TestSpendingOptimizerRenderSearchPreferences` cannot fire — html/template
  renders a missing map key as an empty attribute value; the `value=`
  assertions carry the evidence (and mutation-kill).
- primary F4 / second F1: `parseSpendingRequest` accepts any shortfall in
  [0,100), so a direct POST of e.g. 12.34 would restore `value="12.34"`
  into an input declaring `step="0.1"`, and the results copy formats the
  same figure with `%.1f` ("12.3"). Unreachable from the browser (the form
  enforces the step). Pre-existing; a dual-formatter candidate if the
  parser ever accepts finer input.
- primary F2 (process): the lead edited the implementation tree (removed
  an unused clone helper) AFTER dispatching the checkers; the primary had
  to re-snapshot. Same rule as the TC run: snapshot/finish edits BEFORE
  dispatch.

## 5. SP2 — Applied spending plan evidence survives reload (2026-09-13)

User report (verbatim): "Also the charts that show the spending for the
selected spending plan is gone after the reload." User chose scope:
restore the APPLIED option's evidence (not the full comparison set).

### Diagnosis
The results panel and evidence chart are backed by the in-memory
`spendingPreviews` store keyed by `request_id`; `handleApplySpendingOptimizer`
saves the plan fields then `discardSpendingPreview`s the entry
(handlers_spending_optimizer.go:638). After reload nothing server-side can
redraw — `/whatif/spending/optimize/graph` answers 409 "Run again." Not an
SP1 regression; the results side never had a reload story.

### Design
- `models.AppliedSpendingEvidence` (json `applied_spending_evidence`,
  pointer, omitempty on `WhatIfSettings`): the applied candidate's identity
  + config, the request parameters the graph builder consumes (ENUMERATE
  every field `handleSpendingOptimizerGraphWithRunner` reads from
  `p.request`/`p.result`/the candidate — every-consumer rule), the three
  seeds + `ValidationRuns`, `applied_at` (date), and `settings_hash`.
- Circularity-free staleness guard: `settings_hash` is computed over the
  post-apply settings WITH the evidence field nil-ed, then the field is set
  and the whole thing saved in the SAME single
  `SaveWithRevisionIfScenario` write as SP1's fields. On read, clone
  current settings, nil the evidence field, recompute, compare. Any plan
  edit (any scenario content change) → stale.
- New endpoint `POST /whatif/spending/applied/graph`: fresh hash → rebuild
  engine input from CURRENT settings and produce the graph via the SAME
  shared core function the preview graph endpoint uses (refactor to one
  function; no second graph code path) with the persisted
  candidate/request/seeds/runs — seed-exact reproduction of what the user
  saw. Stale hash → 409 with an honest message.
- Template (`spending_optimizer.html`, non-chained branch): when evidence
  exists and is fresh, a "Selected spending plan" block above
  `#spending-optimizer-results` — option label, applied date, "Inspect
  evidence" button wired through the SAME JS render function as
  `data-spending-graph` (parameterize the fetch; no duplicated renderer).
  Stale → the block renders a plain note ("Your plan has changed since
  this option was applied — run a new comparison for current evidence"),
  no button. nil → nothing.
- Preview/cancel semantics unchanged; `formatMoney` is the only money
  formatter in the new block.

### Task row

| Task | Tier | Checks | Acceptance criteria |
|---|---|---|---|
| SP2 | 2 | tests,second | (a) After a real Apply round-trip through the router, `rm.Load()` returns `AppliedSpendingEvidence` carrying the applied candidate, the preview's exact `SearchSeed`/`SelectionSeed`/`ValidationSeed`/`ValidationRuns`, `applied_at`, and a `settings_hash` that verifies against the loaded settings with the field nil-ed — all written in ONE revision increment together with SP1's fields. (b) `GET /whatif`: fresh evidence renders the Selected-spending-plan block (label, date, button); nil renders nothing; stale hash renders the note and no button — asserted on rendered `value=`/text, never `<no value>`. (c) `POST /whatif/spending/applied/graph` with fresh evidence returns a payload byte-identical to the shared graph core invoked directly with the persisted inputs against the same settings (seed-exact; one code path). (d) After any settings edit the endpoint returns 409 + honest message. (e) The applied block's chart goes through the same JS render function as the preview graphs (server-assertable wiring: endpoint + data attributes; no second renderer in the diff). (f) `go build ./... && go vet ./...` and the whatif/models/templates package tests green; `make css && make css-verify` clean if classes changed. (g) No critical-glob changes; preview/cancel/apply flows for un-reloaded sessions behave exactly as before (existing tests untouched and green). |

Tier rationale: money figures in a rendered chart, seed reproduction, and
a hash-based guard — squarely the "wrong figure on screen makes a lie"
class → `second` named.

### SP2 rulings

SP2 — ACCEPTED attempt 1 (gate: `OK: SP2 accepted at tier 2 (attempt 1)`;
`gate.sh done`: `OK: all tasks accepted, evidence verified, no unresolved
flags`; `gate.sh stats`: `first-attempt clean: 2/2`). budget2 commit
9e76471 pushed to fix/spending-plan-restore → PR #111 (with SP1's 950e2d9).
No FAILs. Backlog observations (neither lane failed on them):
- primary F2/F3: the Playwright browser oracle
  (testdata/spending_optimizer_browser.cjs) is not installed/CI-wired and
  jsdom is unavailable — the JS module has never executed in a real DOM in
  this harness; server-assertable wiring only.
- Full-comparison-results restore after reload (the scope the user did NOT
  choose for SP2) remains unbuilt by decision, not oversight.
- Adversarial lane wrote two probes beyond the shipped suite (SpendingSearch-
  only staleness; second-Apply-replaces-evidence) — both held; candidates
  for promotion to tests in a future run (V3 pattern).
