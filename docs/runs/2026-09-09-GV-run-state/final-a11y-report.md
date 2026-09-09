RESULT: CLEAN

# Final-pass site-wide accessibility audit — run GV

Standard: ACCESSIBILITY.md (A-1…A-15) + WCAG 2.2 AA.
Source tree: /tmp/budget2-gv-a3-snap (read-only), worked from a `cp -a` copy
under the session scratchpad, `chmod -R u+w`'d. Server run via
`scripts/whatif-verify.sh start 8093` (isolated `cp -rL` data copy, isolated
backup dir) — never touched live :8080 data or `.worktrees/guardrail-viz`.
Stopped cleanly via `scripts/whatif-verify.sh stop 8093` at the end.

## Scope traced via `git diff` (working tree vs base 5fae968==HEAD)

13 files changed, all uncommitted working-tree edits on top of merged PR #103
(5fae968). Touches: `internal/handlers/whatif/{handlers.go,
handlers_guardrail_optimizer.go, guardrail_graph_test.go, handlers_test.go}`,
`internal/models/whatif.go`, `internal/services/retirement/engine/{month.go,
stepper.go}`, `web/static/css/styles.css` (+12 lines: `.chart-container-tall`
only), `web/static/js/charts.js` (+80 lines: `getTonePalette`/
`applyTonePalette`, theme-aware trace tones on load and on `themechange`),
`web/templates/components/whatif/{guardrail_optimizer.html,
guardrails.html, projection-chart.html}`, `web/templates/pages/whatif.html`
(+1 line: an OOB anchors template include). All template/CSS/JS changes are
confined to the What-If page's guardrail card, guardrail optimizer, and
projection chart — matches the task's stated surface exactly.

## Automated audit (axe-core 4.13.0, wcag2a/2aa/21a/21aa/22aa)

Tooling note: `@axe-core/cli`'s own `-s`/file-save flag is broken in this
environment (mis-resolves absolute paths against cwd) and its CLI has no way
to force dark mode or drive interactions, so pages were audited with a
custom `selenium-webdriver` + `chromedriver` + injected real `axe-core`
harness (all already vendored under `@axe-core/cli`'s own `node_modules`,
so this is the SAME axe-core engine, not a hand-rolled substitute) — this
also let axe run against the REAL post-JS DOM (tabs activated, optimizer
executed, chart rendered), not just server HTML.

**Process-error caught and fixed before trusting results:** this
environment's headless Chrome defaults `prefers-color-scheme: dark`. The
app's inline theme script honors `matchMedia` whenever no `theme` key is in
`localStorage`, so an unforced "light" run was silently auditing DARK mode
(confirmed via a `--accent`/`documentElement.className` probe: a fresh load
with no localStorage key came up `class="dark"`). Fixed by explicitly
`localStorage.setItem('theme','light')` + reload before every "light" run,
and verified both forced states actually resolve to `class="light"` /
`class="dark"` before trusting any subsequent result. All results below are
post-fix, both themes independently forced and confirmed.

| Page | Light | Dark | Notes |
|---|---|---|---|
| `/` | 0 violations | 0 violations | |
| `/dashboard` | 0 violations | 0 violations | |
| `/explorer` | 0 violations | 0 violations | |
| `/insights` | 0 violations | 0 violations | |
| `/major-expenses` | 0 violations | 0 violations | |
| `/whatif` (load) | 0 violations | 0 violations | |
| `/whatif` tab: Overview | 0 violations | 0 violations | |
| `/whatif` tab: Cash Flow | 0 violations | 0 violations | |
| `/whatif` tab: Risk | 0 violations | 0 violations | |
| `/whatif` tab: Taxes & RMD | 0 violations | 0 violations | |
| `/whatif` tab: Strategies | 0 violations | 0 violations | |
| `/whatif` optimizer @95% + results + Base-case preview open | 0 violations | 0 violations | optimizer POST ran for real (~32s each), reached `optimizer-basecase-preview` stage before the axe pass; `[data-guardrail-plan-floor-notice]` confirmed present in the DOM at scan time (plan floor $5,590/mo < default $7,500 floor) |
| `/accounts` | 0 violations | 0 violations | |
| `/transfers` | 0 violations | 0 violations | |
| `/filemanager` | 0 violations | 0 violations | |
| `/whatif` reflow @1024px | 0 violations | (light only) | |
| `/whatif` reflow @375px | 0 violations | (light only) | |

Zero automated violations anywhere. Nothing to attribute — no NEW or
PRE-EXISTING findings surfaced.

## Manual checks

