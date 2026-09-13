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
