# Final full-site accessibility sweep — run WS (budget2 /whatif save-path fixes)

Audited against `/home/darrell/bin/ai/budget2/ACCESSIBILITY.md` + WCAG 2.2 AA.

- RUN tree: `git archive d9bf7ef` (master ba952f4 base + WS5, everything this run ships)
- BASE tree: `git archive 643fa54` (pre-WS)
- Both built with `nice -n 19 go build ./cmd/server`, GOMAXPROCS=4, each against its
  own `cp -rL` copy of the real `data/` directory, isolated ports (18080/18081,
  never :8080), one server up at a time while driving Playwright, killed after
  each phase. Confirmed at the end: `ss -ltnp | grep budget2` shows only `:8080`
  (pid 1836774, the pre-existing live server — never contacted).
- axe-core 4.13.0 (`/home/darrell/.npm/_npx/e003b6b07d062486/node_modules/axe-core`,
  version-matched to the globally-installed `@axe-core/cli` 4.13.0 on PATH, the
  same build earlier WS checkers used per `.swarm/verdicts/WS5.5.checker-a11y.verdict`).
  Injected into the live page via Playwright (chromium), not hand-built HTML.
- Scope confirmed via a byte-level directory diff (`filecmp`, not the rtk-rewritten
  `diff`/`git diff`): WS touches only `internal/handlers/whatif/*`,
  `internal/services/retirement/*` (engine, non-rendering), `internal/templates/render.go`,
  `web/static/js/{base,whatif-portfolio-settings,whatif-quick-adjust,whatif-rate-assumptions}.js`,
  and the `web/templates/components/whatif/*` + `web/templates/pages/whatif.html`
  templates listed below. Every other page/template is byte-identical to BASE.

## Pages/states covered (RUN, light + dark, axe-core injected on each)

Top-level nav pages (byte-identical templates to BASE, confirmed via the directory
diff — swept for completeness per the "final full-site" instruction):
dashboard, explorer, insights, major-expenses, whatif, accounts, transfers,
filemanager, duplicates.

/whatif deep dive (both themes unless noted):
- baseline (all three collapse groups expanded by default)
- Rate Assumptions D6: tick the glide-path `enabled` checkbox → `#glide-path-fields`
  reveal, then untick
- D7: person-row birth-month error (UI-driven: fill `19711-08` into a real
  `input[type=month]`, dispatch `change`), and person-row removal (refused when
  healthcare-linked; not tested for unlinked removal since the real data has no
  unlinked third person — that exact path was already verified live by
  `checker-a11y` on WS5.4/5.5 against a synthetic fixture)
- Quick Adjust FAB: open panel, walk all 4 tabs (portfolio/rates/phases/healthcare),
  drag the `monthly_living_expenses` slider from both its Quick-Adjust mirror and
  its real in-card canonical control (`#monthly_living_expenses_input`), reading
  `aria-valuetext` before/after on canonical + mirror