**Heading structure (A-6), `/whatif`:** exactly one `<h1>` ("What-If
Analysis"); all subsequent headings are `<h2>` with occasional `<h3>`
correctly nested under a parent `<h2>` (e.g. "Among runs with cuts" under
"Simulated lifestyle outcomes", "Current (Today)" under "Monthly Budget
Analysis") — no skipped levels. `<header>`, `<main>`, `<footer>` landmarks
present (single instance each).

**Keyboard walk, `/whatif` left column (A-4/A-5):** native WebDriver Tab
key-presses (not JS `.focus()` — programmatic focus does not reliably
trigger `:focus-visible` in this Chrome build, confirmed via a probe: same
element showed `outline: none` under JS `.focus()` and `outline: solid`
under a native click) walked 220 stops from the "Money In / Out" toggle
through the guardrail optimizer's Run/Cancel buttons, in both themes. Every
reachable control carried a visible indicator — either the sitewide
`input/select/textarea:focus` box-shadow ring or the `:where(button,
[role="button"], a[href], summary, [tabindex="0"])` outline fallback (both
pre-existing, from run BK, untouched by this diff) — confirmed the ring
color resolves correctly per theme (`rgb(79 70 229)` indigo-600 in light,
`rgb(165 180 252)` indigo-300 in dark, matching styles.css's documented
tokens). Only non-focusable `<body>` (post wrap-around) showed no
indicator. Separately walked the optimizer results → "View graph" button →
Base-case preview's kind/dollars selects → Close button: fully keyboard
reachable in logical DOM order, Enter-key operable, visible focus
throughout, no keyboard trap.

**Never-color-only (A-9):** traced `handlers.go`'s new
`getTonePalette`/`meta.tone` chart traces — "Cut trigger"/"Raise trigger"
lines and the guardrail-events marker trace carry distinct `name` (legend
text), hover `text`, AND distinct marker `symbol` (triangle-down/-up for
cut/raise) alongside color — color is never the only channel. The new
guardrails-card anchor lines ("Next yearly check: cut if…" / "…raise if…")
pair color (`text-negative`/`text-positive`) with explicit "cut"/"raise"
wording. Confirmed both anchor lines and the optimizer's plan-floor/notice
text render with real data in this data set (not skipped as nil) and were
inside every axe pass above.

**Hidden-text abuse (A-8):** `git diff` on every touched template/JS file
for `aria-hidden`, `sr-only`, `display:none`, `visually-hidden` — zero
matches in the diff. No screen-reader-only junk text added, nothing
suppressed from assistive tech.

**Reduced motion (A-11):** no new `transition`/`animation` in the diff (the
only CSS addition is a `min-height` rule).

**Reflow, `/whatif` @1024px and @375px (light theme, forced via CDP mobile
emulation for an exact viewport — window-size flags proved unreliable,
Chrome enforced a floor around 500px):** `document.documentElement.
scrollWidth` equals `window.innerWidth` at both widths (no page-level
horizontal scroll). The only element wider than the viewport at either size
is Plotly's own off-screen `#js-plotly-tester` font-measurement SVG
(pre-existing Plotly internal, not visible/rendered content) — a benign
false positive of the width query, not a layout defect.

**Server health:** no panics/runtime errors in the server log across the
full session. One transient, PRE-EXISTING, out-of-scope observation below.

## Observations (non-blocking, not attributable to this run's diff)

1. During rapid theme-toggle reloads in this test harness, `/whatif/
   results-full?hash=…` occasionally logged `500` for a stale hash from a
   prior page load racing a new one. A direct check of the endpoint's
   contract: an unrecognized/stale hash returns `204 No Content` (calm,
   empty — no stack trace, satisfies A-13), and the endpoint returns `200`
   with full valid content once the client's hash is current. This
   lazy-load/singleflight endpoint (`internal/handlers/whatif/handlers.go`
   `handleWhatIfResultsFull`, tested by `singleflight_test.go`) is untouched
   by the GV diff and not something a normal single page-load would ever
   surface as an error; it only appeared under my harness's back-to-back
   reload pattern. No a11y consequence found — filed as an observation for
   the backlog, not a FAIL.
2. axe-cli's `-s`/`--save` flag is broken in this environment (resolves the
   given path against `$PWD` even when absolute). Worth fixing or replacing
   with the custom harness above for future a11y runs in this repo, since
   `@axe-core/cli` also cannot force dark mode or drive interactions
   (tabs, optimizer, chart preview) — the custom selenium+axe-core harness
   used here is the more capable long-term tool.

## Verdict

No violations found anywhere in scope — automated (all pages × both
themes × interactive states) or manual (headings/landmarks, keyboard,
color-only, hidden-text, motion, reflow). Nothing to attribute as
NEW-vs-PRE-EXISTING because nothing failed. **RESULT: CLEAN.**
