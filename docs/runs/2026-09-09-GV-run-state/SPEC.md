# SPEC.md — Guardrails: make the feature legible (GV run)

Run prefix: **GV** (guardrail visualization). Target repo:
`/home/darrell/bin/ai/budget2` (github.com/dgallion1/simpleBudget). Base
commit **5fae968** (master, 2026-09-08 evening, includes the GO optimizer
run c37cc49 → 40722be and PR #103). All manifest paths and globs are
budget2-repo-relative.

Previous run's spec (U — UI audit, closed 2026-09-06) is archived in
`docs/runs/2026-09-03-U-run-state/`. This run's `.swarm/` lives in THIS
agents2 worktree (gitignored).

## 0. Status — APPROVED 2026-09-09 ("go"), all §6 defaults taken

Implementation worktree created: `.worktrees/guardrail-viz` on
`feat/guardrail-visualization` at 5fae968, `data -> ../../data` symlink
(untracked, never committed).

User request (verbatim): "This feature is confusing to use. The graphs could
be better, maybe show when guardrails kick in. But see what you can do."

## 1. What the lead found (2026-09-08, isolated verify server on :8099)

Observed on a copy of the live plan (living $10,900/mo, guardrails on:
drop 20 / cut 10 / rise 20 / raise 10, multiplier 75–120 %, no absolute
floor; spending phases Go-Go 100 % → Slow-Go 80 % at 70 → No-Go 65 % at 85):

1. **The optimizer simulates the household without Social Security.**
   `handleGuardrailOptimizer` passes `buildEngineInput(settings)` straight to
   `analysis.OptimizeGuardrails` with zero-valued `engine.Hooks`, so
   `Hooks.SSActive` is false and the SS-optimizer income stream ($4,115/mo
   on this plan) is dropped. The page's own Monte Carlo goes through
   `retirement.RunFull`, which calls `fillDefaultHooks`. The GO5 graph
   handler sets `in.Hooks = retirement.DefaultHooks()`; the search handler
   never did. Lead probe, same plan, same `DefaultMonteCarloConfig`,
   300 seeded runs each:

   | Input | Survives depletion | Keeps $7,500 floor |
   |---|---|---|
   | zero hooks (optimizer today) | 89 / 300 | 18 / 300 |
   | `DefaultHooks()` (page Monte Carlo) | 262 / 300 | 47 / 300 |

   On screen this is "Current guardrails: 67.8 % portfolio depletion,
   median ending balance $0" beside a Monte Carlo card saying "84.5 %
   avoiding depletion, median $5.28 M". Two surfaces on one page, 4× apart.
   Every optimizer figure shipped so far (and the GO7/GO8 bands) inherits
   this. It is a money figure that is a lie → Tier 3.

2. **"Guardrails disabled: 0.00 % chance of maintaining minimum" is the
   plan's own design, not market risk.** No-Go at 85 plans 0.65 × $10,900 =
   $7,085/mo, below the $7,500 default floor, so every future without an
   absolute floor "fails" by construction. Nothing on the page says so; the
   user reads it as catastrophe.

3. **"Worst annual cut 100.00 %" on every row** is P95 of largest annual cut;
   with depletion above 5 % of futures it saturates at 100 % and carries no
   information. Partly a consequence of (1); still needs a reading aid.

4. **The projection chart shows a guardrail only as a small red triangle** at
   the event year (GM run). Nothing shows the level the balance is being
   tested against, so the user cannot see *why* a cut fires at year 35 and
   not at 30, nor what happens to their monthly budget afterwards. The
   Guardrail Events list lives on the Risk tab, two tabs away from the
   chart on Overview.

5. **The settings card speaks in abstract percentages** ("Drop 20 % from
   peak") with no dollar anchor. The engine already knows the exact dollar
   level of the next cut and next raise.

## 2. Goals and non-goals

Goals: (a) the optimizer's figures agree with the rest of the page;
(b) the projection chart shows WHEN guardrails kick in, at WHAT balance,
and what they do to the monthly budget; (c) the optimizer explains
plan-design floor misses and saturated cut figures instead of leaving the
user to guess; (d) the settings card anchors its percentages in dollars.

Non-goals: no change to guardrail semantics (`engine/guardrails.go`
untouched), no change to the optimizer search grid, ranking, seeds, or
qualification rule, no new page, no Guyton-Klinger work.

## 3. Architecture rules for this run

- **One source per figure.** Every trigger level, multiplier, and dollar
  figure rendered anywhere (chart traces, hover text, chart summary line,
  settings card, optimizer notices) comes from fields the ENGINE emits on
  `models.ProjectionYearSummary` / `models.ProjectionMonth`. Handlers and
  templates format; they never recompute a threshold (ruling 2026-08-29a).
- **One rounding path.** Money renders through `templates.FormatMoney`
  (Go) — no JS `toLocaleString` for figures that also appear server-side.
  Real-dollar conversion of a figure uses the SAME `CumulativeInflation`
  divisor as the balance it is compared against (see GV2).
- **Additive model fields only**, `omitempty` where 0 is not meaningful,
  so old saved projections and every existing consumer (canonical
  projection, Monte Carlo, backtest, scenario chain, MCP `get_balance_
  projection`, optimizer graph) keep working unchanged.
- Territory: a budget2 git worktree
  `/home/darrell/bin/ai/budget2/.worktrees/guardrail-viz` on branch
  `feat/guardrail-visualization` off 5fae968. The main checkout keeps its
  foreign uncommitted edits (`Makefile`, `web/static/vendor/htmx.min.js`)
  and is never touched. Verify server: `scripts/whatif-verify.sh start
  <port>` from the worktree (needs the `data -> ../../data` symlink; the
  script derefs it).

## 4. Tasks

| ID | Tier | Checks | Title |
|---|---|---|---|
| GV1 | 3 | tests, second (+oracle) | Optimizer search runs with the plan's engine hooks |
| GV2 | 3 | tests, second, a11y (+oracle) | Projection chart: trigger levels + living-budget panel |
| GV3 | 2 | tests, a11y, second | Optimizer explains plan-design floor misses and saturated cuts |
| GV4 | 2 | tests, a11y, second | Settings card shows next cut / raise in dollars |

GV1 ∥ GV2 ∥ GV3 run in parallel; GV4 waits for GV2's model fields.

### GV1 — Optimizer search runs with the plan's engine hooks (Tier 3)

**Files:** `internal/handlers/whatif/handlers_guardrail_optimizer.go`;
`internal/handlers/whatif/guardrail_optimizer_test.go` (+ new test file
allowed). No engine or analysis changes.

**Change:** after `buildEngineInput(settings)` succeeds, set
`in.Hooks = retirement.DefaultHooks()` exactly as
`handleGuardrailOptimizerGraph` does, before `analysis.OptimizeGuardrails`.
Add a guard in `analysis.optimizeGuardrailsWithRunner`? **No** — the
analysis package cannot know the hooks; the contract is at the handler.

**Acceptance:**
1. `go build ./... && go vet ./internal/handlers/whatif/ && go test
   ./internal/handlers/whatif/ ./internal/services/retirement/...` green.
2. Regression test: a fixture with the SS optimizer active and a claimed
   benefit (use the existing synthetic optimizer fixture pattern; never
   real data) — the "Current guardrails" baseline row's `DepletionPaths`
   from the handler equals the depletion count of
   `analysis.MonteCarloWithResults(eng, inWithHooks, ValidationRuns,
   ValidationSeed)` run by the test. Exact equality is required: lead
   verified 2026-09-08 that `runSimulations` and
   `runGuardrailOptimizerScenarios` both derive per-run seeds as
   `rand.New(rand.NewSource(seed)).Int63()` in run order, and the floor
   observer never changes `Survives`/`DepletionYear`.
3. The graph handler and the search handler build their engine input the
   same way — a test asserts both code paths produce identical
   `Hooks.SSActive(settings)` for the SS fixture.
4. Existing GO tests (`guardrail_optimizer_test.go`, `guardrail_graph_test.go`,
   `guardrail_ranges_test.go`, GO6/GO9 replay tests) still pass unchanged.

**Oracle** (`.swarm/tier3/GV1/accept.sh`, calibrated both ends before
dispatch): runs criteria 1–4 as commands; featureless tree (5fae968) must
fail on criterion 2; a disposable prototype must pass; emits `ORACLE PASS`
only on the all-pass path.

### GV2 — Projection chart: trigger levels + living-budget panel (Tier 3)

**Files:** `internal/models/whatif.go` (additive fields);
`internal/services/retirement/engine/stepper.go`, `engine/month.go`
(capture only — `Evaluate` untouched); `internal/handlers/whatif/handlers.go`
(`buildProjectionChartData`, new summary helper);
`web/templates/components/whatif/projection-chart.html`;
`web/static/js/charts.js` only if the container height must change; tests
beside each.

**Engine fields (nominal, captured at each year-boundary evaluation, after
`Evaluate` returns, on that year's `ProjectionYearSummary`):**
- `GuardrailPeak` = `GuardrailState.PeakPortfolio`
- `GuardrailBaseline` = `GuardrailState.InitialPortfolio`
- `GuardrailCutTrigger` = `GuardrailPeak × (1 − FloorDropPct/100)`
- `GuardrailRaiseTrigger` = `GuardrailBaseline × (1 + CeilingRisePct/100)`
All four `omitempty`; zero when guardrails are disabled. Exactness claim
(the oracle asserts it): for every year Y+1 where an event fires, the
total portfolio at that check is ≤ `GuardrailCutTrigger[Y]` (cut) or ≥
`GuardrailRaiseTrigger[Y]` (raise, when no cut fired); for every year
where no event fires and the multiplier is inside its bounds, neither
inequality holds. This is literally `Evaluate`'s test restated, so the
lines on the chart are the engine's own thresholds, not a re-derivation.

**Chart (server-built in `buildProjectionChartData`, so the Overview
chart, the "without guardrails" overlay endpoint, and the optimizer's
base-case preview all get it from one place):**
- Two dashed step traces on the balance axis, shown only when guardrails
  are enabled: **"Cut trigger"** (negative colour) and **"Raise trigger"**
  (positive colour), `line.shape: "hv"`. Interval [Y, Y+1) is drawn at
  `trigger[Y]` in nominal mode and `trigger[Y] / CumulativeInflation(month
  (Y+1)·12)` in real mode — the same divisor the balance point at Y+1 uses
  (`projectionValueAtYear`), so "balance line below cut line" on screen ⇔
  the engine's cut test, in both modes. Last interval uses the final
  month's divisor. Hover: "Cut if balance ≤ $X at the year N check"
  (`templates.FormatMoney`).
- A second panel below the balance chart (Plotly `yaxis2`, shared x,
  domains ≈ balance 0.40–1.0 / budget 0–0.26): **"Monthly living budget"**
  with two lines from `ProjectionMonth`: "Planned" (`PlannedLivingExpenses`)
  and "After guardrails" (`AdjustedLivingExpenses`), both divided by that
  month's `CumulativeInflation` in real mode. Existing cut/raise triangles
  move to the "After guardrails" line (their hover text is unchanged and
  still equals the Guardrail Events list — GM oracle contract preserved: one
  marker per rendered event row, in list order). Panel title carries the
  dollar mode. Figure height grows to fit (no 300 px collapse: verify after
  theme toggle and tab activation, run TH lesson).
- **Summary line under the chart** (server-rendered, same fields):
  "Guardrails: 1 cut (year 35: −10 %, $13,821 → $12,439/mo). Next cut if
  the balance falls below $1,720,000; next raise above $2,880,000."
  Figures: events from `GuardrailEvents`; thresholds from the LAST year
  summary's trigger fields; all via `templates.FormatMoney`; percentages
  via the same arithmetic as the events list. When guardrails are on but
  no event fired: "Guardrails: no cuts or raises in this projection." Ends
  with a link text "See Guardrail Events (Risk tab)". When disabled: line
  omitted.
- Real/nominal toggle re-fetches (existing) so both panels switch together.

**Acceptance:**
1. Build/vet/test green incl. `make css` if any Tailwind class is new.
2. Oracle exactness claim above holds on (a) the spec fixture — a synthetic
   plan engineered to fire ≥1 cut and ≥1 raise (raise needs
   `MaxSpendingPct > 100` and a rise) — and (b) a no-event fixture.
3. Chart JSON for both display modes contains the two trigger traces with
   `len(x) == len(y) == projection years`, values as defined; a fixture
   with a cut at year N has `balance(N) ≤ cutTrace(N−1)` in BOTH modes; the
   Guardrail markers trace still has exactly one point per event.
4. Summary line figures equal the events list and the last year summary
   (rendered-string comparison, fractional-cent fixture).
5. Optimizer base-case preview (`/whatif/guardrails/optimize/graph`,
   kind=base) shows the same traces for a candidate with guardrails and
   none for the `no-guardrails` baseline.
6. Accessibility: trigger lines are not colour-only (dash + legend text +
   summary line); chart summary is real text; both themes; panel labels
   readable at 1024 px; ACCESSIBILITY.md A-1…A-15.

### GV3 — Optimizer explains plan-design floor misses and saturated cuts (Tier 2)

**Files:** `internal/handlers/whatif/handlers_guardrail_optimizer.go`,
`web/templates/components/whatif/guardrail_optimizer.html`, tests. No
change to analysis.

**Single source:** a new exported helper in `analysis` (or `engine`) —
`LowestPlannedLivingReal(projection) (amount float64, year int, phase
string)` = min over months of `RoundLivingCents(PlannedLivingExpenses /
CumulativeInflation)`; it reads the canonical base projection the handler
already runs. Used by both the form hint and the results notice.

**Behaviour:**
1. Form hint under the floor field: "Your plan's lowest planned living
   spending is $7,085/mo in today's dollars (No-Go, year 22). A minimum
   above that is missed by design in every future without an absolute
   floor." (omit phase text when phases are disabled).
2. Results: when `floor > lowest`, a notice paragraph (announced with the
   outcome heading) says exactly that and names the affected rows;
   baseline/candidate rows whose config has no absolute floor (or a floor
   below the request) get "Below target — planned spending is below your
   minimum from year N" instead of a bare "Below target". Rows with an
   absolute floor ≥ request keep the plain wording.
3. Worst annual cut: when the rendered value is 100.00 %, the cell adds
   "(no funded living spending for a full year in ≥5 % of futures — see
   Portfolio depletion)". Threshold is the rendered string "100.00", one
   place.
4. Nothing about search, qualification, tokens, Apply, or seeds changes;
   GO5/GO6/GO8/GO9 tests pass unchanged.

**Acceptance:** handler/render tests for 1–3 with a fixture where the
phase minimum is below the floor and one where it is above (no notice);
rendered figures use `templates.FormatMoney`; a11y: notice is inside the
existing `role=status`/outcome announcement path, both themes, keyboard.

### GV4 — Settings card shows next cut / raise in dollars (Tier 2)

**Files:** `web/templates/components/whatif/guardrails.html`, the handler
that renders the card's data (`handlers.go` page data), tests.

**Behaviour:** under "Floor (cut spending…)" and "Ceiling (raise…)" add
one line each, from the base projection's year-0 summary fields (GV2):
"Today: cut if the portfolio falls below $1,920,000" / "raise if it rises
above $2,880,000". Shown only when guardrails are enabled and the
projection exists; hidden (not "$0") otherwise. Also change the card
heading from "Drop/rise guardrails (simple)" to "Spending guardrails" and
move the Guyton-Klinger disclaimer sentence into the existing help text.

**Acceptance:** rendered strings equal `templates.FormatMoney` of the
year-0 `GuardrailCutTrigger`/`GuardrailRaiseTrigger`; card re-renders
with new figures after an HTMX guardrail save; a11y both themes.

## 5. Verification plan

- `.swarm/ledger.tsv`, `.swarm/critical.globs` (settings persistence and
  deploy paths only — `internal/services/retirement/settings.go`,
  `scripts/deploy*`, `Makefile`; NOT shared handler files, GM lesson),
  `.swarm/test.globs` (`**/*_test.go`, `.swarm/**`).
- GV1/GV2 oracles authored and calibrated (fail on 5fae968, pass on a
  discarded prototype) before dispatch. GV2's oracle is a Go test file
  copied into the package at run time (GO7 pattern), asserting on every
  existing consumer: canonical projection, Monte Carlo (`FloorOutcome`
  untouched), backtest, MCP `get_balance_projection` JSON, optimizer graph.
- Checkers get the foreign-territory list verbatim: the main checkout's
  `Makefile` / `htmx.min.js` edits and the `codex/*` worktrees under
  `.worktrees/` are not this run's.
- Final pass: `make check`, `go test ./...`, `go vet ./...`,
  `staticcheck ./...`, `bash smoketest/gate/run_tests.sh` (agents2),
  `checker-a11y` over `/whatif` light+dark, `swarm/gate.sh done`,
  `swarm/gate.sh stats` reported verbatim.
- Deploy only on the user's word, via the recipe in memory, after
  `git rev-list --left-right --count origin/master...master`.

## 6. Defaults the lead is taking unless overruled

- D1. GV1 is in scope even though the user asked about graphs: the wrong
  figures are the biggest source of confusion and the fix is one line plus
  tests.
- D2. The budget panel plots dollars per month, not the multiplier
  percentage — retirees think in $/mo (the events list already shows both).
- D3. Trigger lines are shown whenever guardrails are enabled; the legend
  toggles them. No new UI switch.
- D4. The Guardrail Events list stays on the Risk tab; the chart gets the
  summary line and a pointer instead of a duplicate list.
- D5. Optimizer default floor stays $7,500 (user-approved wording); GV3
  adds the hint rather than changing the default.

## 7. Rulings

(recorded during the run, by detecting mechanism)

- **GV-2026-09-09a (oracle calibration, lead artifact).** GV1 `accept.sh`
  fail-end on 5fae968: criterion 2 failed for the right reason
  (optimizer "current" row 1000/1000 depleted vs 172/1000 with hooks).
  Pass-end with a one-line prototype exposed TWO defects in the oracle
  itself, not the app: (1) `DepletionRiskPct` compared with `!=` against
  `count/runs*100` (float noise, 18.1000 vs 18.1); (2) the no-guardrails
  reference run used the fixture's ENABLED guardrails, so 609 ≠ 183 was my
  comparison error. Fixed to a 1e-9 tolerance and to clone each
  candidate's own `Guardrails` pointer exactly as the graph endpoint does;
  re-passed with all eight retained candidates reproduced exactly.
  Prototype reverted. Mechanism: both-ends oracle calibration.
- **GV-2026-09-09b (oracle calibration, lead artifact).** GV2 `accept.sh`
  fail-end on a pristine 5fae968 export: `ORACLE FAIL: … capability
  missing` (guard). Pass-end with a disposable prototype (engine fields +
  chart traces, ~70 lines) first failed to COMPILE the oracle: two Go map
  comparisons (`tr == raise`) — my defect; fixed to compare trace names.
  Re-run: all four oracle tests PASS, confirming the event fixture fires
  ≥1 cut and ≥1 raise and the no-event / disabled fixtures behave.
  Prototype directory deleted. GV1 checkers run on a frozen `cp -a`
  snapshot (/tmp/budget2-gv1-snap) taken before GV2/GV3 workers started
  editing the live worktree (snapshot-before-checkers rule, TC run).
- **GV1 accepted 2026-09-09, attempt 1, first-attempt clean.** Gate:
  `OK: GV1 accepted at tier 3 (attempt 1)`. Oracle (lead run on the frozen
  snapshot) `ORACLE PASS`; checker-tests PASS with mutation kill (reverting
  the line fails both new tests and the oracle) and `make check` green;
  checker-second PASS after a twin-call-site sweep (13 `buildEngineInput`
  sites, one `OptimizeGuardrails` caller, Apply path builds no Input) and
  a seed-derivation identity proof. Observations for the backlog, not
  defects: (a) the worker's permanent regression mirrors the oracle's
  fixture almost verbatim — a brief-level fixture error would propagate to
  both (checker-tests); (b) `.swarm-go/tier3/*` leftovers on master
  (checker-second).
- **GV-2026-09-09c (checker-second observation on GV2, attempt 1 PASS).**
  `layout.height: 520` and the `chart-container-tall` 540 px min-height now
  apply even when guardrails are disabled, so non-guardrail plans get a
  taller single-panel chart than before. Not a criterion breach; lead
  decision: fix as a small follow-up task **GV5** (Tier 2, checks
  tests,a11y, lead-direct under the lean exception) after GV4 lands —
  height and class conditional on guardrails being enabled, with a test.
- **GV-2026-09-09d — GV2 attempt 1 FAIL, CONCEDED (mechanism: checker-a11y,
  manual contrast walk; axe cannot see Plotly SVG strokes).** "Raise
  trigger" dashed line + triangle-up markers at `#22c55e` measure 2.28:1 on
  the light card background (A-3 requires ≥3:1 for meaning-carrying
  graphics); dark theme 6.66:1 is fine; "Cut trigger" `#ef4444` passes both
  (3.76 / 4.03). Attribution accepted: GV2 moved the markers off the green
  area fill onto the unfilled budget panel, so a pre-existing marginal
  colour became new failing content. Attempt 2 contract: trace colours are
  theme-aware (server emits `meta.tone` per trace; charts.js applies the
  active theme's tone palette on render and on theme change), every new or
  relocated trace ≥3:1 in BOTH themes, verified numerically by a browser
  probe promoted to a permanent test. Primary checker-tests verdict for
  attempt 1, if it lands, is moot — attempt 2 re-verifies all three lanes.
- **GV-2026-09-09e.** GV5 (conditional chart height) is folded into GV2
  attempt 2 — same file, same chart, same worker round; a separate task
  would only add a verification cycle. GV5 will not appear in the ledger.
- **GV-2026-09-09f — GV3 attempt 1 FAIL, CONCEDED (mechanism: primary
  checker-tests, mutation proofs).** Behaviour met every criterion and the
  three surfaces agree ($5,000.00 / year 1), but two of three required
  mutations SURVIVE the permanent tests: (b) widening the row condition to
  tag adequately-floored non-qualifying rows — no fixture has such a row;
  (c) changing the `"100.00"` comparison to `"99.99"` — the test counts
  occurrences (invariant under moving the text between rows) and its
  negative guard's byte window is too short to ever match. Attempt 2 is
  test-only: a fixture with a non-qualifying candidate whose floor ≥ the
  request asserting the plain "Below target" cell; per-row anchored
  assertions for the 100.00 vs 99.99 cells; a divisor-sensitive helper
  fixture. Also fix the stale "Deferred wiring" template comment and the
  GV2→GV3 test comment. Adversarial lane PASSed attempt 1; it re-runs at
  attempt 2 with the a11y lane. OBSERVATION: checker-a11y left
  `a11y-out/` and a `zzgv3_a11y_dump_test.go` in the shared snapshot
  /tmp/budget2-gv3-snap instead of its own copy — harmless (temp
  snapshot), but the copy rule is restated in later briefs.
- **GV-2026-09-09g — GV2 attempt 1 also FAILED the primary lane
  (mechanism: checker-tests, mutation proofs); CONCEDED and folded into
  attempt 2.** Oracle and behaviour correct; the permanent chart test
  asserts structure only, so a wrong real-mode CPI index and a "Planned"
  trace reading the post-guardrail series survive the entire suite — only
  the overlay-injected oracle catches them, and the oracle is never
  committed. Attempt 2 must add value-level assertions in both display
  modes (trigger y ÷ check-month CPI, Planned/After per month, hover
  strings, trailing point) and an omitempty JSON assertion. Same defect
  class as GV3's attempt-1 FAIL (GV-2026-09-09f): workers write
  structure-only tests when the brief lists the oracle's checks but does
  not say "your test must kill mutation X". Lesson for later briefs: name
  the mutations the permanent tests must kill, up front.
- **GV-2026-09-09h (checker-second observation on GV4, attempt 1 PASS).**
  Card anchor ("Today: cut if … $850,000.00", nominal year-0 trigger) vs
  GV2 summary line's parenthetical today's-dollar figure ($827,277.99 =
  same trigger ÷ the check-month CPI) on a 1-year fixture. Lead ruling:
  not a contradiction — the summary shows the nominal figure first and
  labels the deflated one "today", and the divisor is exactly the
  real-mode trace's rule (GV2 §chart). Backlog candidate: add the same
  labelled today's-dollar equivalent to the card anchors for symmetry.
- **GV-2026-09-09i — GV4 attempt 1 FAIL, CONCEDED (mechanism: primary
  checker-tests, mutation proofs).** Behaviour correct on every criterion;
  a11y and adversarial lanes PASSed. But mutation (a) — recomputing the
  anchors as PortfolioValue × (1 ∓ pct/100) instead of reading the engine's
  year-0 fields — survives the suite, and deleting the anchors container
  from the card survives too (the test renders the standalone block, never
  the card). Attempt 2 is test-only plus one wording change: (1) a test
  calling buildGuardrailAnchors with hand-set year-0 triggers that differ
  from the percentage product; (2) a rendered-card assertion of the
  fixture's fractional-cent figures; (3) wording "Today: cut if …" →
  "Next yearly check: cut if …" so "today" is no longer used for both
  "now" (card) and "today's dollars" (GV2 summary) — lead product
  decision, user's §6 latitude. Third occurrence of the structure-only
  test class this run (GV2, GV3, GV4).
- **GV-2026-09-09j (GV2 attempt-2 worker notes, for the record).** Measured
  palette: light negative #dc2626 4.83:1, positive #15803d 5.02:1, planned
  #57534e 7.63:1, after #1d4ed8 6.70:1 vs white; dark #f87171 5.48:1,
  #4ade80 8.71:1, #d6d3d1 10.18:1, #93c5fd 8.41:1 vs #292524. Worker
  self-caught a test that wrote `guardrails.enabled=true` into the tracked
  `testdata/settings/whatif.json` through the shared test data dir, and
  restored it (with a `git checkout -- <file>` on its own dirtied file —
  tolerated, rule restated). Flakes reported under full-suite load in
  GV3's live-Monte-Carlo row test and GV4's anchors render tests — GV3.2 /
  GV4.2 primary checkers asked to assess. Backlog: `/whatif/results-full`
  returned 500 on the isolated browser fixture (pre-existing, uninvestigated).
- **GV-2026-09-09k (process incident, attempt-2 verification round).**
  GV4.2 checker-a11y ran its first `cp -a` in the wrong direction and
  overwrote the shared snapshot /tmp/budget2-gv-final-snap with the agents2
  repo, then restored it from a sibling checker's copy. Lead verified
  afterwards: `diff -rq` between the restored snapshot and the (idle)
  implementation worktree shows NO source differences — only a stray
  `.checker-shots/` scratch directory left by a checker. Verdicts taken
  from the snapshot stand. Lesson: give each checker its own pre-made copy
  (or a read-only snapshot) rather than a shared path they copy from.
- **GV-2026-09-09l (checker-a11y observation on GV2 attempt 2 PASS).** The
  pre-existing "Without guardrails" compare-overlay trace (`#a8a29e`)
  measures ~2.5:1 in light mode; byte-identical to master, out of GV2
  scope. Backlog: give the overlay trace a `meta.tone` so it rides the
  same palette (one-line follow-up).
- **GV-2026-09-09m — GV2 attempt 2 FAIL (mechanism: checker-second,
  adversarial, live reproduction), CONCEDED → HARD STOP.** The optimizer's
  "Base case" graph preview (guardrail_optimizer.html `graphTheme()`, GO5
  code, byte-identical to master) recolours traces by INDEX (0 = green,
  rest = amber), overwrites the markers' per-point colour array with a
  scalar, and hardcodes `layout.height = 340`, so the new seven-trace
  two-panel chart renders in that preview as one flat colour, squeezed.
  Split-classification class: server `meta.tone` honoured by charts.js,
  ignored by a second consumer. Root cause is the LEAD's spec: §GV2 named
  the preview as a consumer of the chart DATA and never inspected its
  client renderer. Two failed attempts at Tier 3 → halted per CLAUDE.md;
  reported to the user with a rewritten attempt-3 contract (below), not a
  third try at the same brief. a11y lane PASSed attempt 2; primary lane
  verdict pending at the time of the halt.
  **Proposed attempt-3 contract (awaiting user):** in
  guardrail_optimizer.html `graphTheme()`: (1) apply the shared tone
  palette from charts.js (`getTonePalette()` / `applyTonePalette()`, made
  reachable as globals) to every trace carrying `meta.tone`/`meta.tones`;
  keep the index/amber treatment ONLY for traces without meta ("Portfolio
  Balance", "Key events"); (2) `layout.height` = 520 when the payload's
  layout has `yaxis2`, else 340, and leave `yaxis2` styling to the same
  gridcolor/automargin treatment as `yaxis`; (3) a permanent test that
  runs `graphTheme` (extracted to a testable function or exercised through
  the browser probe opening the optimizer's Base-case view) against a real
  guardrailed payload and asserts distinct per-tone colours, an intact
  marker colour array, and height 520; (4) re-verify all three lanes.
  Files: guardrail_optimizer.html (GV3-owned but GV3 is complete),
  charts.js, cmd/server probe + test.
- **GV4 accepted 2026-09-09, attempt 2.** Gate: `OK: GV4 accepted at tier 2
  (attempt 2)`. All three lanes PASS: checker-tests killed all four
  mutations with named permanent tests (attempt-1 escapes closed),
  checker-second confirmed byte-level scope and 18/18 stability runs,
  checker-a11y re-measured contrast (6.29/5.48 light, 8.02/7.89 dark) and
  the OOB refresh. Observation O3 (whether "Next yearly check:" is the
  right phrase) is the lead's product call — accepted as written.
- **GV3 accepted 2026-09-09, attempt 2.** Gate: `OK: GV3 accepted at tier 2
  (attempt 2)`. checker-tests: mutations (a)(b)(c) killed by named
  permanent tests; mutation (d) (drop `!c.Qualifies`) proven EQUIVALENT
  (no reachable row is both qualifying and flagged; rendered bytes
  identical) — a brief-level unsatisfiable mutation, not a defect; flake
  margin quantified (0/1000 success on every row across independent
  seeds, needs ~500 to flip). checker-second: 20/20 runs, own mutations
  killed. checker-a11y: rendered optimizer markup byte-identical to
  attempt 1, axe clean both themes. Backlog: a render-level test that a
  qualifying row with the flag set still reads "Meets target" (F2).
- **GV2 attempt 2 primary lane PASS (checker-tests) — recorded for the
  halt report.** All seven mutations killed by named permanent tests; the
  browser probe ran for real (Chromium, 16.6 s) and is itself
  mutation-killing on the theme-change path; oracle `ORACLE PASS`. The
  attempt still fails on the adversarial lane's preview-retheme finding
  (GV-2026-09-09m). Backlog F4: the on-render `applyTonePalette` call is
  unguarded by the probe (light-first load equals server defaults) — a
  dark-first probe variant is a V3-pattern promotion candidate; F1:
  `/whatif/results-full` 500 on the synthetic fixture reproduces on base
  5fae968 (pre-existing).
- **GV-2026-09-09n — user authorized GV2 attempt 3 ("go") under the
  rewritten contract in GV-2026-09-09m; ledger attempt bumped to 3.**
  Addition to the contract from lead review of guardrail_optimizer.html:
  `graphTable()` builds the preview's accessible data tables from every
  trace with a hard-coded "Portfolio balance" column, so the new budget
  traces would be mislabeled — attempt 3 labels each table by axis
  (balance traces "Portfolio balance", y2 traces "Monthly living budget")
  and keeps the Event column for the markers trace.
- **GV2 accepted 2026-09-09, attempt 3.** Gate: `OK: GV2 accepted at tier 3
  (attempt 3)`. Oracle `ORACLE PASS` (oracle.3.log). checker-tests: seven
  mutations killed incl. a charts.js palette mutation proving the node test
  loads the real file; browser probe run for real. checker-second: drove
  the full optimizer → View graph → Base case flow in Chromium, measured
  exact palette both themes, height 520/340, marker per-point fills, table
  headers. checker-a11y: 4.83–10.80:1 on all seven preview traces, axe
  clean in three passes, keyboard/focus/reflow intact. Backlog from the
  round: dark-theme index-amber ("Key events") for the no-guardrails
  preview asserted nowhere (cross-product gap); `/whatif/results-full`
  500 on synthetic fixtures (pre-existing on base).