- Add-Income-source rejection (server-side 400 via `end_month` before `start_date`,
  `form.noValidate=true` to bypass the browser's own HTML5 block) — the WS4.2
  role="alert" nesting fix
- Direct POST reproducing the run's own oracle probe pattern
  (`.swarm/tier3/WS5/probe.js`'s P3d shape)
- Scenario Chain card, Guardrails, Roth, Social Security, Healthcare, Portfolio,
  Spending Phases — all visible by default (collapse groups start expanded);
  templates read for markup, cross-checked against axe's live-page scan of the
  same states

## Findings

### F1 — `.mt-5 > summary` (guardrails.html, "Adjust spending rules manually")
- **ACCESSIBILITY.md point 7** / WCAG 1.4.3: `color-contrast` serious, 1.38:1
  (fg `#000000` on bg `#292524`), dark theme only.
- Present identically on **every** /whatif state, **both** RUN and BASE.
- `filecmp` + line-grep confirm the `<details>`/`<summary>` block
  (guardrails.html lines 6-10) is byte-identical between RUN and BASE; the
  diff in that file is confined to input `value`/`step` attributes elsewhere
  (WS1's `formatExact`/`step="any"` fidelity fix), never this element.
- **Classification: PRE-EXISTING.** Matches the exact node
  `.swarm/verdicts/WS5.5.checker-a11y.verdict` already recorded as
  pre-existing/out-of-scope.
- Evidence: `out/RUN.whatif-baseline.dark.json`, `out/BASE.whatif-baseline.dark.json`
  (identical `nodes[0].target`/`failureSummary`).

### F2 — Page-wide `color-contrast` "incomplete" set (43 nodes typical: nav links,
  Portfolio Allocation badge, chart tick labels, etc.)
- axe "incomplete" (needs manual review), not a violation.
- Identical node **counts** and identical selector lists between RUN and BASE at
  every matched state (verified programmatically over all 78 JSON dumps).
- **Classification: PRE-EXISTING**, outside every file WS touches (nav/dashboard/
  chart-axis markup).

### F3 — Large `color-contrast` violation set (~90 nodes) on the post-swap
  `#whatif-results` panel in **light theme only**, after a real form-triggered
  HTMX swap (e.g. following the Add-Income rejection)
- Targets are all in `#whatif-lifestyle-outcomes`, `#wf-tab-*`, `#projection-*`,
  `.border-warning.bg-warning-soft`, `.border-positive.bg-positive-soft` — the
  spending-optimizer/lifestyle-outcomes results templates, none of which WS
  touches.
- Reproduced **identically** on BASE with the same script/state
  (`out/... AXE VIOLATIONS: 1` with the same ~90-selector list on both trees).
- **Classification: PRE-EXISTING**, out of scope for this run. Flagged here as
  an OBSERVATION for the backlog — it is real and light-theme-only, but WS did
  not introduce or touch any of the implicated files.

### F4 — heading-order "incomplete" flicker on `whatif-glide-revealed`
- Appeared on BASE-light/RUN-dark in one run and the opposite pairing on a
  second capture; non-deterministic across repeated captures of the *same*
  tree. Root file (`lifestyle-outcomes.html`, `#whatif-lifestyle-heading`) is
  untouched by WS. Attributed to the async trajectory-chart re-render timing
  in my own harness, not a stable page defect.
- **Classification: OBSERVATION**, not attributable to either tree's code.

## Manual checks — WS-introduced surfaces (not caught by axe alone)

1. **D6 glide-path reveal** (point 4/9): ticking `enabled` reveals
   `#glide-path-fields`; the three revealed inputs are visible, `required`,
   and a visible instruction states the requirement. 0 axe violations beyond
   F1, both themes.
2. **D7 birth-month error** (point 5/6/9, WCAG 4.1.3): live UI-driven
   `19711-08` in a real `person_birth_month[]` field →
   `Darrell Gallion's birth month "19711-08" isn't a valid month (use YYYY-MM)`,
   exactly one `role="alert"` node, focus stays on the edited
   `#person-birth-month-<id>` input, states the required format in text.
   Verified both themes.
3. **D7 linked-person-removal refusal** (point 5/16): removing
   healthcare-linked "Christine" → 400,
   `Remove Christine's healthcare entry first`, exactly one `role="alert"`,
   the row persists in the DOM (no orphaned AT state vs visible state), both
   themes clean besides F1.
4. **WS4.2 role="alert" de-duplication** (point 5, WCAG 4.1.3): `bigticket-card.html`,
   `expense-sources-list.html`, `income-sources-list.html`, `onetime-card.html`
   removed the static `role="alert"` from their `whatif-add-*-error` wrapper
   divs; `renderError` (handlers.go) now carries `role="alert"` on the fragment
   itself. Live-triggered an Add-Income server-side rejection (end-month before
   start, `noValidate` to bypass the browser's own block) on RUN: **exactly
   one** `role="alert"` node exists (no nested double-announcement), wrapper's
   own `role` attribute is `null`, message names the constraint
   ("Through month must be Sep 2026 or later..."). Confirmed this is the
   intended, deliberate WS4.2 change (not a stray removal) by reading the
   inline rationale comment in each diff.
5. **WS1 `aria-valuetext` generalization** (WCAG 4.1.2, point 9): BASE already
   special-cased `aria-valuetext` sync for `monthly_living_expenses` only
   (hand-written block in `whatif-quick-adjust.js`); RUN generalizes this into
   `syncQuickAdjustAriaValueTexts`, applied to every `[data-quick-adjust-key]`
   control that starts with an `aria-valuetext` attribute. Live-dragged the
   **real canonical** in-card slider (`#monthly_living_expenses_input`, not
   just its Quick-Adjust mirror) on both RUN and BASE: both correctly propagate
   the exact dragged dollar figure to canonical + mirror `aria-valuetext`
   (`$7,300` → `$8,300`/`$9,500`). No regression; currently no *other* control
   in the codebase yet has a static `aria-valuetext` to benefit from the
   generalization (grep confirms only `portfolio-settings.html` and
   `quick-adjust.html` declare it, both already covered pre-WS) — the change
   is forward-looking infrastructure, not a behavior change today.
6. **Native HTML5 validation + `htmx.config.reportValidityOfForms`** (WS4 AC3,
   base.js, sitewide file but behavior gated to `/whatif` requests): confirmed
   a client-side-invalid `end_month` (before the plan start) is blocked by the
   browser's own constraint validation before any request is sent, with focus
   landing on the invalid field and a clear native validation message
   ("Value must be September 2026 or later."). Verified this sitewide file's
   new behavior is scoped by `isWhatIfPath()` — reading the diff, no other
   page's htmx error handling changes.
7. **Keyboard/role for new/changed controls** (point 3): `#add-person-row-btn`,
   `data-remove-person-row`, glide checkbox, Quick Adjust toggle/close/tabs are
   all real `<button>`/`<input>` elements — no `<div onclick>` introduced.
8. **Scenario Chain card**: `scenario-chain-card.html` is byte-identical to
   BASE (`cmp` confirms) — not a WS-introduced surface; only its neighbor
   (`.AnalysisError` branch in `whatif-results`, D4) is new. That branch reuses
   the same `bg-negative-soft`/`text-negative`/`role="alert"` classes already
   contrast-verified in both themes by `checker-a11y` on WS5 (5.72:1 light /
   8.88:1 dark) — read, not independently re-triggered (reproducing a deleted-
   scenario-chain-link failure was out of the practical time budget for this
   sweep; the class pairing is the only new element and it is a reuse of an
   already-verified pairing).
9. **Landmarks/headings** (point 1): no axe `landmark-*`/`heading-order`/
   `page-has-heading-one` violation on any RUN state; single `<h1>` confirmed
   present (`What-If Analysis`).

## Bottom line

**No violations introduced by run WS.** All axe-core violations found (F1, F3)
and the page-wide "incomplete" color-contrast set (F2) reproduce identically,
node-for-node, on the pre-WS BASE tree (643fa54) — none touch a file WS
modifies. Every WS-introduced surface walked manually (D6 glide reveal, D7
birth-month/removal errors, WS4.2 role="alert" de-duplication, WS1
aria-valuetext generalization, WS4 AC3 native validation) behaves correctly
in both light and dark theme with 0 new violations.
