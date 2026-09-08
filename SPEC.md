# SPEC.md — budget2 UI audit remediation (U run)

Run prefix: **U** (UI). Target repo: `/home/darrell/bin/ai/budget2`
(all manifest paths and globs are budget2-repo-relative). Source of truth
for the findings: the 2026-09-03 UI audit artifact
(https://claude.ai/code/artifact/40a73b41-9b02-40a1-a5b8-c2375b3dbd57,
private — embeds the user's real figures). Counts below were re-measured
on 2026-09-03 against the budget2 working tree and match the audit exactly
(45 / 20 / 548 text sizes, 30 inline scripts, 9 `!important`, h1 counts).

Previous run's spec (CC — per-person care costs, closed 2026-09-01) is
preserved in git history on master. This run's `.swarm/` lives in THIS
agents2 worktree (gitignored), as the CC run's did.

## 0. Status — APPROVED 2026-09-03

User signed off on all §5 tiers/checks and took every §7 default (D1–D8),
including merging budget2 PR #89 before branching and adopting
ACCESSIBILITY.md point 17. Mid-run, tiers move only up.

## 1. Motivation

The audit's verdict: the app is feature-complete and visually consistent;
what holds it back is (a) six layouts that render wrong at real widths,
(b) a 10 px type floor for a primary reader who is 67, and (c) page
structure that puts setup forms and long lists ahead of the task the user
came to do. Seventeen findings fold into fifteen tasks. Six touch money
surfaces and carry the `second` lane. One (Clear All) is irreversible and is
Tier 3.

## 2. Design decisions

Each subsection is the contract a worker builds to and a checker checks
against. Where a decision is still the user's, §7 records the default.

### 2a. Tokens: palette and type (U6)

**Palette.** Twelve Tailwind hue families currently carry four meanings
(indigo 390 / red 363 / amber 289 / green 255 / emerald 153 / blue 151 /
rose 148 / purple 41 / orange 15 / yellow 14 / cyan 8 / sky 2 class sites).
One semantic set, defined ONCE as CSS custom properties in
`web/static/css/styles.css` (light + `.dark` values) and exposed through
`tailwind.config.js` `theme.extend.colors` so templates name the meaning:

| Token | Meaning | Light hue (from today's dominant family) |
|-------|---------|-------------------------------------------|
| `accent` | interactive / brand | indigo |
| `positive` | income, under budget, gain | emerald |
| `negative` | outflow, over budget, loss, destructive | rose |
| `warning` | caution, stale, unresolved | amber |
| `neutral` | chrome, muted text, rules | gray |

Rules: red→negative, green→positive, blue/purple→accent, yellow/orange→
warning, cyan/sky→accent or neutral (worker picks per site, no new hue).
Acceptance counts hue families remaining in `web/templates/**`: ≤ 6
(the five above plus `white`/`black`/`transparent` utilities, which don't
count as families). Every text-on-fill pair must meet 4.5:1 in BOTH
themes — the audit did not measure light-mode contrast; U6's axe run does.

**Type (contract v2, 2026-09-03, after two same-class FAILs).** Floor of
**12 px** for label-class content and **14 px** for anything read as a
sentence, expressed as two tokens in `tailwind.config.js` `fontSize`
(`label` = 0.75rem/1rem tracking-wide; `body-sm` = 0.875rem/1.25rem).
`text-[10px]` and `text-[11px]` go to ZERO. "Label-class" is decided
MECHANICALLY by `.swarm/tier3/U6/typefloor_allowlist.py`, not by sampling:
a surviving `text-xs` element is DENIED (must become `text-body-sm` or
larger) when any of — R1 its tag is `p table tbody td details li ul ol dl
dt dd blockquote section article h1–h6`; R2 it contains a `<p>`, `<table>`,
`<li>` or heading descendant; R3 any single text run inside it (tags and
template actions are run boundaries) has ≥ 6 words or ends with a period;
R4 it renders a template variable named like prose (Rationale, Summary,
Explanation, Reason, Message, Note, Hint, Help, Blurb, Caption, Warning,
Verdict, Sentence, Advice, Insight, Tip). `th`, `label`, `button`, `input`,
`select`, `summary`, `code`, badges, eyebrows and short spans/divs stay
allowed. The script must report 0 denied elements. Tailwind must be
rebuilt (`make css`) and `make css-verify` must pass.

**Rendered bar (contract v2).** Both probes run with EVERY `<details>`
opened — collapsed panels are user-visible content and axe skips hidden
nodes: (i) zero axe `color-contrast` violations on all 9 pages in both
themes at 1440; (ii) no horizontal overflow (`documentElement.scrollWidth
≤ viewport`) on all 9 pages in both themes at 1440 and 1280. A size bump
that pushes a table past its card must be fixed at the table (wrap it in
`overflow-x-auto` with `tabindex="0" role="region"` and an accessible name,
or tighten columns), never by shrinking the type back.

### 2b. Shared partials and script extraction (U7)

New partials under `web/templates/components/shared/`:
`range-picker.html` (dates + one quick-button set; the Dashboard-only
`comparison` selector is a slot, not part of the partial), `kpi-tile.html`
(label, value, delta, optional sparkline `<canvas>`/`<svg>` slot — ONE
sparkline style), `card.html` (shell: title, optional actions slot, body),
`data-table.html` (`<table>` with `<th scope="col">`, responsive column
classes, optional sortable-header buttons). Every page that has one of
these uses the partial; the checker greps for surviving hand-rolled copies.

Scripts: the 30 inline `<script>` blocks move to `web/static/js/<page>.js`
(one file per page, behavior attached by `id`/`data-*` hooks, no inline
`onclick=`). Allowance: **≤ 5** inline blocks may remain, and the theme
bootstrap in `layouts/base.html` (must run before first paint to avoid a
flash) is one of them; each survivor gets a one-line comment saying why.
The 9 `!important` rules in `styles.css` are removed by loading
`styles.css` AFTER `tailwind.css` in `base.html` (ordering, not weight);
acceptance is zero `!important` in `styles.css` with the visual result
unchanged on the affected elements.

### 2c. One date range across pages (U8)

All four range-bearing handlers already read `start` and `end` from the
query string (dashboard, explorer, insights, majorexpenses — verified
2026-09-03). Contract: the range lives in the **query string** (the URL
says what window you are looking at; no invisible session state). The
range partial (2b) renders it; the nav links in `base.html` propagate the
current `start`/`end` when present, via one template func
(`withRange href`) — so Dashboard → Explorer keeps the window. Insights'
`preset` and Dashboard's `comparison` stay page-local. Pages without a
range (What-If, Accounts, Transfers, File Manager, Duplicates) drop the
params. MCP tools take their own explicit params and are untouched;
the checker confirms by running the MCP tool tests unchanged.

### 2d. Zero-baseline change display (U5) — contract v3 (2026-09-03, after two same-class FAILs)

Today `internal/services/insights/trends.go` sets `changePercent = ±100` when
`previous == 0` and otherwise `change / |previous| * 100`, so a $0→$X row
prints "+100.0%" and a $30→$6,931 row prints "+23004.0%". Attempts 1 and 2
failed to the same class (ruling 2026-08-29b — displayed figures that
contradict): first the dollar delta was derived from unrounded floats;
then a float-noise sum (0.10+0.20−0.30 ≈ 5e-17) in `MajorExpenseTrends`
rendered $0.00 → $0.00 as "+100.0%" with an up arrow, because the
producer classified on raw floats while the display rounded. The root
cause is that money becomes a FIGURE at the producer, and rounding must
happen there, once, before anything is derived.

**Rule 1 — round at the source.** Both producers (`CategoryTrends`,
`MajorExpenseTrends`) pass every `current` and `previous` total through
`models.RoundToCents` (the `fmt.Sprintf("%.2f")` primitive `formatMoney`
uses) immediately after summation. No unrounded money leaves a producer.

**Rule 2 — one classifier.** `ChangeDisplay(previous, current float64)
models.ChangeCell` takes the ROUNDED pair only (no percent input) and
computes everything downstream:
- `change = current − previous`.
- `pct`: if `previous == 0` → +100 when `current > 0`, −100 when
  `current < 0`, 0 when both are 0; else `change / |previous| * 100`.
- `Kind`: `previous == 0 && current > 0` → **new** (text "new");
  `previous == 0 && current == 0` → **none** (text "—", accessible text
  "no change"); `previous ≠ 0 && |previous| < ChangeDollarFloor (100)`,
  or `previous == 0 && current < 0` → **dollar** (signed, via the
  formatMoney path); otherwise → **percent** (signed, one decimal).
- `Direction`: from `pct` with the existing thresholds (> 5 up, < −5
  down, else stable); **none** rows are stable.
The cell carries `Kind, Text, Amount, Percent, Direction`. Producers set the
row's `ChangeAmount`, `ChangePercent` and `Direction` FROM the cell, so the
MCP tool, the arrow/color, and the cell share one source. Templates render
the arrow/color from the same row `Direction` (no template branches on a
raw number).

**Rule 3 — self-consistency is the tested property.** A property test
drives the REAL producer path (transactions → producer → templates at BOTH
sites) with a few thousand random pairs including fractional cents,
negatives, float-noise sums, and values within ±0.006 of the floor, and
asserts on the RENDERED strings: (i) dollar rows: Change equals Current −
Previous parsed from the displayed strings; (ii) if displayed Current ==
displayed Previous then Kind is none (prev 0) or percent "0.0%" and
Direction is stable; (iii) new rows: displayed Previous is "$0.00" and
Current ≠ "$0.00"; (iv) percent rows: the displayed percent equals the
percent recomputed from the displayed dollars, to one decimal. Named
fixtures stay: 30.005/6931.004, 0/12.345, 250.555/300.001, 99.995/150.005
(percent), 40.00/140.115 (dollar, rounding divergence), and the
MajorExpenseTrends float-noise case (0.10+0.20−0.30 with no prior
activity → "—", stable).

**MCP.** `get_trends` `change_percent`, `change_amount` and `direction`
now derive from the rounded totals: identical to before for every
cent-valued input (existing spend tests pass unchanged) and different only
where float noise previously produced a phantom ±100 / "up". Consequently
`change_amount` equals the UI's dollar delta EXACTLY (both are
rounded-current − rounded-previous). The tool description must state,
accurately against the code (checker-tests attempt-2 findings d-1..d-3):
`change_percent` is +100 when `previous_amount` is 0 and `current_amount`
is positive, −100 when it is negative, 0 when both are 0; the web UI shows
"new" for the first case, "—" ("no change") for the last, a signed dollar
delta when `previous_amount` is 0 and `current_amount` is negative or when
0 < |`previous_amount`| < $100, and a percent otherwise; and
`change_amount` is the same figure the UI's dollar delta shows. No other
threshold wording (the |previous| rule lives in ONE place — say "the
absolute value", not "under $100" without it).

Surfaces the checker ENUMERATES: `insights.html` both Change cells and
both Direction/arrow sites, `data-change` attributes (+ `sortTrendsTable`,
sort-only), MCP `get_trends`, and any other renderer of these fields.

### 2e. Navigation and one product name (U9)

Three groups in both the desktop bar and the mobile menu: **Money**
(Dashboard, Explorer, Insights, Major Expenses), **Plan** (What-If),
**Setup** (Accounts, Transfers, File Manager, Duplicates — Duplicates keeps
its unresolved-count badge). Groups are labelled (visible text at desktop,
headings in the mobile menu), keyboard-operable, `aria-current="page"` on
the active link. One product name in header, footer and `<title>`
(§7 decision; default **simpleBudget**, the name ACCESSIBILITY.md and the
repo already use).

### 2f. Dashboard verdict band and drop-zone (U10)

Net Savings moves OUT of the verdict band into the KPI row (§7 default)
with a label that says what the figure is. The figure is
`metrics.Calculate`'s `netSavings = totalIncome − |all outflows|`
(`internal/services/metrics/metrics.go:379`) over the FULL outflow set
regardless of plan-exclusion flags. The worker derives the label from
that code and cites the lines in the manifest note; `checker-content`
verifies the label against the code, not against this spec's paraphrase
(candidate: "Net savings — income minus every outflow, including
transfers and one-time"; if transfers are NOT in the outflow set the
candidate is wrong and the worker must say so). The verdict sentence and
its classification are unchanged for the same data. The CSV drop-zone
becomes a header-level button on the Dashboard page header (dashboard.html,
not base.html — U9 owns base.html); whole-page drag-and-drop still imports.

### 2g. Page structure (U11, U12, U13)

- **Major Expenses (U11):** one column, Exceptions panel first at full
  width; Definitions below as a searchable list collapsed by default; the
  delete control exists only inside an expanded definition row; the page
  title moves to the same position as every other page (above the filter).
  Existing filter and pin handler tests are the regression oracle.
- **Accounts (U12):** each account renders as a summary card (name, kind,
  matched-file count, latest anchor) with an Edit toggle that reveals the
  existing form; "Add an account" is behind a button; exactly one `<h1>`
  (page has 3 today; `components/accounts_card.html` carries one). Existing
  accounts handler tests green; handlers untouched.
- **What-If rail (U13):** removing an income source shows an Undo toast
  (button posting to the existing `/whatif/income/{id}/restore`) that
  persists until dismissed or the next full page load; the permanent
  "Recently Removed" list is removed (§7 default; note the trade-off there).
  Person card: name once (header), `Source:` shown only when not manual;
  slider value beside its label; Quick Adjust FAB reserves bottom padding so
  it never covers the last card at 1440 or 390.

### 2h. Clear All (U14 — Tier 3)

Today `hx-delete="/data/all"` with a generic `hx-confirm`, styled as a text
link beside "Load Test Data"; the handler
(`internal/handlers/backup/handlers.go:535 HandleDeleteAllData`) deletes
every `.csv` in the data dir via the storage service. Contract:

1. A secondary **button** (`<button>`, ≥ 24×24, negative token), visually
   separated from Load Test Data.
2. The confirm names the count: "Delete all N data files? …" where N is
   server-rendered.
3. **Server-side count confirmation (§7 default yes):** the request carries
   `expected_count=N`; the handler recounts and refuses with 409 and deletes
   NOTHING when the count differs or the field is missing. This makes
   "a cancelled or stale confirm deletes nothing" an executable oracle
   (curl), not a browser-only claim.
4. Encryption card collapsed by default behind a disclosure button
   (`aria-expanded`), expanded state announced.
5. Storage suite green at uid 0 and non-root (P1 precedent).

### 2i. Accessibility cluster (U15) and a proposed ACCESSIBILITY.md point

Zero clickable `div`/`span`/`tr` (15 sites today, every KPI card among
them — links navigate, buttons act; a whole-row link uses an `<a>` in the
first cell plus a row-level JS enhancement, never `onclick` on the `<tr>`).
Four overlays (kpi-detail, kpi-month-detail, major-expense-drilldown, File
Manager plaintext modal) get `role="dialog"`, `aria-modal="true"`,
`aria-labelledby`, focus moved in on open and restored on close, Tab
trapped inside, Esc closes. One `<h1>` per page (Transfers has 2).
Acceptance: axe zero violations sitewide, both themes.

**Proposed amendment to budget2 `ACCESSIBILITY.md` (user sign-off — it is
the checkers' constitution):** add point 17 so the modal contract is
citable rather than an implicit companion requirement (point-16 precedent):

> 17. Modal overlays are dialogs. Any layer that blocks the page carries
>     `role="dialog"` (or `alertdialog`), `aria-modal="true"`, an accessible
>     name, moves focus into itself on open and back to the invoking
>     control on close, traps Tab, and closes on Esc.

Checkers run against budget2's `ACCESSIBILITY.md` (16 points, plus 17 if
approved). This repo's own ACCESSIBILITY.md governs the swarm dashboard,
not budget2. No content is migrated, so no SOURCES.md.

## 3. Out of scope (this run)

Chart library changes beyond legend/axis placement; any change to what a
figure IS (only how it is laid out, labelled or floored); MCP tool
numbers; Transfers chart "Loading chart…" (unverified capture artifact);
screen-reader session testing of the modals (markup is the deliverable;
the `Accessibility Auditor` agent may be used for a manual pass after U15).

## 4. Worker constraints (paste into every dispatch)

- Repo: `/home/darrell/bin/ai/budget2`. Work ONLY in the run worktree
  `/home/darrell/bin/ai/budget2/.claude/worktrees/ui-audit` on branch
  `feat/ui-audit` (lead creates it before dispatch; workers commit nothing —
  the lead commits). The main checkout is on another session's branch and
  is OFF LIMITS: never `git checkout`, `stash`, or touch its index.
- **Never run the built budget2 binary** — any invocation, even `--help`,
  starts a server and kills the live :8080 instance. `go build ./...`,
  `go vet ./...`, `go test ./...`, `staticcheck ./...` only. For rendered
  checks use `scripts/whatif-verify.sh start 8099` (throwaway data copy,
  `/killme` teardown) or the demo instance on :8081
  (`~/bin/ai/budget2-demo/run-demo.sh`), never :8080.
- Run tests bare, or with `set -o pipefail` — never `go test … | grep`.
- Templates changed → `make css` and commit the rebuilt
  `web/static/css/tailwind.css`; `make css-verify` must pass.
- One formatter per value (`formatMoney` path), one rule per threshold,
  one source per figure. Assert on RENDERED strings.
- ACCESSIBILITY.md (budget2) points apply to every element you touch;
  both themes.
- Write your manifest to
  `<agents2 worktree>/.swarm/manifests/<task>.<attempt>.files`
  (budget2-repo-relative paths, one per line).

## 5. Task breakdown

Tier per TIERS.md (oracle, reversibility, blast radius); `second` wherever
a wrong figure on screen would be a lie. Checks name the ledger column.

| ID | Task | Fixes | Files | Tier | Checks | Why this tier | Acceptance criteria |
|----|------|-------|-------|------|--------|---------------|---------------------|
| U1 | Explorer responsive columns: hide Source and Major Expense below `md`; keep Date, Description, Amount; Description wraps | F1 | `pages/explorer.html` | 1 | a11y | Strong oracle (viewport render + axe), one page, reversible. | (a) At 390 px Date, Description, Amount visible, no horizontal scroll (`document.documentElement.scrollWidth <= 390`). (b) axe clean at 390 and 1440, both themes. (c) Column headers still `<th scope="col">`. |
| U2 | Dashboard KPI row: four columns with Budget card spanning two; ONE sparkline style | F2 | `components/kpis.html`, `static/js/charts.js` (corrected, ruling c) | 2 | a11y,second | Weak oracle (overlap is visual) and five money figures re-rendered. | (a) No text node's bounding box intersects a sparkline box at 1280, 1440, 1920 (headless probe). (b) Every KPI figure string is byte-identical to master's for the same data (verify server on a fixed data copy, curl both trees, diff the `.num` texts). (c) One sparkline implementation (grep: one draw function, one class). (d) axe clean both themes. |
| U3 | Insights: tables stop clipping; trend-chart legend clear of tick labels | F3 F4 | `pages/insights.html`, `static/js/charts.js` | 2 | a11y | Weak oracle, one page; figures re-laid-out but not re-formatted. | (a) Annual column fully visible at 1440 (no `overflow` clip; cell text bounding box inside card). (b) Legend bounding box intersects no x-tick label box. (c) Chart's data-table alternative (point 11) unchanged. (d) axe clean both themes. |
| U4 | What-If projection card on small screens | F5 | `components/whatif/projection-chart.html` | 2 | a11y | Weak oracle, one component. | (a) At 390 px both dollar-mode toggle labels render in full (no clipping/ellipsis; each label's scrollWidth ≤ clientWidth). (b) Chart x-axis visible; Plotly `responsive: true`, container full width. (c) `whatif-tabs.js` tab persistence still works (existing test or probe). (d) axe clean both themes. |
| U5 | Zero-baseline change display (§2d) | F6 | `internal/services/insights/trends.go`, `pages/insights.html`, `mcpsvc/spend/trends.go` (doc only) | 2 | tests,second | Threshold applied to a figure on multiple surfaces — split-classification class; money copy. | (a) `previous == 0` renders "new"; `0<|previous|<$100` renders signed dollar delta via `formatMoney`; else percent. (b) ONE Go function; checker enumerates §2d surfaces and proves each consumes it. (c) Table test with fractional-cent fixture asserts RENDERED strings at both template sites. (d) MCP `change_percent` numerically unchanged (existing tests pass untouched) and its description states the rule. (e) `go build/vet/test/staticcheck` green. |
| U6 | Design tokens and type floor (§2a) | F7 F8 | `static/css/styles.css`, `tailwind.config.js`, `templates/**`, rebuilt `tailwind.css` | 2 | a11y | Shared blast radius (every page); reversible; oracle is grep counts + axe. | (a) `grep -r 'text-\[1[01]px\]' web/templates` = 0. (b) Semantic tokens defined once; `tailwind.config.js` maps them; hue families in templates ≤ 6. (c) axe reports zero contrast violations on all 9 pages in BOTH themes. (d) `make css-verify` passes. (e) Sample of 20 surviving `text-xs` sites: none sentence-class. |
| U7 | Shared partials and script extraction (§2b) | F9 | `components/shared/**`, `static/js/**`, `layouts/base.html`, `styles.css` | 2 | tests,a11y | Shared blast radius; handler/template tests are the oracle. | (a) Range picker, KPI tile, card, data table partials used on every page that has one (grep: no hand-rolled duplicates). (b) Inline `<script>` blocks in templates ≤ 5, each with a why-comment. (c) `!important` in `styles.css` = 0; stylesheet order verified. (d) Full `go test ./...` green. (e) axe clean sitewide both themes. |
| U8 | One date range across pages (§2c) | F11 | `layouts/base.html` (nav links), `components/shared/range-picker.html`, the four range handlers/templates | 2 | tests,second | The range decides every figure on four pages; a wrong window is a wrong number everywhere. | (a) Set a range on Dashboard, follow nav to Explorer, Insights, Major Expenses: identical `start`/`end` in URL and rendered range text. (b) Handler tests for propagation and for pages that drop the params. (c) `comparison`/`preset` remain page-local. (d) MCP tool tests unchanged and green. (e) Checker attempts to produce a window mismatch and fails. |
| U9 | Nav grouping and one product name (§2e) | F10 | `layouts/base.html` | 1 | a11y | Strong oracle (axe + string check), one file, reversible. | (a) One name in header, footer, `<title>` (grep: zero "Financial Dashboard"/"Budget Dashboard" unless it IS the chosen name). (b) Three labelled groups at desktop and in the mobile menu. (c) Menu keyboard-operable, `aria-current` on active link, `aria-expanded` toggle intact. (d) axe clean both themes. |
| U10 | Dashboard verdict band and drop-zone (§2f) | F12 | `components/dashboard-verdict-bar.html`, `components/kpis.html`, `pages/dashboard.html` | 2 | content,second | Money copy: the label must match what the figure actually is. | (a) Net-savings label's definition confirmed against `metrics.Calculate` by checker-content (code citation). (b) Figure string unchanged for the same data. (c) Verdict sentence and class unchanged for the same data. (d) Drop-zone is a page-header button; whole-page drop still triggers import (probe). |
| U11 | Major Expenses: exceptions first (§2g) | F13 | `pages/major-expenses.html` | 2 | tests,a11y | Weak oracle, one page; filter/pin handler tests are the regression oracle (audit named a11y only — `tests` added so someone runs them). | (a) Exceptions panel renders above definitions at full width. (b) Delete control absent from collapsed rows, present inside expanded row only. (c) Page title position matches other pages. (d) majorexpenses handler tests green. (e) axe clean both themes. |
| U12 | Accounts as summary cards (§2g) | F14 F17 | `pages/accounts.html`, `components/accounts_card.html` | 2 | tests,a11y | Weak oracle, one page; account edits stay on existing handlers (audit named a11y only — `tests` added for the accounts suite). | (a) Exactly one `<h1>`. (b) Add-form hidden until requested (disclosure button, `aria-expanded`). (c) Each card shows name, kind, matched-file count, latest anchor. (d) Edit toggle reveals the existing form; accounts handler tests green. (e) axe clean both themes. |
| U13 | What-If settings rail (§2g) | F15 | `components/whatif/income-sources-list.html`, `healthcare-person.html`, `quick-adjust.html`, `static/js/whatif-*.js` | 2 | tests,a11y | Replacing "Recently Removed" changes the restore path, which is plan data. | (a) Undo restores a removed source with identical fields (handler test: remove → restore → deep-equal). (b) Toast has a focusable Undo button, `role="status"`, dismissible by keyboard. (c) Person card shows the name once; `Source:` absent when manual. (d) Slider value adjacent to label. (e) Last card not covered by FAB at 1440 and 390. (f) axe clean both themes. |
| U14 | File Manager: Clear All button + count-confirm + encryption fold (§2h) | F16 | `pages/filemanager.html`, `internal/handlers/backup/handlers.go` | 3 | tests,second | Irreversible: the control deletes data files. Oracle first (`accept.sh`), full dual lane regardless of column. | (a) `accept.sh` written and validated at both ends BEFORE dispatch. (b) Clear All is a `<button>`, separated from Load Test Data, confirm names N. (c) DELETE without `expected_count` or with a stale count → 409, zero files removed (curl oracle). (d) Matching count deletes exactly the CSVs and backup dir survives. (e) Encryption card collapsed by default. (f) Storage suite green at uid 0 and non-root; full `go test ./...` green. (g) axe clean both themes. |
| U15 | Accessibility cluster (§2i) | F17 | `components/kpi-detail.html`, `kpi-month-detail.html`, `major-expense-drilldown.html`, `pages/filemanager.html`, `pages/transfers.html`, remaining onclick sites | 2 | a11y | Strong oracle but shared blast radius (every page). | (a) `grep -rE '<(div|span|tr)[^>]*onclick' web/templates` = 0 and no `onclick=` anywhere in templates. (b) Every modal: `role="dialog"`, `aria-modal`, accessible name, focus in/out, Tab trap, Esc (probe each). (c) One `<h1>` per page (all 9). (d) axe zero violations sitewide, both themes. (e) Every data table has `<th scope="col">` headers (ruling e). |

Tier rationale summary: U1/U9 are single-file, strong-oracle, reversible →
Tier 1. Everything else is reversible pre-merge but either weak-oracle
(visual) or shared-blast-radius → Tier 2; `second` on the five tasks where
a figure or its label is re-rendered (U2, U5, U8, U10) or the action is
destructive (U14). U14 is not reversible → Tier 3.

Deviations from the audit's table (for sign-off): U11 and U12 gain `tests`
(their acceptance lines already required handler suites green; a named
checker must run them). U5 lists two template render sites, not one. U14
adds server-side count confirmation so the "cancelled confirm deletes
nothing" claim has a curl oracle. U13 lists the JS files.

## 6. Run order and dependencies

Four waves; tasks within a wave run as parallel workers.

- **Wave A — broken layouts:** U1, U2, U3, U4, U5 (independent).
- **Wave B — foundation:** U6, then U7 (partials are written in the token
  vocabulary; U7 also absorbs U2's KPI tile into the partial).
- **Wave C — shell:** U8 (needs U7's range partial), U9, U10. U9 owns
  `base.html`'s nav; U8 touches only the nav-link `href` func in it —
  dispatch U9 first, then U8 and U10 in parallel.
- **Wave D — pages:** U11, U12, U13, U14 (Tier 3, oracle authored during
  wave C), U15 last (it sweeps whatever onclick sites survive A–D).

Worker choice: U6's bulk class replacement is `worker-local` territory
(mechanical, ~600 sites) after `worker-coder` defines the tokens; the two
halves are one task, one manifest. U14 is always `worker-coder`.

## 7. Decisions — all defaults approved by the user 2026-09-03

| # | Question | Default |
|---|----------|---------|
| D1 | U10: keep Net Savings in the verdict band with a definition, or move it to the KPI row? | Move it. |
| D2 | U11: one column exceptions-first, or two columns with exceptions left? | One column, exceptions first. |
| D3 | U13: drop "Recently Removed" for an Undo toast, or keep it collapsed? Trade-off: toast-only means no restore UI after a page load (the data stays in the plan file; restore remains possible via the handler). | Toast only. |
| D4 | U5: floor below which a percent becomes a dollar delta. | previous < $100. |
| D5 | U9: the one product name. | simpleBudget. |
| D6 | U14: add server-side `expected_count` confirmation (handler change) or template-only? | Add it. |
| D7 | ACCESSIBILITY.md point 17 (modal dialogs) — adopt into budget2's standard? | Adopt before U15 dispatch. |
| D8 | Branch base: budget2 PR #89 (tax-optimizer run feedback) is OPEN and touches `layouts/base.html` and `tailwind.css`, both in U6/U7/U9's territory. Merge #89 first and branch `feat/ui-audit` from the result, or branch from master b390472 now and rebase later? | Merge #89 first. |

## 8. Tier-3 oracle plan (U14)

`.swarm/tier3/U14/accept.sh` (chmod +x), written before dispatch, run
against the verify server on a throwaway data copy:

1. Seed N CSVs; GET `/filemanager` → asserts a `<button>` whose confirm text
   contains "N" and no `<a>`/text-link Clear All.
2. `curl -X DELETE /data/all` (no field) → 409; file count still N.
3. `curl -X DELETE -d expected_count=$((N-1))` → 409; count still N.
4. `curl -X DELETE -d expected_count=N` → 200 "Deleted N files"; zero CSVs;
   backup dir intact.
5. Encryption card: disclosure button present with `aria-expanded="false"`,
   panel hidden.
6. `go test ./internal/handlers/backup/... ./internal/services/storage/...`
   green; emit `ORACLE PASS` only on the all-pass path.

Both-ends validation: a featureless tree must fail 1–3 and 5; a throwaway
prototype must pass all six, then be discarded.

## 9. Lean-experiment bookkeeping

Record every catch in §10 with the mechanism (oracle / primary checker /
second / judge / gate / worker). At run end: `swarm/gate.sh stats` and
report the first-attempt clean rate verbatim.

## 10. Rulings

- **U-2026-09-03a** (scope ruling, lead, before any checker ran): "axe clean
  both themes" on a per-page task (U1–U4, U9–U13) means (1) zero violations
  within the elements the task touched, AND (2) zero NEW violations page-wide
  relative to the master baseline rendered from the same data. Pre-existing
  violations on untouched elements are reported as observations for U15,
  which owns the sitewide sweep — not FAILs (precedent: CC-2026-08-31c,
  ruling 2026-08-29c/d). U6, U7, U15 keep the sitewide-zero criterion as
  written. Trigger: U4's worker found pre-existing `label`, `select-name`,
  `color-contrast`, `target-size` violations in the What-If settings rail.
- **U-2026-09-03b** (catch — mechanism: WORKER report, U1 attempt 1; a
  brief-level scoping error): the audit/spec scoped U1 to the transaction
  table, but criterion (a) is page-level (no horizontal scroll at 390 px) and
  the explorer's Date Range filter block (explorer.html ~69-100: From/To
  inputs, step buttons, 1M–12M quick buttons in one non-wrapping flex row,
  652 px wide) overflows on its own. Also, hiding only Source + Major Expense
  left the table at 684 px; the worker additionally collapsed Category and
  Type below `md`, keeping Date/Description/Amount — consistent with the
  spec's intent and accepted. Ruling: U1's scope EXPANDS to the filter block
  on the same page with the minimal fix (wrap the row; quick buttons wrap
  onto their own line; every control keeps its label and ≥ 24×24 target),
  because U7/U8 replace this block with the shared range partial later.
  Tier stays 1 (one file, strong oracle). The worker stopped instead of
  guessing — the behaviour the constitution asks for.
- **U-2026-09-03e** (catch — mechanism: PRIMARY CHECKER checker-a11y, U1
  attempt 1, observation): U1's criterion (c) assumed the explorer headers
  carry `<th scope="col">`; neither master nor the branch has `scope` on ANY
  `<th>` (ACCESSIBILITY.md point 2). A pre-existing gap the audit did not
  count, so not a U1 FAIL. Added to U15's scope: every data table sitewide
  gets `<th scope="col">` (and `scope="row"` where a row header exists);
  U7's data-table partial emits it by construction.
- **U-2026-09-03f** (catch — mechanism: SECOND CHECKER, U5 attempt 2, FAIL
  CONCEDED; same class as ruling d): `MajorExpenseTrends` sums signed
  amounts with plain float addition, so 0.10+0.20−0.30 ≈ 5e-17 with no
  prior activity rendered Previous $0.00, Current $0.00, Change "+100.0%",
  arrow up — reproduced through the real producer path. Attempt 2 rounded
  inside ChangeDisplay but the producer's raw `change > 0` classification
  and raw `changePercent` pass-through survived (split classification).
  Two failures to one class ⇒ lead/spec defect (T18 precedent): §2d
  rewritten as contract v3 — round at the source, one classifier that also
  owns Direction, property test on rendered self-consistency. Attempt 3 is
  the last before the hard stop. The 200k-sample brute-force probe is
  promoted into the property test.
- **U-2026-09-03h** (escalation — mechanism: PRIMARY CHECKER checker-a11y
  twice + GATE escalate-scan; U6 → Tier 3): attempt 2 failed (e) again
  (monte-carlo rationale divs, rate-assumptions:473 wrapper — siblings of
  sites the lead had just converted) and (g) — the 12→14 px bump pushed the
  major-expenses "anomalous" table into page-level horizontal scroll.
  Two same-class failures ⇒ contract defect: "a random sample of 20 finds
  no sentence-class site" was a lottery over ~300 survivors with no
  mechanical definition. §2a rewritten (contract v2): the type floor is
  an executable allow-list (R1–R4) and the rendered bar is measured with
  every `<details>` opened. The lead's oracle (`.swarm/tier3/U6/accept.sh`,
  fail-end log `failend-validation.attempt2-tree.log`) flags 23 denied
  elements (the checker's three among them) AND, by opening the panels,
  33 light-mode + 1 dark-mode contrast failures on /major-expenses that
  neither the worker's nor the checker's axe runs had seen — hidden content
  was the gap in both. Attempt 3 is the last before a hard stop and goes to
  a worker (Tier 3 is never lead-direct).
  Addendum (PRIMARY CHECKER checker-a11y, U6 attempt 3, PASS with a
  methodology catch): /whatif keeps 4 of 5 tabs in `hidden` JS panels
  (whatif.html:195-221, whatif-tabs.js), so no oracle or checker run before
  this one had ever scanned most of U6's what-if content; the checker
  clicked every tab and found zero contrast violations on the branch (the
  baseline has 13–60 per tab). Attempt-4 oracle must activate every tab
  and open every modal before measuring, in addition to opening details.
  Addendum (PRIMARY CHECKER checker-tests, U5 attempt 2, FAIL on (d)): the
  MCP description added at attempt 1 made three claims the code
  contradicted — "new" for any zero previous (a negative current renders
  −100.0%), "under $100" without the absolute value (−$628 previous rendered
  a percent), and "change_amount via the same money formatting" (math.Round
  vs fmt rounding diverged on 5 of 2e6 samples, e.g. 4.246/686.823 →
  UI $682.57 vs 682.58). d-1 traces to §2d's own attempt-1 paraphrase — a
  second spec-level catch on this task. Folded into contract v3's MCP
  paragraph; the 4.246/686.823 pair is a named oracle fixture.
  Outcome: U5 ACCEPTED at Tier 3 attempt 3 (oracle 11/11, both lanes PASS;
  checker-second fuzzed ~200k pairs on fresh seeds, checker-tests killed all
  three mutants with the worker's own suite). Backlog from the verdicts:
  (1) `data-change` sort key is the raw percent; (2) MCP `change_percent`
  is round2 of the pct while the UI prints %.1f of it — one tenth apart on
  4 of 230 live rows, pre-existing on master; (3) `ChangeCell.Text` is
  write-only dead code (a second home for the cell text) — remove; (4) a
  "+0.0%" is constructible but not live. Candidates for a follow-up task
  after wave D; none block the row.
- **U-2026-09-03i** (catch — mechanism: SECOND CHECKER, U6 attempt 3, FAIL
  CONCEDED; HARD STOP): `renderError()` in
  `internal/handlers/{accounts,whatif,majorexpenses}/handlers.go` builds an
  error banner with literal `red-*` classes via fmt.Sprintf. Those classes
  were only ever in the built CSS because ~20 templates used them; U6's
  sweep converted every template site to tokens, so Tailwind's content scan
  purged them and 36 error paths (missing id, not found, invalid form,
  failed save/delete) now render with no background, border or intended
  colour. Reproduced live via three POSTs. Attempt 1's worker had noticed
  the helper and declared it out of scope; the lead accepted that judgment
  — the error was the lead's: a token sweep's scope is every EMITTER of a
  colour class, not every template. No oracle check reached it (the hue
  grep scans templates; the render probe only GETs 9 pages). Third failed
  attempt (a11y, a11y, second) ⇒ hard stop per the constitution; the
  lead does NOT silently loop. Proposed resolution for the user: reopen U6
  as attempt 4 with the explicit scope "renderError literals → token
  classes in the three handlers (+ their tests), safelist audit of every
  Go/JS colour-class emitter, oracle extended with a POST error-path
  render check", lead-direct or worker, then re-verify at Tier 3.
  Wave B/C/D are blocked behind U6 (the partials must use the tokens).
- **U-2026-09-03c** (catch — mechanism: WORKER report, U2 attempt 1; brief
  error inherited from the audit): the sparkline draw function
  (`renderSparkline`/`initSparklines`) lives in `web/static/js/charts.js`,
  not `dashboard.js` as the audit and §5 named. Worker edited charts.js and
  left dashboard.js untouched — accepted. §5 row U2 files corrected below.
  Observation for U10/U7: with five cards in a four-column grid and Budget
  spanning two, row 2 holds Budget alone with two empty cells at `xl`+;
  U10 (Net Savings tile) and U7 (KPI tile partial) revisit the row's shape.
- **U-2026-09-03d** (catch — mechanism: SECOND CHECKER, U5 attempt 1, FAIL
  CONCEDED): the dollar delta was formatted from the raw float difference
  while Current and Previous are formatted from their own raw values, so
  with previous 99.995 and current 150.005 the row renders Current $150.00,
  Previous $100.00, Change +$50.01 — the displayed figures do not sum
  (ruling 2026-08-29b class). The worker's fractional-cent fixture happened
  not to trigger it, and the render test computed its expected string from
  the raw float independently, so the test proved nothing about the
  invariant. Fix contract for attempt 2: ONE rounding path — round previous
  and current to display precision first, derive the delta from the ROUNDED
  values, and the render test must assert rendered Change == rendered
  Current − rendered Previous over a fixture set that includes the
  checker's 99.995/150.005 case (promote the checker's probe, V3 pattern).
  Observation carried to backlog: `data-change` sorts by the raw percent, so
  "new"/dollar rows sort inconsistently with their displayed value.
- **U-2026-09-03g** (catch — mechanism: PRIMARY CHECKER checker-a11y, U6
  attempt 1, FAIL CONCEDED): a random 20-site sample of surviving `text-xs`
  found two sentence-class survivors (projection-chart helper copy;
  tax-optimizer's Age/Conversion table body) — an in-scope miss beside
  sites the worker had converted. The lead found the same class in seven
  more `<table class="text-xs">` bodies (major-expenses ×5,
  rate-assumptions, historical-backtest) and converted all nine plus the
  `<details>` wrapper to `text-body-sm` lead-direct under the lean
  exception (attempt 2, worker=lead; class strings only, CSS rebuilt,
  affected handler/template suites green). Seven of eight criteria had
  passed with evidence at attempt 1; the checker re-verifies at attempt 2.


---

# Run GM — guardrail markers on the What-If projection chart (2026-09-06)

Constitution for a one-task run in budget2. Approved by the user in chat
2026-09-06 ("yes, go ahead") after a bounded design was presented.

## GM.1 Territory

- Repo `/home/darrell/bin/ai/budget2`; run worktree
  `/home/darrell/bin/ai/budget2/.claude/worktrees/guardrail-markers` on
  branch `feat/guardrail-chart-markers` (off master 4543368). Workers commit
  nothing; the lead commits.
- Files in scope: `internal/handlers/whatif/handlers.go`
  (`buildProjectionChartData`, new helper),
  `internal/handlers/whatif/handlers_test.go`, and — from attempt 2
  (ruling GM-2026-09-06b) — `internal/templates/render.go` for a one-line
  exported `FormatMoney` wrapper only. No JS, no HTML templates, no CSS.

## GM.2 Task GM1 — guardrail cut/raise markers (Tier 2, checks: tests,second)

Context. `buildProjectionChartData` (handlers.go ~592) emits a Plotly
figure: trace "Portfolio Balance" plus, when present, a "Key events"
markers+text trace whose x is a projection-year offset and whose y is
`projectionValueAtYear(projection, year, displayDollars)` nudged up 2%.
The engine records every guardrail trigger in
`projection.GuardrailEvents` (`models.GuardrailEvent`: `Year` int = m/12
projection-year index, same units as chart x; `Type` "cut"|"raise";
`Multiplier`, `PreviousMultiplier`; `MonthlySpendingBefore/After` nominal;
`CumulativeInflation`). The no-guardrails comparison endpoint calls the
same builder with `Guardrails=nil`, so its projection has no events.

Change. Add one trace to the figure when `len(projection.GuardrailEvents)
> 0`, appended AFTER the "Key events" trace:

- `type: scatter`, `mode: markers`, `name: "Guardrail cuts / raises"`,
  `hoverinfo: "text"`, `cliponaxis: false`.
- `x[i] = float64(event.Year)`; `y[i] = projectionValueAtYear(projection,
  x[i], displayDollars)` — ON the curve (no nudge). If that value is `<= 0`,
  use `maxBalance * 0.05` exactly as Key events does.
- Per-point marker arrays: `marker.symbol[i]` = `"triangle-down"` for a cut,
  `"triangle-up"` for a raise; `marker.color[i]` = `"#ef4444"` for a cut,
  `"#22c55e"` for a raise; `marker.size` 11 (scalar); `marker.line`
  `{color: "#ffffff", width: 1}` so red/green triangles stay visible on the
  green fill in both themes.
- `text[i]` (hover text) is built by ONE helper
  `guardrailEventHoverText(e models.GuardrailEvent) string` and reads
  exactly:
  `Year 29: cut 10% (99% of plan)<br>$26,722.44/mo → $24,050.19/mo`
  where the first percentage is the single-year change
  `|Multiplier-PreviousMultiplier|/PreviousMultiplier*100` rounded with
  `%.0f`, "(NN% of plan)" is `Multiplier*100` with `%.0f`, and the money
  line is present only when both spending figures are `> 0`, formatted
  through the SAME money path the templates use (`formatMoney` from
  `internal/templates` or the whatif package's equivalent — find the one
  formatter the What-If templates already route money through and call it;
  do NOT add a second `$%,.0f`-style formatter). When `PreviousMultiplier
  <= 0` the single-year change percentage is omitted (`Year N: cut (NN% of
  plan)`), matching the Guardrail Events list's fallback (ruling GM-2026-09-06d).
  Money in the hover is nominal (that year's dollars), same as the list;
  do NOT convert to today's dollars even in real display mode — the y
  position follows the display mode, the hover text does not (the list
  users compare against is nominal).
- The y-axis headroom rule (`range = [0, maxBalance*1.18]` when events
  exist) must also apply when ONLY guardrail events exist and there are no
  key events — fold the condition to `len(events) > 0 ||
  len(projection.GuardrailEvents) > 0`.

Acceptance criteria (every one must be proven by a named command):
1. `go build ./... && go vet ./...` clean; `go test ./internal/handlers/whatif/...`
   green (bare, no pipe).
2. Unit tests in `handlers_test.go`, each asserting on the JSON-ready map:
   a. projection with zero guardrail events → no trace named
      "Guardrail cuts / raises"; existing traces unchanged.
   b. one cut (Year 29, Prev 1.10, Mult 0.99, Before 26722.44, After
      24050.19) and one raise (Year 15, Prev 1.0, Mult 1.1, Before
      15008.83, After 16509.71) → trace present, x = [29, 15] in event
      order, symbols ["triangle-down","triangle-up"], colors
      ["#ef4444","#22c55e"], hover text EXACTLY
      `Year 29: cut 10% (99% of plan)<br>$26,722.44/mo → $24,050.19/mo` and
      `Year 15: raise 10% (110% of plan)<br>$15,008.83/mo → $16,509.71/mo`
      (cents preserved — `formatMoney` in internal/templates/render.go is
      the formatter the Guardrail Events list uses; ruling GM-2026-09-06a).
   c. real display mode → marker y equals the real-dollar balance at that
      year (`PortfolioBalanceReal`), nominal mode → nominal balance.
   d. event with `PreviousMultiplier` 0 → hover `Year 3: cut (90% of plan)`
      (no money line when Before/After are 0).
   e. guardrail events present, key events absent → yaxis range headroom
      applied.
3. `TestHandleWhatIfProjectionChart` (or a new sibling) proves the trace
   reaches the HTTP JSON when the fixture settings enable guardrails and
   the run produces at least one event.
4. `handleWhatIfProjectionChartNoGuardrails` output contains NO
   "Guardrail cuts / raises" trace (test it).
5. Rendered check (checker, not worker): with
   `scripts/whatif-verify.sh start 8099` on a copy of live data, GET
   `/whatif/chart/projection?display_dollars=nominal` returns the trace
   with 5 points for the current plan (raise y15; cuts y29, y33, y35,
   y37) and the hover text for y29 matches the Guardrail Events list's
   figures for that year after `formatMoney` rounding.

Defect-history surfaces touched: money formatting shown to users (dual
formatter class) → `second` named. Blast radius: one builder shared by two
endpoints → Tier 2.

## GM.3 Rulings

- **GM-2026-09-06a** (catch — mechanism: WORKER stop, GM1 attempt 1; a
  brief-level error): the spec's literal hover strings showed whole dollars
  (`$26,722/mo`) while naming `formatMoney` as the required formatter;
  `formatMoney` (internal/templates/render.go, the function the Guardrail
  Events list routes through) preserves cents (`$26,722.44`). The worker
  probed, stopped, and asked instead of picking one. Ruling: the hover uses
  `formatMoney` and shows cents, because the figure the user compares the
  hover against is the Guardrail Events list, which shows cents; two
  renderings of one figure on two surfaces is the dual-formatter class this
  run's `second` lane exists to catch. Literal strings in GM.2 corrected.
  Attempt count unchanged (no code was written).
- **GM-2026-09-06b** (catch — mechanism: WORKER self-report on GM1 attempt
  1, upheld by the lead before any checker ran; a brief-level error): the
  brief said "call the one formatter, do NOT add a second" but restricted
  files to the whatif handler package, and `formatMoney` is unexported in
  `internal/templates`. The worker resolved the contradiction by copying
  the algorithm into `guardrailHoverMoney` and flagged it. A byte-identical
  copy is still a second formatter (W2 class; it drifts the first time
  `formatMoney` changes). Ruling: scope expands to
  `internal/templates/render.go` for exactly one exported wrapper
  `func FormatMoney(v float64) string { return formatMoney(v) }`; the hover
  helper calls `templates.FormatMoney`; `guardrailHoverMoney` is deleted.
  Re-dispatched as attempt 2.
- **GM-2026-09-06c** (mechanism: GATE escalate-scan, critical-glob): the
  lead's own `.swarm/critical.globs` named `internal/handlers/whatif/handlers.go`,
  so the scan flagged GM1 to Tier 3 after both lanes had passed at Tier 2.
  Honoured rather than edited away: ledger bumped to Tier 3, oracle
  `.swarm/tier3/GM1/accept.sh` written post-hoc and validated at both ends
  (master fails on exactly "trace missing" in both display modes; the branch
  passes; `oracle.2.log`). Lesson for the next constitution: a chart builder
  is reversible and not a money/auth/deploy path — the glob should have named
  the settings-write and deploy paths, not the handler file wholesale.
- **GM-2026-09-06d** (observation — mechanism: PRIMARY CHECKER checker-tests,
  GM1 attempt 2, not a FAIL): the GM.2 prose says `PreviousMultiplier <= 0`
  yields "`Year N: cut` with no percentage" while criterion 2d demands
  `Year 3: cut (90% of plan)`. The implementation follows 2d, and so does the
  list template (`(NN% of plan)` sits outside the `gt .PreviousMultiplier 0`
  guard). Prose corrected here: only the single-year change percentage is
  suppressed; the "of plan" clause is always present.
- **GM-2026-09-06e** (observations for the backlog — mechanism: PRIMARY
  CHECKER): (1) the `y <= 0 → maxBalance*0.05` fallback has no test; (2) the
  Guardrail Events list shows the trigger-month `Portfolio` figure while the
  marker sits at the year's chart balance (`projectionValueAtYear`), so the two
  surfaces differ by a few thousand dollars for the same event — by design per
  GM.2, but a candidate for a shared figure if a user ever compares them.
- **GM-2026-09-06f** (harness — mechanism: GATE schema check): both checkers
  wrote a blank line where the verdict schema requires a literal `---`
  separator; each checker corrected its own file on request. The checker agent
  briefs should state the separator explicitly.

# Run LT — Dashboard and Insights layout tightening (2026-09-07)

Constitution for a four-task run in budget2. The user chose "option 1"
(layout-only tightening) in chat on 2026-09-07 after three options were
presented; this section is that option written as contracts. Tiers were
assigned by the lead under that approval and are open to user override;
mid-run they move only up.

## LT.0 Motivation (measured 2026-09-07 at 1280 px, live data, dark theme)

| Page | Height | Largest block |
|---|---|---|
| Dashboard | 4,176 px | charts grid 2,088 px (Major Expense card's 35-row "Other categories" list stretches the left column; right column empty for ~1,500 px) |
| Insights | 10,862 px | recurring spending 4,815 px (34 rows × 5 evidence lines); supporting section 4,449 px (five full-width cards always open) |

Rules that hold for every task (from the approved 2026-09-06 design):
- Every sentence, figure, link, and id that exists today still exists
  after the change unless a task below names it. Caveats move; they are
  not deleted. Figures are never re-formatted: the `formatMoney` path in
  Go and the existing `Intl.NumberFormat` in charts.js are the only
  formatters, and neither gains a sibling.
- Information order (period → figures → details → charts on Dashboard;
  period → what changed → review → recurring → supporting on Insights)
  is unchanged.
- Progressive enhancement: any content hidden by JS must be visible with
  JS off (ACCESSIBILITY.md point 16). `<details>` is the preferred
  disclosure; a `<summary>` is the only control that may toggle it.
- Both themes, 1280 and 390 px, no horizontal overflow, axe clean
  (WCAG 2.2 AA tags), one `<h1>` per page.

## LT.1 Territory

- Repo `/home/darrell/bin/ai/budget2`; run worktree
  `/home/darrell/bin/ai/budget2/.claude/worktrees/layout-tightening` on
  branch `feat/layout-tightening` (off master c0b8476). The worktree has a
  `data` symlink to the main checkout's live data (the verify script
  dereferences it into a throwaway copy) and `tmp/tailwindcss-3.4.17`.
- Workers commit nothing; the lead commits. The main checkout and the
  other worktrees (`.worktrees/dashboard-insights`, `/tmp/budget2-lifestyle-build`)
  are off limits.
- File ownership (a file is edited by exactly one task per wave):
  - LT1: `web/templates/components/shared/period-context.html`,
    `web/templates/pages/dashboard.html` (title row, drop zone, date-filter
    card only).
  - LT2: `web/templates/pages/dashboard.html` (charts grid only; runs
    after LT1), `web/static/js/charts.js` (`renderMajorExpenseBreakdown`,
    `renderMajorExpenseCredits` only).
  - LT5: `web/templates/pages/insights.html` (`insights-content`'s
    `#insights-findings` and `#insights-recurring` sections) and
    `web/templates/components/insights-investigation.html` (where the
    `insights-finding` / `insights-recurring-group` defines actually live —
    corrected 2026-09-07 after dispatch; the brief named only the page).
  - LT6: `web/templates/pages/insights.html` (`#insights-supporting` only;
    runs after LT5), `web/static/js/insights.js`, `web/static/css/styles.css`.
  - Every task: its own new test file(s) and the rebuilt
    `web/static/css/tailwind.css` (`make css`; `make css-verify` must pass).
- Waves: W1 = LT1 ∥ LT5. W2 = LT2 ∥ LT6.

## LT.2 Worker constraints (paste into every dispatch)

- Work ONLY in the run worktree above. Never `git checkout`, `stash`,
  `commit`, or touch the index. Never edit a file another task owns.
- **Never run the built budget2 binary directly** — any invocation starts a
  server and kills the live :8080 instance. Use `go build ./...`,
  `go vet ./...`, `go test` (bare, or with `set -o pipefail`; never
  `go test … | grep`). For a rendered check run, from the worktree,
  `scripts/whatif-verify.sh start <your port>` (copies data, builds, serves;
  `scripts/whatif-verify.sh stop <port>` tears down). Ports: LT1 8091,
  LT2 8092, LT5 8095, LT6 8096; checkers use 8101–8106. Never :8080/:8081.
- Headless browser for probes: Playwright at
  `/home/darrell/.npm/_npx/e41f203b7505f1fb/node_modules/playwright` with
  `executablePath` `/home/darrell/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`
  and `args:['--no-sandbox']`. axe-core: `npx --yes @axe-core/cli` or the
  `axe.min.js` under `/tmp/claude-1000/-home-darrell-work-agents2/fdc3d3ad-6feb-42fa-95ef-64e528e5cac8/scratchpad/a11y-u12/node_modules/axe-core/` (if absent, `npx --yes axe-core` and addScriptTag).
- Templates changed → `make css` and include the rebuilt
  `web/static/css/tailwind.css` in the manifest; `make css-verify` passes.
- ACCESSIBILITY.md (budget2 root) applies to every element you touch.
- Manifest: `/home/darrell/work/agents2/.claude/worktrees/retired-couple-ui-layout-397a9a/.swarm/manifests/<task>.<attempt>.files`
  (budget2-repo-relative paths, one per line, complete).
- Return STATUS / FILES / VERIFICATION (commands and their output) / NOTES.
  If the spec is ambiguous or an existing test contradicts it, STOP and
  return BLOCKED with the question; do not guess.

## LT.3 Tasks

| ID | Task | Files | Tier | Checks | Why this tier |
|----|------|-------|------|--------|---------------|
| LT1 | Period context to one line + disclosure; Dashboard toolbar merge | `shared/period-context.html`, `pages/dashboard.html` | 2 | tests,a11y | Shared partial (both pages + four HTMX partials) → shared blast radius; oracle is render tests + axe; reversible. |
| LT2 | Dashboard charts grid: Major Expense card full width, breakdown in columns | `pages/dashboard.html`, `static/js/charts.js` | 2 | a11y,second | Money and percent strings re-rendered by JS (dual-formatter surface) → `second`; visual oracle. |
| LT5 | Insights findings footnote; recurring rows compact with evidence disclosure; "Other recurring spending" collapsed | `pages/insights.html` | 2 | tests,a11y,second | Money table restructured (rendered-string surface) → `second`; disclosure semantics → a11y; DI1/DI4/DI5 fixtures → tests. |
| LT6 | Insights supporting section behind tabs | `pages/insights.html`, `static/js/insights.js`, `styles.css` | 2 | tests,a11y | New interactive pattern (tabs, persistence, Plotly resize) → JS behavior is the tests lane's; ARIA pattern → a11y. |

### LT1 — Period context and Dashboard toolbar (Tier 2, checks: tests,a11y)

**A. `shared/period-context`** (consumed by `dashboard-period-kpis`,
`insights-content`, `insights-recurring-partial`, `insights-income-partial`,
`insights-trends-partial`, `category-trends`, `spending-velocity` — all via
`{{template}}`, so one edit covers them). Keep the outer `<section>` and
its classes. New structure, every sentence byte-identical to today's:

1. First child, always visible, ONE `<p class="text-sm …">`:
   `Selected period: {SelectedStart} to {SelectedEnd} ({SelectedDays} calendar days)`
   then ` · Latest transaction: {LatestTransaction}` when `.HasData`, else
   ` · No transaction data available.` (today's sentence, same words).
2. When `.Stale`: a second visible `<p>` with today's exact sentence
   `Data is more than seven calendar days old ({DataAgeDays} days). Current-month forecast is unavailable.`
   The `<details open>`/`<summary>Data freshness</summary>` wrapper is
   removed (the notice is approved policy and must not be collapsible).
3. Then ONE `<details>` (closed) with `<summary class="text-sm text-accent cursor-pointer">Period details</summary>`
   containing, as today's `<p>` elements verbatim: the `Prior period: …`
   line (with its `— same period last year` / `— clamped to the prior
   month's last day` suffixes), the `{{.HistoryReason}}` line when
   `not .HistoryAvailable`, and the `First and last transaction dates are
   evidence bounds, …` sentence.

**B. Dashboard toolbar** (`pages/dashboard.html`, above `#kpis-container`).
Keep the `<h1>Dashboard</h1>` row as-is but WITHOUT the Import button in
it. Replace the separate drop-zone block and date-filter card with ONE
card (`bg-white dark:bg-gray-800 rounded-lg shadow p-4 space-y-3`):
- Row 1: the existing `#date-filter-form` (range picker, Compare select,
  `#loading-indicator`) with `#import-csv-btn` moved into the same flex row,
  pushed right with `ml-auto`. The button element, its id, classes, text
  and SVG are unchanged. Keep the button OUTSIDE the `<form>` element
  (dashboard.js wires it to `#file-input`; a button inside the form must
  not submit it) — the card wraps a `flex flex-wrap items-end gap-4`
  div that contains the form and the button as siblings.
- Row 2: `#drop-zone` unchanged in ids, role, tabindex, child ids and
  text, restyled as a one-line strip (`px-3 py-1.5`, `text-body-sm`).
- `#unassigned_banner` stays where it is (between the h1 and the card).
- `dashboard.js` is not edited. Every id it selects still exists once:
  `import-csv-btn`, `file-input`, `drop-zone`, `drop-zone-content`,
  `drop-zone-uploading`, `drop-zone-success`, `drop-zone-error`,
  `drop-zone-error-msg`, `date-filter-form`, `dashboard-date-start`,
  `dashboard-date-end`, `dashboard-comparison`, `loading-indicator`,
  `kpis-container`. `#kpis-container`'s hx-* attributes are unchanged.

Acceptance (each proven by a named command):
1. `go build ./... && go vet ./...` clean; `go test ./internal/templates/... ./internal/handlers/dashboard/... ./internal/handlers/insights/...` green, bare.
2. New `internal/templates/render_period_context_lt1_test.go` renders
   `shared/period-context` with (i) a stale fixture (HasData, Stale,
   DataAgeDays 11, HistoryAvailable false, HistoryReason "Not enough
   history to compare") and (ii) a fresh fixture with history, asserting on
   the rendered string: exactly one `<details` and no `<details open`;
   summary text `Period details`; `Selected period:` and `Latest
   transaction:` both occur before the first `<details`; in (i) the stale
   sentence occurs before `<details` and in (ii) not at all; `Prior
   period:`, `evidence bounds`, and (in (i)) `Not enough history to
   compare` occur after `<details`; `Data freshness` occurs nowhere.
3. Text-node parity: for the same fixture, the multiset of trimmed text
   nodes rendered by the partial before and after the change is identical
   except for the added `Period details` and removed `Data freshness`
   (checker: render on master and branch with one fixture and diff).
4. Rendered on the verify server, 1280 px, both themes: `#period-context`
   height ≤ 100 px on the live data (stale state; today 172); the
   Dashboard content above `#kpis-container`, measured from the top of the
   page's `space-y-6` wrapper, ≤ 230 px (today 244) — ceilings relaxed by
   ruling LT-2026-09-07a; the classes in A/B are authoritative;
   `#drop-zone` still opens the file chooser on Enter and `#import-csv-btn`
   on click (Playwright `filechooser` event); whole-page drop still targets
   `#file-input` (dashboard.js unchanged suffices — cite `git diff --stat`).
5. axe clean on `/dashboard` and `/insights`, both themes, 1280 and 390;
   `<summary>` reachable by Tab, toggles on Enter and Space, focus ring
   visible in both themes; no horizontal overflow at 390.
6. `make css` run; `make css-verify` passes.

### LT2 — Dashboard charts grid (Tier 2, checks: a11y,second)

`pages/dashboard.html`, charts grid only. Today: a 2-column grid with
Major Expense (col 1), Spending Trend (col 2), Top Spending (col 1),
Cumulative Balance (span 2). New:

- Row 1: Major Expense card with `Class "lg:col-span-2"`. Its body is a
  `grid grid-cols-1 lg:grid-cols-2 gap-6 items-start`: left cell a plain
  `<div>` holding `#chart-major-expense` (unchanged id/attrs/placeholder;
  the wrapper exists because dashboard.js inserts the "View chart data"
  `<details>` with `plot.after()`, which must land inside the cell, not
  as a third grid item — ruling LT-2026-09-07c), right cell
  `#chart-major-expense-breakdown` followed by `#chart-major-expense-credits`
  (ids, `mt-3` on credits only, text classes unchanged).
- Row 2: Spending Trend and Top Spending side by side (unchanged cards).
- Row 3: Cumulative Balance `lg:col-span-2` (unchanged).
- `charts.js`: `renderMajorExpenseBreakdown` and `renderMajorExpenseCredits`
  each append the header div as today, then ONE list container
  `<div class="grid grid-cols-1 md:grid-cols-2 gap-x-6">` into which the
  row buttons are appended. Row markup (button element, classes, name
  span, amount + percent formatting via the existing `Intl.NumberFormat`,
  click → `triggerMajorExpenseDrilldown`) is byte-for-byte what it is
  today. No other JS changes. The `View chart data` `<details>` that
  dashboard.js appends after each chart is untouched.

Acceptance:
1. `go build ./... && go vet ./...`; `go test ./internal/handlers/dashboard/... ./internal/templates/...` green; `node --test web/static/js/` green (existing `*.test.cjs`).
2. Parity (checker-second): run master and branch verify servers on the
   same data copy and range; `GET /dashboard/charts/data/major-expense`
   bodies byte-identical; the ordered list of row texts in
   `#chart-major-expense-breakdown` and `#chart-major-expense-credits`
   (button `textContent`, whitespace-normalised) identical; count of
   `<button>` rows identical.
3. Layout (1280, both themes): the Major Expense card's width equals the
   grid's width; Spending Trend and Top Spending cards have equal
   `getBoundingClientRect().top`; the grid's height ≤ 70 % of master's on
   the same data (was 60 %; relaxed by ruling LT-2026-09-07c); no element in `main` extends past `innerWidth`; at 390
   single column, no horizontal overflow.
4. Clicking the first breakdown row opens the same drilldown as on master
   (a `[role="dialog"]` or the `#major-expense-drilldown-container`
   content appears; compare its heading text to master); Tab reaches the
   rows; focus ring visible on the `dark:bg-gray-800` card in both themes.
5. axe clean `/dashboard`, both themes, 1280 and 390.
6. `make css`; `make css-verify` passes.

### LT5 — Insights lists compaction (Tier 2, checks: tests,a11y,second)

`pages/insights.html`. Three changes; every money string, link href and
link text unchanged.

**A. Price-creep caveat once.** In `insights-finding`, the `{{with .Creep}}`
clause keeps `: {FirstAmount} → {CurrentAmount} ({PctChange}% increase),
{FirstDate} to {LastDate}.` and DROPS the trailing sentence `The linked
transaction is the latest in this full-history group; its actual amount
may differ from the median.` That sentence is rendered ONCE, inside
`#insights-findings` after the preview list and the `#all-findings`
details, as `<p class="text-sm text-gray-600 dark:text-gray-400">Price-creep
findings: the linked transaction is the latest in its full-history group;
its actual amount may differ from the median.</p>`, only when at least one
entry of `.Findings` has a non-nil `Creep` (compute in the template with a
`{{$hasCreep := false}}{{range .Findings}}{{if .Creep}}{{$hasCreep = true}}{{end}}{{end}}`
guard, or expose a `HasCreep` bool from the handler if the view struct is
the cleaner place — say which in NOTES). If an existing test asserts the
sentence per row, change it to assert the sentence exactly once per page
and name the test in NOTES.

**B. Recurring rows compact.** In `insights-recurring-group`, the first
`<td>` becomes: line 1 — the existing `<a>` (href and text unchanged),
then, when `.MajorExpenseName`, ` · ` and the name in a
`text-gray-600 dark:text-gray-400` span (the words `Major Expense:` are
kept inside the span so the text node is unchanged: `Major Expense: {name}`);
line 2 — a `<details class="mt-1">` with `<summary class="text-sm
text-accent cursor-pointer">Evidence</summary>` wrapping today's three
`<p>` lines verbatim (`{{.ClassificationReason}}`; `{n} occurrences ·
{freq} · Last observed {date}`; `Expected payment estimate as of {date}:
{date} · Detection confidence {n}%`). The three money `<td>`s and the
`<thead>` are unchanged.

**C. "Other recurring spending" collapsed.** For the group whose label is
`Other recurring spending` (key on its ID if the handler defines one —
check `internal/handlers/insights` and say which in NOTES), keep the
`<h3>` and the `{n} retained series · Estimated monthly … · Estimated
annual …` line visible, and wrap the `overflow-x-auto` table region in a
closed `<details>` whose `<summary class="text-sm text-accent
cursor-pointer">` reads `Show all {{len .Group.Rows}} series`. The
subscriptions and bills groups render open exactly as today (no details).
The empty-group sentence is unchanged and never inside a details.

Acceptance:
1. `go build ./... && go vet ./...`; `go test ./internal/templates/... ./internal/handlers/insights/...` green bare — DI1/DI4/DI5 fixtures (`recurring_render_di5_test.go`, `estimate_sums_di5_test.go`, `http_links_di5_test.go`, `render_recurring_di1_test.go`) pass unmodified except the per-row-sentence case in A.
2. New `internal/templates/render_insights_lt5_test.go`: (a) render
   `insights-recurring-group` for a two-row fixture with cents
   (e.g. 1655.30 / 27.35): each row's first cell contains exactly one
   `<details` and a `<summary` whose text is `Evidence`; the three evidence
   lines occur after that row's `<details`; the money cells render exactly
   `>$1,655.30</td>`-style strings equal to `formatMoney` of the fixture
   (hardcode the expected strings); (b) the other-recurring group renders a
   `<details` without `open` that contains `<table`, and its
   `Show all 2 series` summary; the subscriptions group renders `<table`
   with no `<details` before it in that section; (c) `insights-content`
   with an Investigation whose `.Findings` has one creep and one outlier
   finding renders `actual amount may differ from the median` exactly once,
   after `id="findings-preview"`'s closing `</ul>`; with zero creep findings,
   zero times.
3. Parity (checker-second): master vs branch on the same data — ordered
   list of `td.num` texts per group, the group total lines, and every
   `a[href]` inside `#insights-recurring` and `#insights-findings` identical.
4. Rendered (1280, both themes): `#insights-recurring` height ≤ 40 % of
   master's on the same data; every `<summary>` keyboard-operable with a
   visible focus ring; at 390 the tables still scroll inside their
   `overflow-x-auto` region (no page overflow).
5. axe clean `/insights`, both themes, 1280 and 390.
6. `make css`; `make css-verify` passes.

### LT6 — Supporting section tabs (Tier 2, checks: tests,a11y)

`#insights-supporting` keeps its `<section id>`, `aria-labelledby` and
`<h2>`. Below the h2:

- `<div role="tablist" aria-label="Supporting charts and tables" class="flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-700">`
  with five `<button type="button" role="tab" id="insights-tab-{key}"
  aria-controls="insights-panel-{key}" aria-selected="false"
  data-ins-tab="{key}" class="px-3 py-2 text-sm font-medium border-b-2
  border-transparent text-gray-600 dark:text-gray-400 hover:text-gray-700
  dark:hover:text-gray-100">` (gray-600/400, the What-If tab convention;
  ruling LT-2026-09-07d) for keys/labels `trends` "Spending trends",
  `income` "Income sources", `anomalies` "Anomalies", `pricecreep` "Price
  creep", `pace` "Spending pace".
- Each of the five existing cards becomes (or is wrapped by) a
  `<div role="tabpanel" id="insights-panel-{key}" aria-labelledby="insights-tab-{key}" data-ins-panel="{key}" tabindex="0">`.
  The cards' inner markup — headings, paragraphs, `#chart-trends` with its
  hx-* attributes, tables, `anomalies-section`, `pricecreep-section`,
  `shared/period-forecast` — is unchanged. Server markup carries NO
  `hidden` attribute and no `aria-selected="true"`: with JS off all five
  panels show (point 16).
- `insights.js`: on `DOMContentLoaded` and after every `htmx:afterSwap`
  whose target contains `#insights-supporting`, initialise: read
  `localStorage['insightsActiveTab']` (default `trends`; unknown → `trends`),
  activate it. Activate = set `hidden` on every other panel, remove it on
  the chosen one, set `aria-selected` true/false, roving `tabindex`
  (`0` on the active tab, `-1` on the rest), toggle the `wf-tab-active`
  class (reused from styles.css so both themes are already covered), persist
  the key, and call `Plotly.Plots.resize` on `#chart-trends` when it exists
  and has `.data` (same try/catch as whatif-tabs.js `resizeChartsIn`).
  Click, Enter and Space on a tab activate it; ArrowLeft/ArrowRight move
  focus to the previous/next tab (wrapping) and activate it; Home/End go
  to first/last. Wrap all `localStorage` access in try/catch.
- `styles.css`: add `[data-ins-tab]:focus-visible` to the existing
  What-If focus-outline rule (same outline), nothing else.

Acceptance:
1. `go build ./... && go vet ./...`; `go test ./internal/templates/... ./internal/handlers/insights/...` green (`investigation_di4_test.go` pins `id="insights-supporting"`).
2. New `internal/templates/render_insights_lt6_test.go`: rendered
   `insights-content` has exactly five `role="tab"` and five
   `role="tabpanel"`; every tab's `aria-controls` equals a panel id and
   every panel's `aria-labelledby` equals a tab id; no `hidden` attribute
   and no `aria-selected="true"` in the server output; `#chart-trends`
   still carries its `hx-get`/`hx-trigger="load"`.
3. Behaviour (checker-tests, Playwright on the verify server): default →
   only `insights-panel-trends` visible; click "Anomalies" → only that
   panel visible, `aria-selected` correct, localStorage key set; reload →
   anomalies still active; click "Spending trends" → `#chart-trends` has
   `.data` and `offsetWidth > 0` (chart drawn after resize); ArrowRight
   from a focused tab moves focus AND activates the next; Home/End work;
   change the date range via a preset button (HTMX outerHTML swap of
   `#insights-wrapper`) → the active tab survives; with
   `javaScriptEnabled:false` all five panels visible.
4. `#insights-supporting` height at 1280 ≤ the tallest single panel's
   height + 120 px (only one panel shown).
5. axe clean `/insights`, both themes, 1280 and 390; focus ring visible on
   tabs in both themes.
6. `make css`; `make css-verify` passes.

## LT.4 Rulings

(recorded as they happen; each catch names its mechanism)

- **LT-2026-09-07a** (catch — mechanism: WORKER stop, LT1 attempt 1; a
  brief-level error): LT1 acceptance 4 set `#period-context` ≤ 90 px and
  the dashboard toolbar region ≤ 200 px, but the classes the same section
  pins verbatim (`p-4` section, three mandatory `text-sm` rows; `p-4
  space-y-3` card, unchanged 64 px form row, `py-1.5` drop strip, the
  page's `space-y-6` rhythm) produce 92 px and 222 px. The ceilings were
  the lead's estimate, not a design goal; the classes are what the user
  sees. Ruling: classes authoritative, ceilings relaxed to 100 px / 230 px
  (measured from the `space-y-6` wrapper). No code changed; attempt count
  unchanged.
- **LT-2026-09-07b** (observation — mechanism: PRIMARY CHECKER
  checker-tests, LT1 attempt 1, not a FAIL): acceptance 3's literal
  "multiset of trimmed text nodes identical" cannot hold because section
  A.1 itself mandates merging the `Selected period` and `Latest
  transaction` sentences into one node with ` · `. The checker proved
  parity at sentence level (split on ` · `) on four fixtures: the only
  differences are +`Period details` −`Data freshness`. Ruling: sentence-
  level parity is the property; the acceptance wording is read that way.
  No code changed.
- **LT-2026-09-07c** (catch — mechanism: WORKER, LT2 attempt 1; two
  items). (1) A structural defect in the brief: placing `#chart-major-expense`
  directly as a grid item made dashboard.js's `plot.after(details)` insert
  the chart's data-table disclosure as a THIRD grid item, breaking the
  two-column layout (measured 1,708 px). The worker wrapped the chart in a
  plain div cell and flagged it; accepted, spec text corrected above.
  (2) The 60 % height ceiling was the lead's estimate; with the pinned
  two-column list and the unchanged second/third rows the floor is
  1,384 px (66 %). Same class as ruling a: ceiling relaxed to 70 %; a
  third list column was considered and rejected (at 1280 the cell is
  ~600 px, three columns would truncate long category names). No code
  changed for (2); attempt count unchanged.
- **LT-2026-09-07d** (catch — mechanism: WORKER stop, LT6 attempt 1; a
  brief-level error): the brief pinned inactive tabs as `text-gray-500
  dark:text-gray-300`; `text-gray-500` on the page's `bg-gray-100` body is
  4.39:1, failing ACCESSIBILITY.md point 7. The worker measured it with axe,
  found the existing What-If tabs use `text-gray-600 dark:text-gray-400`
  (6.87:1), and stopped instead of substituting. Ruling: use the What-If
  pair; spec text corrected. Attempt count unchanged.
- **LT-2026-09-07e** (observations for the backlog — mechanism: the a11y
  and second lanes on LT1/LT2/LT5, all attributed to master by parallel
  master renders, none a FAIL): (1) dark theme `color-contrast` on the
  range-picker preset buttons (~3.45:1) and, at 390 px, on parts of the
  Dashboard KPI region (`#dashboard-budget-details`, `button[data-kpi-detail]`);
  (2) `scrollable-region-focusable` on the "View chart data" tables that
  dashboard.js appends, at 390 px; (3) a synthetic Playwright click on a
  donut wedge does not fire `plotly_click` on master either (real pointer
  clicks do); (4) from the final site-wide pass (LTfinal, PASS, violation
  set identical to master across 62 axe runs per side): `target-size` on
  `/major-expenses`, 390 px page overflow on `/major-expenses` and
  `/whatif`, no `<footer>` landmark on `/explorer`, `scrollable-region-
  focusable` on `/transfers`. Candidates for a follow-up run; not in LT's
  scope.
- **Run closed 2026-09-07**: `gate.sh done` exit 0; `gate.sh stats`
  first-attempt clean 4/4 (no-evidence rows 0); `make check` green;
  agents2 `smoketest/gate/run_tests.sh` ALL PASS. Shipped as budget2 PR #97
  (branch `feat/layout-tightening`, commit 5334385), merged as master
  344cb30 and deployed to live :8080 the same day (pid 3108001, health
  commit v1.4.0-1101-g344cb30).
  Lesson for the next constitution: three of the four worker stops were
  brief-level errors by the lead (pixel ceilings derived from pinned
  classes, a pinned class failing contrast) — when classes are pinned
  verbatim, either omit derived pixel targets or state that the classes
  win; and a chart container that page JS decorates with `after()` must
  sit in its own wrapper cell inside any grid.

# Run RF — retiree-first visual refresh (2026-09-07)

Constitution for a four-task run in budget2, "option 2" of the three
options presented 2026-09-07 (option 1 shipped as run LT / PR #97). The
user delegated the design ("do as you see fit"); tiers assigned by the lead.

## RF.0 Goals and rules

Goal: the two household pages (Dashboard, Insights) read like a summary for
a retired couple rather than a technical report. Four levers: a modestly
larger type scale everywhere plus targeted bumps on the two pages;
proportional (non-monospace) figures with tabular numerals; one factual
lead sentence per page built from figures the page already shows; caveats
gathered into one disclosure per section; warm neutral greys.

Rules (carried from the 2026-09-06 design and run LT):
- Every sentence, figure, link and id that exists today survives unless a
  task names it. Caveats move; they are not deleted. The visible
  cash-flow caveat under the Dashboard tiles ("does not measure portfolio
  withdrawals") stays visible.
- One formatter per value: lead sentences render money with `formatMoney`
  from the SAME field the tile or section line renders; a threshold is
  applied by the SAME producer (e.g. `CashFlowDisplay.Balance`, already
  rounded through `ReportingMoney`, is the only allowed source for the
  "covered / did not cover" branch — never a raw float).
- Neutral wording: "spending exceeded recorded income", "did not cover",
  never "bad", "good", "healthy". No sustainability claims.
- Progressive enhancement: JS-hidden content is visible with JS off;
  `<details>` is the disclosure primitive.
- Both themes, 1440/1280/390 px, no NEW horizontal overflow, axe clean
  (WCAG 2.2 AA tags) relative to master, one `<h1>` per page, zero
  `!important` in styles.css (U7 rule).

Deferred (pre-existing on master, out of RF territory): `target-size`
and 390 px overflow on /major-expenses; 390 px overflow on /whatif;
missing `<footer>` on /explorer; scroll region on /transfers.

## RF.1 Territory

- Repo `/home/darrell/bin/ai/budget2`; run worktree
  `/home/darrell/bin/ai/budget2/.claude/worktrees/retiree-refresh` on
  branch `feat/retiree-refresh` (off master 344cb30). It has the `data`
  symlink and `tmp/tailwindcss-3.4.17`. Baseline: build green,
  css-verify up to date.
- Workers commit nothing; the lead commits. Main checkout and other
  worktrees are off limits.
- File ownership (all four tasks run in ONE wave; files are disjoint):
  - RF1: `tailwind.config.js`, `web/static/css/styles.css`,
    `web/static/js/charts.js`; from attempt 1 (ruling RF-2026-09-07a) also
    `web/templates/layouts/base.html` (desktop nav only) and
    `web/templates/components/shared/range-picker.html` (stacked group
    wrap only).
  - RF2: `web/templates/components/kpis.html`, new test
    `internal/templates/render_dashboard_lead_rf2_test.go`; from attempt 1
    (ruling RF-2026-09-07b) also `internal/handlers/dashboard/handlers_http_test.go`
    (one class pattern) and `cmd/server/cross_money_di5_test.go` (anchor
    the "Recorded income" capture on the tile heading, add a lead-vs-tile
    assertion).
  - RF3: `web/templates/pages/insights.html` (everything except the date
    filter form), `web/templates/components/insights-investigation.html`,
    `web/static/js/insights.js`, new test
    `internal/templates/render_insights_rf3_test.go`.
  - RF4: `web/static/js/dashboard.js`.
  - `web/static/css/tailwind.css`: every worker runs `make css` for its own
    verification (rebuilds are idempotent over the whole tree); the LEAD
    performs the final rebuild and `make css-verify` before commit. Do not
    list tailwind.css in manifests unless your task's classes required it.

## RF.2 Worker constraints (paste into every dispatch)

- Work ONLY in the run worktree. Never `git checkout`, `stash`, `commit`,
  or touch the index. Never edit a file another task owns.
- NEVER run the built budget2 binary directly (it kills the live :8080
  server). `go build ./...`, `go vet ./...`, `go test` bare (never piped
  to grep). Rendered checks: from the worktree
  `scripts/whatif-verify.sh start <port>` / `stop <port>`. Ports: RF1 8131,
  RF2 8132, RF3 8133, RF4 8134; checkers 8141–8148. Never :8080/:8081.
- Playwright: `/home/darrell/.npm/_npx/e41f203b7505f1fb/node_modules/playwright`,
  executablePath `/home/darrell/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
  args `['--no-sandbox']`; dark via
  `document.documentElement.classList.toggle('dark', true)` then wait
  ~400 ms for the body colour transition. axe: addScriptTag with
  `/tmp/claude-1000/-home-darrell-work-agents2/fdc3d3ad-6feb-42fa-95ef-64e528e5cac8/scratchpad/a11y-u12/node_modules/axe-core/axe.min.js`
  (else `npx --yes axe-core` into your scratch dir).
- Other workers are editing the same tree concurrently (RF1 changes the
  global palette and root font size); do not be surprised by look changes
  outside your files, and never "fix" them.
- ACCESSIBILITY.md (budget2 root) applies to every element you touch.
- Manifest: `/home/darrell/work/agents2/.claude/worktrees/retired-couple-ui-layout-397a9a/.swarm/manifests/<task>.<attempt>.files`
  (budget2-repo-relative paths, one per line, complete).
- Return STATUS / FILES / VERIFICATION (commands + actual output) / NOTES.
  Ambiguity or a contradicting existing test → STOP, return BLOCKED with
  the question.

## RF.3 Tasks

| ID | Task | Files | Tier | Checks | Why this tier |
|----|------|-------|------|--------|---------------|
| RF1 | Tokens: 17 px root, warm greys (stone), proportional `.num`, chart theme colours, reduced-motion guard | `tailwind.config.js`, `styles.css`, `charts.js` | 2 | a11y,second | Sitewide blast radius; contrast + overflow are the oracle; second lane attacks regressions everywhere. |
| RF2 | Dashboard lead sentence, tile/heading type bumps, caveat fold | `components/kpis.html`, new test | 2 | tests,a11y,second | New money sentence from existing figures (split-classification surface). |
| RF3 | Insights lead sentence, type bumps, caveat folds, trends-table cap | `pages/insights.html`, `components/insights-investigation.html`, `static/js/insights.js`, new test | 2 | tests,a11y,second | Money sentence + JS-hidden rows (rendered-string and progressive-enhancement surfaces). |
| RF4 | Dashboard chart data tables: focusable, labelled scroll region | `static/js/dashboard.js` | 1 | a11y | One function, strong oracle (axe rule id), reversible. |

### RF1 — Tokens (Tier 2, checks: a11y,second)

1. **Root type.** In `styles.css`, before the token block:
   `html { font-size: 106.25%; }` (17 px) with a comment naming this run.
   Everything rem-based scales by 6.25 %; pixel-pinned tables
   (`min-w-[640px]`) do not.
2. **Warm greys.** In `tailwind.config.js` `theme.extend.colors`, add a
   `gray` entry that overrides the default scale with Tailwind's stone
   values, INLINE (the standalone CLI cannot resolve
   `require('tailwindcss/colors')` here — verified 2026-09-07):
   50 `#fafaf9`, 100 `#f5f5f4`, 200 `#e7e5e4`, 300 `#d6d3d1`, 400 `#a8a29e`,
   500 `#78716c`, 600 `#57534e`, 700 `#44403c`, 800 `#292524`, 900 `#1c1917`,
   950 `#0c0a09`. Every `gray-*` utility in the app becomes warm with no
   template edits. In `styles.css`: `--neutral` triplets → stone-600
   `87 83 78` / soft stone-50 `250 250 249` / strong stone-700 `68 64 60`;
   `.dark` → stone-400 `168 162 158` / soft stone-800 `41 37 36` / strong
   stone-700. Scrollbar colours → stone equivalents (track `#f5f5f4` /
   dark `#44403c`; thumb `#d6d3d1` / dark `#78716c`; hover `#a8a29e` both).
   The accent/positive/negative/warning triplets are UNCHANGED (diff-proof).
   `.wf-tab-active` / `.qa-tab-active` literal hexes unchanged (accent /
   white / gray-900 text `rgb(17 24 39)` → `rgb(28 25 23)` to match stone).
3. **charts.js theme colours** (the `getThemeColors`-style block near line
   16): text dark `#e7e5e4` / light `#44403c`; grid dark `#44403c` / light
   `#e7e5e4`; hoverBg dark `#292524`; hoverBorder dark `#57534e` / light
   `#d6d3d1`; hoverText dark `#f5f5f4` / light `#1c1917`; the dashed
   reference line `#9ca3af` → `#a8a29e`. Update the two focus-ring contrast
   comment blocks (indigo-500 vs the new dark card `#292524` and hover
   `#1c1917`) with recomputed ratios; if either drops below 3:1, STOP and
   report (do not change the ring colour unilaterally).
4. **`.num`.** `font-family: inherit;` keep `font-variant-numeric:
   tabular-nums; font-feature-settings: "tnum";`. Comment: proportional
   figures, tabular digits for column alignment.
5. **Reduced motion.** Append to `styles.css`:
   `@media (prefers-reduced-motion: reduce) { <selectors> { transition: none; } }`
   where `<selectors>` is every Tailwind transition utility actually used
   (`grep -oh 'transition-[a-z]*' -r web/templates web/static/js | sort -u`
   → list them all, e.g. `.transition-all, .transition-colors,
   .transition-shadow, .transition-opacity, .transition-transform`) plus
   `.major-expenses-pin-check, .major-expenses-pin-check-header`. No
   `!important` (styles.css loads after tailwind.css; same specificity,
   later source wins). `animate-spin` stays (loading spinner is essential).
6. **Consequences of the root bump** (ruling RF-2026-09-07a). In
   `layouts/base.html`, desktop nav only (`hidden xl:flex …`): the outer
   group container `gap-6` → `gap-4`; every nav link `px-3` → `px-2` and
   add `whitespace-nowrap`; and (attempt 2, ruling RF-2026-09-07c) the
   three group-label spans (`#nav-group-money`, `#nav-group-plan`,
   `#nav-group-setup`) get `hidden 2xl:inline` in place of their default
   display so the labels show only from 1536 px — they keep their ids, so
   each `role="group" aria-labelledby` still resolves (aria-labelledby
   reads hidden elements). Nothing else (mobile menu, ids, aria
   attributes, active classes unchanged). In
   `components/shared/range-picker.html`, the stacked layout's
   `<div class="flex items-end gap-2">` group wrapper → `flex flex-wrap
   items-end gap-2` (one class added; the arrows may wrap under the inputs
   at 390 px). No other template edits.

Acceptance:
1. `make css` then `make css-verify` ("up to date"); `grep -c '!important' web/static/css/styles.css` = 0; `go build ./...`; `node --test "web/static/js/**/*.test.cjs"` green.
2. Rendered (verify server, Playwright): `getComputedStyle(document.documentElement).fontSize` = `17px`; a `.text-sm` element computes `14.875px`; a `.num` element's computed `font-family` equals `body`'s (not monospace) and `font-variant-numeric` is `tabular-nums`.
3. Palette: `getComputedStyle(document.body).backgroundColor` = `rgb(245, 245, 244)` light / `rgb(28, 25, 23)` dark; a card (`.bg-white.dark\:bg-gray-800`) = white / `rgb(41, 37, 36)`.
4. axe on all 9 pages × 1440/390 × light/dark: violation set equal to master's (checker attributes; RF1 introduces none). Contrast probe by the a11y checker: every visible text node on /dashboard, /insights, /whatif (default tab) meets 4.5:1 (3:1 for large text) against its effective background, both themes.
5. Overflow: `scrollWidth ≤ clientWidth` at 390 and 1280 on the seven pages that are clean on master (this includes /explorer); on /major-expenses and /whatif report the numbers (must not exceed master's by more than 6.25 % + 8 px). At 1280 the desktop nav links all share one `top` AND each link's height is one line (`offsetHeight` < 2 × its line-height); the nav's right edge stays inside the container — INCLUDING with the Duplicates badge present (inject the production `{{if .UnresolvedDuplicateCount}}` markup into the nav in the DOM, or use a data copy with unresolved duplicates): `documentElement.scrollWidth == 1280`; at 1536 the group labels are visible again and the nav still fits with the badge.
6. Charts: on /dashboard both themes, Plotly tick/legend text colour equals the RF1 values; hover box (trigger a hover on the Spending Trend bar) uses the stone hover colours.
7. checker-second: money strings on `/dashboard/kpis` and `/insights` byte-identical master vs branch (same data copy, same range); `git diff master -- web/static/css/styles.css` shows the accent/positive/negative/warning triplets untouched; `prefers-reduced-motion: reduce` emulation (Playwright `reducedMotion:'reduce'`) → computed `transition-duration` `0s` on a `.transition-colors` element.

### RF2 — Dashboard lead, type, caveats (Tier 2, checks: tests,a11y,second)

All in `components/kpis.html` (`kpis` define). Let `$v := .BudgetVerdict`,
`$flow := $v.CashFlow`.

A. **Lead.** First child of the `<section aria-label="Selected-period
overview">`, rendered only when `.Metrics.TransactionCount` > 0:
`<p id="dashboard-lead" class="text-xl leading-snug text-gray-900 dark:text-gray-100">` containing two sentences separated by one space:
- Sentence 1: `{{if not $v.HasTarget}}No budget is set for this period.{{else if $v.IsOver}}Spending is <span class="num">{{formatMoney (abs $v.Delta)}}</span> over plan for this period.{{else if $v.IsUnder}}Spending is <span class="num">{{formatMoney (abs $v.Delta)}}</span> under plan for this period.{{else}}Spending is on plan for this period.{{end}}`
- Sentence 2 keyed on the rounded producer `$flow.Balance` exactly as the
  tile does: `{{if lt $flow.Balance 0.0}}Recorded income did not cover spending by <span class="num">{{formatMoney (abs $flow.Balance)}}</span>.{{else if gt $flow.Balance 0.0}}Recorded income exceeded spending by <span class="num">{{formatMoney $flow.Balance}}</span>.{{else}}Recorded income matched spending.{{end}}`
  (`$flow.Balance` is `ReportingMoney`-rounded in
  `internal/services/metrics/reporting.go`; a fixture with income 10.006
  and spending 10.004 must therefore render "matched" — same as the tile's
  `Explanation`.)

B. **Type.** Tile `<h2>` `text-sm` → `text-base`; tile figures `text-2xl`
→ `text-4xl` (and the "Not set" / "No observed spending" `text-lg` →
`text-2xl`); tile helper `<p>` `text-sm` → `text-base`; the cash-flow
caveat paragraph and the "Investigate this period" link `text-sm` →
`text-base`; "Budget details" `<h2>` `text-lg` → `text-xl`; its `<h3>`s
`font-medium` → `text-lg font-medium`; the living/healthcare `<p>`
sentences `text-sm` → `text-base`; buttons/links inside keep `text-base`.
Nothing inside the `dashboard-verdict-bar` include changes (not owned).

C. **Caveat fold.** In `#dashboard-budget-details`: the methodology
sentence ("Monthly equivalents below use the selected range …") and the
`PlanExcluded` paragraph move, verbatim, into
`<details class="mt-2"><summary class="text-base text-accent cursor-pointer">About these numbers</summary>…</details>`
placed after the two-column grid and before the existing "Plan explanation
and comparison" details. The cash-flow caveat under the tiles stays
visible and unchanged in wording.

Acceptance:
1. `go build && go vet`; `go test ./internal/templates/... ./internal/handlers/dashboard/...` green (DI3 fixtures unmodified).
2. New test renders `kpis` with fixtures (build `BudgetVerdictView` /
   `CashFlowDisplay` via `metrics.ReportingCashFlow` where possible; copy
   the fixture shape from `internal/handlers/dashboard/di2_second_year_test.go`
   or `internal/templates` tests): (i) HasTarget, IsOver Delta 1234.565,
   income 44123.21 spending 70166.53 → lead contains exactly
   `Spending is <span class="num">$1,234.57</span> over plan for this period. Recorded income did not cover spending by <span class="num">$26,043.32</span>.`
   and the tile renders `$26,043.32` and `$1,234.57`; (ii) IsUnder + income
   > spending → "under plan" and "exceeded spending by"; (iii) no target +
   income 10.006 spending 10.004 → `No budget is set for this period.
   Recorded income matched spending.` and the tile shows `$0.00` with
   "Recorded income matches spending" — NOTE ruling RF-2026-09-07b: `ReportingCashFlow` rounds income and spending to cents FIRST and subtracts the rounded values, so 10.006/10.004 yields $0.01, not $0.00; the fixture is income 10.001 / spending 9.999 (both round to $10.00, balance exactly $0.00); (iv) TransactionCount 0 → no
   `id="dashboard-lead"`. Each money string in the lead must equal the
   corresponding tile string in the same render (assert both).
3. Rendered: `/dashboard/kpis?start=…&end=…` (HTMX partial) returns the lead; `#dashboard-lead` is the first element inside the overview section; the "About these numbers" `<summary>` toggles by keyboard.
4. axe on /dashboard both themes 1280/390 — no new violations; tile figures at `text-4xl` do not overflow their tiles at 1280 (each `.num` `scrollWidth ≤ clientWidth`) nor at 390.
5. `make css`; `make css-verify`.

### RF3 — Insights lead, type, caveats, trends cap (Tier 2, checks: tests,a11y,second)

A. **Lead.** In `insights-content`, immediately after `<div id="period-context">…</div>`, inside `{{with .Investigation}}`:
`<p id="insights-lead" class="text-xl leading-snug text-gray-900 dark:text-gray-100">`
- Sentence 1: `Net spending this period: <span class="num">{{formatMoney .Current}}</span>{{if $.Period.HistoryAvailable}} ({{template "insights-dollar-change" .Change}} versus the prior period){{end}}.`
- Sentence 2: `{{$n := len .Findings}}{{if eq $n 0}}No transactions to review{{else}}{{$n}} {{if eq $n 1}}transaction{{else}}transactions{{end}} to review{{end}}; detected recurring spending is about <span class="num">{{formatMoney .Monthly}}</span> a month.`
  (`.Monthly` is the same field the "Retained estimates" line renders.)

B. **Type.** Section `<h2>` `text-lg` → `text-xl`; group `<h3>` `text-base` → `text-lg`; sentence `<p>` in What changed / Review / Recurring headers `text-sm` → `text-base`; contributors `<li>` and finding `<li>` text `text-base` (money spans keep `num`); table cells and the LT5 Evidence lines stay `text-sm`. The date filter form is NOT owned.

C. **Caveat folds.** In `#insights-findings`: the "Detection uses loaded active history…" sentence and the LT5 price-creep footnote move verbatim into `<details><summary class="text-base text-accent cursor-pointer">About these findings</summary>…</details>` at the end of the section (the footnote keeps its `$hasCreep` guard inside). In `#insights-recurring`: keep `Retained estimates: … monthly · … annual.` visible (drop the two trailing sentences from that `<p>` and move them, with the "Estimates from history through …" sentence, verbatim into `<details><summary class="text-base text-accent cursor-pointer">About these estimates</summary>…</details>` right after the retained-estimates line).

D. **Trends-table cap.** In `insights-trends-table`: each `<tr>` beyond the 12th gets `data-trend-overflow="1"` (server side, by original order); after the table (inside the overflow region's parent, not the scroll region) render, only when `len .CategoryTrends` > 12, `<button type="button" data-trends-toggle aria-expanded="false" class="mt-2 text-base text-accent underline">Show all {{len .CategoryTrends}} categories</button>`. No `hidden` in server markup. `insights.js`: `applyTrendsCap()` sets `hidden` on every `tbody tr` whose index (current DOM order) ≥ 12 unless `table.dataset.expanded === 'true'`; runs on init, after every `sortTrendsTable` call, and after `htmx:afterSwap` touching `#insights-wrapper`; the toggle flips `data-expanded`, `aria-expanded`, its own text (`Show the largest 12` when expanded), and re-applies. With JS off all rows show.

Acceptance:
1. `go build && go vet`; `go test ./internal/templates/... ./internal/handlers/insights/...` green; DI/LT5/LT6 fixtures unmodified (if a DI test pins a moved sentence's position, STOP and report).
2. New test: (i) Investigation with Current 102113.36, Change +24043.33, 52 findings, Monthly 7803.64, history available → lead contains exactly `Net spending this period: <span class="num">$102,113.36</span> (<span class="num">+$24,043.33 increase</span> versus the prior period). 52 transactions to review; detected recurring spending is about <span class="num">$7,803.64</span> a month.` and the section line contains `$7,803.64`; (ii) history unavailable, 1 finding → `…$X. 1 transaction to review; …`; (iii) 0 findings → `No transactions to review; …`; (iv) trends table with 15 categories → 3 rows carry `data-trend-overflow`, the toggle text `Show all 15 categories`, no `hidden`; with 12 → no toggle.
3. Rendered (Playwright): trends table shows 12 rows by default, toggle reveals all, sorting keeps the cap (largest 12 by the sorted column), preset change (HTMX swap) re-applies; JS off → all rows visible; every new `<summary>` keyboard-toggles.
4. axe on /insights (default and June range, each tab) both themes 1280/390 — no new violations; `#insights-lead` is the first element after `#period-context`.
5. `make css`; `make css-verify`.

### RF4 — Chart data-table scroll regions (Tier 1, checks: a11y)

`dashboard.js`, the chart data-table builder (~line 105): when creating
`wrapper`, also set `wrapper.tabIndex = 0; wrapper.setAttribute('role','region'); wrapper.setAttribute('aria-label', title + ' chart data')` where `title` is the text of the nearest card `<h2>` (`plot.closest('.rounded-lg')?.querySelector('h2')?.textContent.trim()`), falling back to `'Chart'`. Nothing else changes.

Acceptance: `node --test "web/static/js/**/*.test.cjs"` green; on /dashboard at 390 both themes axe reports zero `scrollable-region-focusable` nodes (master has them); each region's accessible name reads e.g. "Spending by Major Expense chart data"; Tab reaches the region after its `<summary>`.

## RF.4 Rulings

(recorded as they happen; each catch names its mechanism)

- **RF-2026-09-07a** (catch — mechanism: WORKER stop, RF1 attempt 1; a
  brief-level error): the 17 px root bump makes the Explorer range picker
  overflow at 390 px (the stacked From/To/arrows group has no `flex-wrap`)
  and wraps three desktop nav links at 1280 px. RF1's acceptance demanded
  both stay clean but its territory excluded the two shared templates
  where the fix lives. The worker A/B-proved the root cause and stopped.
  Ruling: RF1's territory extends to `layouts/base.html` (desktop nav:
  `gap-6`→`gap-4`, links `px-3`→`px-2` + `whitespace-nowrap`) and
  `shared/range-picker.html` (add `flex-wrap` to the stacked group); item
  6 added; acceptance 5 tightened to one-line links. Attempt count
  unchanged.
- **RF-2026-09-07b** (catch — mechanism: WORKER stop, RF2 attempt 1;
  three items). (1) `handlers_http_test.go:2108` pins the Target line's
  `text-sm` class by regex; RF2-B mandates `text-base`. (2)
  `cmd/server/cross_money_di5_test.go` anchors its income capture on the
  FIRST occurrence of "Recorded income", which the spec-mandated lead
  sentence now precedes. Both tests pin presentation, not behaviour, and
  neither file was in RF2's territory. Ruling: territory extended; the
  class regex becomes `text-base`; the cross-money test anchors on the
  Income tile heading (`Recorded income</h2>` or the
  `data-kpi-detail="income"` tile) and ADDITIONALLY asserts that the lead's
  cash-flow figure equals the Cash-flow tile's figure (the test's purpose
  is cross-surface money reconciliation; the lead is a new surface, so the
  oracle grows rather than shrinks). (3) Brief fixture-math error: the
  "matched" fixture (10.006/10.004) does not produce $0.00 under
  `ReportingCashFlow`'s round-then-subtract; corrected to 10.001/9.999 as
  the worker proposed. Attempt count unchanged.
- **RF-2026-09-07c** (catch — mechanism: SECOND CHECKER, RF1 attempt 1,
  FAIL CONCEDED): the ruling-a nav fix (`whitespace-nowrap` + tighter
  gaps) fits the eight-link fixture but not the production state with the
  Duplicates badge (a ninth item): at 1280 px the page overflows by 69 px
  on the branch where master merely wrapped a link. The checker isolated
  the cause (the 17 px root bump leaves no headroom; nowrap converts wrap
  into overflow). Ruling: attempt 2 hides the three desktop group-label
  spans below 2xl (`hidden 2xl:inline`; ids kept so the groups' accessible
  names survive), acceptance 5 now requires the badge case. Lesson: a
  layout acceptance must name the widest production state, not the
  fixture the lead happened to look at.
- **RF-2026-09-07d** (observations — mechanism: PRIMARY CHECKER
  checker-tests on RF3 attempt 1, PASS with findings): (F1) the
  `/insights/recurring` partial renders `insights-recurring-partial`, a
  different define with its own visible caveat, so RF3-C never reached it
  (reachable only via `cmd/validate`; backlog). (F2) the `Retained
  estimates:` `<p>` was not bumped to `text-base`. (F3) the moved caveat
  still says "Each finding below is tied …" but the fold now sits after
  the list — a wording defect the "move verbatim" brief created. (F4) with
  JS off the "Show all N categories" button is inert (contract-compliant;
  observation). F2 and F3 are fixed by RF5 below; F1/F4 deferred.

### RF5 — Insights caveat wording and one type bump (Tier 1, checks: tests; worker: lead)

`pages/insights.html` only: (a) in the "About these findings" details, the
sentence `Each finding below is tied to an actual transaction …` becomes
`Each finding is tied to an actual transaction …` (drop the word "below";
no test pins it — verified by grep before the edit); (b) the `Retained
estimates: … monthly · … annual.` `<p>` gets `text-base` instead of
`text-sm` (RF3-B intent). Acceptance: `go test ./internal/templates/...
./internal/handlers/insights/...` green; the rendered `/insights` contains
`Each finding is tied` once and `finding below` zero times; the retained
line's class is `text-base`; `make css-verify` passes. Lead-direct under
the lean exception; checker-tests is the non-author eyes.

- **RF-2026-09-07e** (observations — mechanism: PRIMARY CHECKER
  checker-tests on RF2 attempt 1, PASS with findings): (O1) three tiles
  went to `text-4xl` while the "Spending versus plan" tile's figure stayed
  `text-2xl` — RF2-B was ambiguous. Lead decision on the rendered
  screenshot (both themes, 1280): KEEP the smaller size — that tile
  carries the verdict colour and its figure has a word attached
  ("$18,965.19 under"), which at `text-4xl` would wrap inside the tile;
  the three plain-figure tiles are the headline row. (O2) the moved methodology sentence still says "Monthly
  equivalents below use …" though the fold now sits after the grid (same
  class as RF3's F3). (O3) lead "matched" vs tile "matches" — both
  spec-mandated; harmless.

### RF6 — Dashboard methodology wording (Tier 1, checks: tests; worker: lead)

`components/kpis.html` only: inside "About these numbers", `Monthly
equivalents below use the selected range …` becomes `Monthly equivalents
use the selected range …` (drop "below"; no test pins it — grep verified).
Acceptance: `go test ./internal/templates/... ./internal/handlers/dashboard/... ./cmd/server/...`
green; rendered `/dashboard/kpis` contains `Monthly equivalents use` once
and `equivalents below` zero times; `make css-verify` passes.

- **RF-2026-09-07f** (observations — mechanism: a11y lane on RF1 attempt 1,
  PASS, sitewide contrast walk; all reproduce on master): light/dark
  contrast shortfalls on the nav group labels (`text-white/60` on the
  accent header — now hidden below 1536 px anyway), the active-tab
  overlay, a chart "Target $" label and a Plotly annotation, and
  `components/whatif/roth-conversion.html:31` missing its `dark:` text
  twin. Backlog. Harness note: one checker ran `git checkout master --
  web` inside a `cp -a` copy of the worktree; the copied `.git` file
  points at the SHARED worktree gitdir, so that command rewrites the real
  worktree's index (a no-op only because the branch had no commits yet).
  Checker briefs must say: strip `.git` from the copy, or use `git
  archive`, never checkout in a copy that still carries the `.git` file.

### RF7 — Regression guards for RF5/RF6 (Tier 1, checks: tests; worker: lead)

Test-only (V3 pattern: promote the checkers' rendered probes to tests).
`render_insights_rf3_test.go` (history-available lead test) additionally
asserts `Each finding is tied to an actual transaction`, the
`text-base` retained-estimates line, and the absence of `finding below`;
`render_dashboard_lead_rf2_test.go` (over-plan subtest) asserts `Monthly
equivalents use the selected range` and the absence of `equivalents
below`. Acceptance: `go test ./internal/templates/...` green; reverting
RF5 or RF6 in a scratch copy makes the respective test FAIL; `gofmt -l`
clean.

- **RF-2026-09-07g** (observations + close-out): (1) checker methodology —
  a bare `classList.toggle('dark')` does not fire the `themechange` event
  charts.js/insights.js listen for, so Plotly text stays light-themed and
  contrast walks produce ~80 false hits per page; use the real
  `#theme-toggle` click or a persisted `localStorage.theme` cold load.
  (2) Spec clarification: RF1 acceptance 5's tolerance for the deferred
  /whatif and /major-expenses overflow is read against the reported
  `scrollWidth` (498 ≤ 476 × 1.0625 + 8 = 513.75), not a delta. (3) A
  user-chosen larger root font (18.7 px) still overflows the nav with the
  badge at 1280 — backlog with the deferred list.
- **Run RF closed 2026-09-07**: `gate.sh done` exit 0; `gate.sh stats`
  verbatim: `first-attempt clean: 10/11 (no-evidence rows: 0)` across LT+RF
  (the one failure is RF1 attempt 1, a real catch by the adversarial lane —
  ruling c). Catches by mechanism this run: WORKER stops ×3 (rulings a, b,
  and RF1's initial overflow report), SECOND CHECKER ×1 (ruling c, the
  only FAIL), PRIMARY CHECKER observations ×2 promoted to RF5–RF7. Every
  catch was against a lead artifact (brief territory, acceptance numbers,
  fixture maths, wording), none against worker capability — the same
  pattern as run LT and the lean-verification retro. Merged 2026-09-08 as
  871c04c; a concurrent session's unpushed Roth commit (74d966e, already
  live on :8080) made local master diverge — the ship rule stopped the
  deploy until that session merged (master 43ce76e); deployed to :8080 the
  same morning (pid 3512799, health v1.4.0-1105-g43ce76e).

# Run BL — deferred accessibility backlog (2026-09-08)

Constitution for a four-task run in budget2 closing the pre-existing items
deferred by runs LT and RF. Approved by the user in chat 2026-09-08 ("Go
ahead") after the measured triage and the four-task design were presented.

## BL.0 Facts (measured on live :8080 = master 43ce76e, 2026-09-08)

| Page | Defect |
|---|---|
| /major-expenses @390 | `scrollWidth` 436 (three `table.w-full.text-body-sm.mt-1` without a scroll region; the anomalous-amount table at ~line 667 already has one); axe `target-size` on six row action buttons (`text-xs px-2 py-0.5`, Restore/Discard and approve/reject) |
| /whatif @390 | `scrollWidth` 498 — `components/whatif/spending-phases.html` phase rows (`flex items-center gap-3` → `flex-1 flex items-center gap-2` slider row) never wrap |
| /transfers @390 | axe `scrollable-region-focusable` on the history table's `div.mt-3.overflow-x-auto` |
| contrast (all pages) | nav group labels `text-white/60` ≈3.3:1; active nav link white on `bg-white/20` ≈4.2:1; the Budget-vs-Actual "Target $N" line label in a literal old-grey at 11 px ≈3.0:1 dark; `components/whatif/roth-conversion.html` `$` span lacks `dark:text-gray-400` (1.9:1 dark); `insights.js` prior-period marker colour uses old gray hexes |

Not in scope (deliberate): /explorer has no footer by design; the dead
`/insights/recurring` partial's caveat; nav overflow at a user-chosen 110 %
browser zoom.

Rules: no figure or sentence changes; ACCESSIBILITY.md points 3, 7, 9, 12;
both themes; 390/1280; `make css` + `make css-verify`; no `!important`.

## BL.1 Territory

- Worktree `/home/darrell/bin/ai/budget2/.claude/worktrees/backlog-a11y`, branch
  `feat/backlog-a11y` off master 43ce76e (`data` symlink, `tmp/tailwindcss-3.4.17`).
- BL1 (worker): `web/templates/pages/major-expenses.html` only.
- BL2 (worker): `web/templates/components/whatif/spending-phases.html` only.
- BL3 (lead): `web/templates/pages/transfers.html`; from attempt 2 (ruling
  BL-2026-09-08b) also `web/static/css/styles.css` (one selector in the
  existing focus-outline rule).
- BL4 (lead): `web/templates/layouts/base.html` (nav label opacity, active-link
  overlay), `web/templates/components/whatif/roth-conversion.html` (one span),
  `web/static/js/insights.js` (two hex literals), and wherever the
  Budget-vs-Actual "Target" annotation colour is set (`web/static/js/charts.js`
  or `internal/handlers/dashboard/*.go`).
- All in one wave; the lead runs the final `make css` + `make css-verify`.

## BL.2 Worker constraints (paste into every dispatch)

Same as RF.2: work only in the worktree; never git checkout/stash/commit or
touch the index; never run the built binary directly (kills live :8080);
`scripts/whatif-verify.sh start <port>` / `stop <port>` for rendered checks
(BL1 8171, BL2 8172, lead 8173, checkers 8181–8184; never :8080/:8081);
Playwright at `/home/darrell/.npm/_npx/e41f203b7505f1fb/node_modules/playwright`
with executablePath `/home/darrell/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`
and `args:['--no-sandbox']`; drive dark mode by clicking `#theme-toggle` (or
`#theme-toggle-mobile` at 390), NOT a bare classList toggle; axe via
addScriptTag with `/tmp/claude-1000/-home-darrell-work-agents2/fdc3d3ad-6feb-42fa-95ef-64e528e5cac8/scratchpad/a11y-u12/node_modules/axe-core/axe.min.js`;
`make css` for own verification; manifest at
`/home/darrell/work/agents2/.claude/worktrees/retired-couple-ui-layout-397a9a/.swarm/manifests/<task>.<attempt>.files`;
STOP with BLOCKED on ambiguity.

## BL.3 Tasks

| ID | Task | Files | Tier | Checks | Why |
|----|------|-------|------|--------|-----|
| BL1 | Major Expenses tables into scroll regions; row buttons to ≥24 px targets | `pages/major-expenses.html` | 2 | tests,a11y | Several tables and every row's forms; handler tests are the regression oracle, axe the a11y oracle. |
| BL2 | What-If spending-phase rows wrap at narrow widths | `components/whatif/spending-phases.html` | 2 | a11y | Visual oracle (overflow probe); JS hooks untouched but the slider must still work. |
| BL3 | Transfers history scroll region focusable + named | `pages/transfers.html` | 1 | a11y | Three attributes, strong oracle. Lead-direct. |
| BL4 | Contrast quartet | `layouts/base.html`, `components/whatif/roth-conversion.html`, `static/js/insights.js`, chart Target label source | 1 | a11y | Colour-only edits, strong oracle (measured contrast). Lead-direct. |

### BL1 — Major Expenses (Tier 2, checks: tests,a11y)

1. Every `<table class="w-full text-body-sm mt-1"...>` in the page that is
   not already inside an `overflow-x-auto` wrapper (the deleted-definitions
   table ~line 153, the two at ~544 and ~596, and ~741 — enumerate them all)
   gets wrapped exactly like the existing anomalous-amount table (~line 667):
   `<div class="overflow-x-auto" tabindex="0" role="region" aria-label="<what the table lists>">…</div>`
   with a distinct, descriptive label per table (e.g. "Deleted major expense
   definitions", "Exceptions", "Major expense definitions", …). Sortable
   table JS (`major-expenses-sortable`, `data-default-sort`) untouched.
2. Row action buttons (`Restore`, `Discard`, approve/reject and any sibling
   with `text-xs px-2 py-0.5`): change to `text-body-sm px-3 py-1.5` so the
   target is ≥ 24 × 24 CSS px (WCAG 2.5.8); keep the border/colour classes,
   ids, `hx-*` attributes and confirm texts byte-identical.
3. No other change.

Acceptance: `go test ./internal/handlers/majorexpenses/... ./internal/templates/...`
green; at 390 both themes `scrollWidth == clientWidth`, axe zero
`target-size` and zero `scrollable-region-focusable` on /major-expenses
(open every `<details>` first), each wrapped table's region reachable by
Tab with a distinct accessible name; at 1280 layout unchanged (tables
full width); `make css` / `make css-verify`.

### BL2 — What-If spending phases (Tier 2, checks: a11y)

In `spending-phases.html` (~lines 61–80): the phase row
`<div class="flex items-center gap-3">` → `flex flex-wrap items-center gap-3`;
the slider row `<div class="flex-1 flex items-center gap-2">` →
`flex-1 min-w-0 flex flex-wrap items-center gap-2` and the range input
`class="flex-1 …"` → `flex-1 min-w-[8rem] …`. Nothing else: ids, names,
`data-quick-adjust-*` hooks, `oninput` and label widths unchanged.

Acceptance: at 390 both themes `/whatif` `scrollWidth == clientWidth` (was
498) and no element in `main` extends past `innerWidth`; at 1280 and 1536
no phase-row element extends past its own card (ruling BL-2026-09-08a: the
card is a narrow sidebar column at 1280 where master's value spans already
spill ~106 px past the row; rows MAY wrap to two lines, which fixes that);
the range input keeps ≥ 8 rem of width;
dragging/keyboard-changing a phase slider still updates its two labels and
the quick-adjust key (Playwright: focus the range, ArrowRight, read the
`data-quick-adjust-display` spans); axe clean on /whatif (default tab) at
390/1280 both themes; `go test ./internal/handlers/whatif/...` green;
`make css` / `make css-verify`.

### BL3 — Transfers scroll region (Tier 1, checks: a11y; lead)

`div.mt-3.overflow-x-auto` gains `tabindex="0" role="region"
aria-label="Paired and external transfers"` (the table's sr-only caption
text). Acceptance: axe zero `scrollable-region-focusable` on /transfers at
390 both themes; Tab reaches the region; nothing else changed. Attempt 2
(ruling b): `[role="region"][tabindex="0"]:focus-visible` joins the
styles.css accent-outline rule, so EVERY keyboard-focusable scroll region
(transfers, major-expenses, insights tables, the dashboard chart tables)
shows a 2 px accent ring ≥ 3:1 against its card in both themes; verified
by a real keyboard Tab (not `.focus()`) on /transfers, /insights and
/dashboard in both themes.

### BL4 — Contrast quartet (Tier 1, checks: a11y; lead)

1. `base.html` desktop nav: the three group-label spans `text-white/60` →
   `text-white/80` (≥ 4.5:1 on the accent header, both themes).
2. `base.html` active nav link: `bg-white/20` → the largest opacity at which
   white `text-sm font-medium` still measures ≥ 4.5:1 against the blended
   header in BOTH themes (lead measures with a probe; expected `bg-white/10`
   or `/15`), desktop and mobile menus alike. `aria-current` stays the
   programmatic indicator.
3. `roth-conversion.html`: the `$` span gets `dark:text-gray-300` (attempt 2,
   ruling BL-2026-09-08c: the span paints over the input's `dark:bg-gray-700`
   fill, where gray-400 measures 4.07:1; gray-300 ≈ 6.7:1).
4. `insights.js`: the prior-period marker colours `#9ca3af`/`#6b7280` →
   stone `#a8a29e`/`#78716c`.
5. Budget-vs-Actual "Target $N" line label: drawn with the chart theme text
   colour (`colors.text` in charts.js, or the equivalent value if set in Go)
   at ≥ 12 px; if the label is set server-side, the Go change is limited to
   the annotation font colour/size.

Acceptance: a contrast probe (real `#theme-toggle` click for dark) of the
nav labels at 1536, the active nav link at 1280 and in the mobile menu at
390, the Roth `$` span, and the Target label, all ≥ 4.5:1 in both themes;
axe clean on /dashboard, /whatif, /insights at 390/1280 both themes; no
figure changes; `go build`, `go test ./internal/handlers/dashboard/...`,
`make css` / `make css-verify`.

## BL.4 Rulings

(recorded as they happen; each catch names its mechanism)

- **BL-2026-09-08a** (catch — mechanism: WORKER stop, BL2 attempt 1; a
  brief-level error): the lead wrote "at 1280 the phase rows render on one
  line as before" without looking at the card's width. The phase-config card
  is a narrow sidebar column at 1280 (~222 px of row width); on master the
  `%`/`$/mo` spans already overflow their row by ~106 px into adjacent
  whitespace, invisible to the page-level scrollWidth probe. The pinned
  `flex-wrap` + `min-w-[8rem]` therefore wraps at 1280 too — an improvement.
  Ruling: option (b); acceptance amended to "nothing extends past its card;
  rows may wrap; slider ≥ 8 rem". Attempt count unchanged.
- **BL-2026-09-08b** (catch — mechanism: PRIMARY CHECKER checker-a11y,
  BL3 attempt 1, FAIL CONCEDED; against the LEAD's own change): the new
  `role="region" tabindex="0"` wrapper relied on the browser's default
  `outline: auto`, which paints near-black in both themes — ≈1.3–1.9:1 on
  the dark card (points 7/9/12, WCAG 1.4.11). Found only with a real
  keyboard Tab; a synthetic `.focus()` after a mouse click hides it. The
  same latent defect exists on every pre-existing focusable scroll region
  (major-expenses.html:667, the LT5/RF4 regions). Ruling: styles.css gains
  `[role="region"][tabindex="0"]:focus-visible` in the accent-outline rule
  (sitewide fix); BL3 attempt 2. Lesson: any new focusable element must
  name its focus indicator, and checkers should Tab, not `.focus()`.
- **BL-2026-09-08c** (catch — mechanism: PRIMARY CHECKER checker-a11y,
  BL4 attempt 1, FAIL CONCEDED; against the LEAD's own change): the Roth
  `$` prefix sits over the amount input's `dark:bg-gray-700` fill, not the
  card, so the sibling-template pairing `dark:text-gray-400` the lead copied
  measures 4.07:1 there (axe misses it: single-glyph text is exempted by
  its short-text heuristic). Ruling: `dark:text-gray-300`; attempt 2. The
  other four BL4 items measured 4.63–12.08:1 and stand. Lesson: measure
  against the element's own painted background, not the card's.
- **BL-2026-09-08d** (observation — mechanism: PRIMARY CHECKER checker-a11y
  on BL2, PASS): the range inputs' indigo focus box-shadow (the sitewide
  `input:focus` rule in styles.css) measures ≈2.3:1 against the dark card,
  below WCAG 1.4.11's 3:1; byte-identical on master. Backlog: give
  `input:focus`/`select:focus` a theme-aware ring (the accent token) like
  the outline rule BL3 extended.
- **BL-2026-09-08e** (observations — mechanism: PRIMARY CHECKER
  checker-tests on BL1, PASS): (1) brief fact error — BL.0 named
  "approve/reject" buttons that do not exist; the six target-size hits were
  three Restore + three Discard, so the two class edits cover all six.
  (2) axe's `target-size` rule is OFF in the default rule set — a plain
  `axe.run` silently misses it; checkers must force it via `runOnly`.
  (3) No in-repo test guards the four new regions or the button classes —
  promoted to BL5 (test-only, V3 pattern). (4) `empty-table-header` on a
  `w-6` header cell and the bulk-pin Apply/Clear at 21 px tall are
  pre-existing (the latter passes 2.5.8 under the spacing exception).

### BL5 — Regression guards for BL1 (Tier 1, checks: tests; lead)

Test-only (V3 pattern): `internal/templates/render_major_expenses_test.go`
gains assertions in three existing tests — the Deleted panel renders inside
`role="region" aria-label="Deleted major expense definitions"` and its
buttons carry `text-body-sm px-3 py-1.5` (and never `text-xs px-2 py-0.5`);
the AllUnmatched table renders inside `aria-label="Unmatched exceptions"`;
the legacy/exceptions fixture renders the "Unmatched exceptions over
threshold", "New merchant exceptions" and "Matched but anomalous amount
table" regions. Acceptance: `go test ./internal/templates/...` green;
reverting BL1's template in a scratch copy makes the guarded tests FAIL;
`gofmt -l` clean.

- **BL-2026-09-08f** (harness observation — mechanism: a11y lane on BL1):
  checker ports 8181–8184 were shared by concurrent checkers and one
  checker's server was killed from under it by a sibling reusing the port,
  and a scratch script was overwritten. Give every checker its OWN port and
  scratch subdirectory in the brief (the lead assigned a pool, not a slot).
  Also pre-existing, out of scope: bulk-pin Apply/Clear (21 px) and the
  ~60 row-toggle chevrons (15 px) stay under 24 px (spacing exception).
- **BL-2026-09-08g** (observation acted on — mechanism: PRIMARY CHECKER
  checker-tests on BL5 attempt 1, PASS): four of the five region guards
  pinned only `role`/`aria-label`, so stripping `tabindex="0"` (the very
  defect BL1 fixed) left the suite green. Attempt 2 pins the full wrapper
  string on all five. Not a FAIL (in contract), re-verified anyway because
  a guard that misses its own defect is not a guard.
- **Run BL closed 2026-09-08**: `gate.sh done` exit 0; `gate.sh stats`
  verbatim: `first-attempt clean: 13/16 (no-evidence rows: 0)` across
  LT+RF+BL (BL alone 3/5: BL3 and BL4, both lead-direct, failed attempt 1
  on real primary-checker catches — rulings b and c). `make check` green;
  agents2 smoketest ALL PASS. Shipped as budget2 commit 23a949c on
  `feat/backlog-a11y`, PR #99 merged 2026-09-08 as master 5a75ca1 and
  deployed to :8080 the same day (pid 3628425, health v1.4.0-1107-g5a75ca1). Catches by
  mechanism: WORKER stop ×1 (ruling a, brief error), PRIMARY CHECKER
  FAIL ×2 (rulings b, c — both against the lead's own edits, both invisible
  to axe: a keyboard-only focus ring and single-glyph text), PRIMARY
  CHECKER observations promoted ×2 (rulings e→BL5, g). Lessons: the lead
  is not exempt from the fresh-eyes rule — both lead-direct tasks failed
  where the worker tasks did not; measure contrast against the element's
  own painted background; Tab, never `.focus()`; force `target-size` in
  axe; give each checker its own port and scratch dir.

# Run BK — remaining accessibility backlog (2026-09-08)

Two-task run closing what run BL left. Approved by the user in chat
2026-09-08 ("Go ahead") after the measured triage.

## BK.0 Facts (measured on live :8080 = master 5a75ca1)

| Item | Defect |
|---|---|
| sitewide `input:focus, select:focus` (styles.css ~131) | literal `#6366f1` ring: 2.30:1 against the dark input fill (`dark:bg-gray-700` = stone-700 `#44403c`); 4.47:1 on white in light |
| /major-expenses bulk-pin `#major-expenses-bulk-pin-apply` and `.major-expenses-bulk-pin-clear` (~514–519) | `px-2 py-0.5 text-xs`, 21.3 px tall when visible (after ticking a `.major-expenses-pin-check`) |
| /major-expenses `.major-expense-row-toggle` (~235; 47 on live data) | button = its 14.9 px icon, no padding |
| /major-expenses `<th scope="col" class="w-6"></th>` (~202) | axe `empty-table-header` |
| Dashboard donut "34.3%" | VERIFIED CLEAN: the one inside label is white on `rgb(31,119,180)` at 4.82:1; outside labels sit on the card at ≈9:1. No task. |

Out of scope (deliberate, unchanged): Explorer footer; dead Insights
partials; nav at 110 % zoom.

## BK.1 Territory

- Worktree `/home/darrell/bin/ai/budget2/.claude/worktrees/backlog-a11y-2`,
  branch `feat/backlog-a11y-2` off master 176383f (PR #100 landed after the BL deploy; :8080 still runs 5a75ca1) (`data` symlink,
  `tmp/tailwindcss-3.4.17`).
- BK1 (lead): `web/static/css/styles.css` only.
- BK2 (worker): `web/templates/pages/major-expenses.html` and
  `internal/templates/render_major_expenses_test.go` only.
- The lead runs the final `make css` + `make css-verify`.

## BK.2 Worker constraints

Same as BL.2 (never run the binary; `scripts/whatif-verify.sh start/stop`;
ports BK2 8201, checkers 8211 (BK1 a11y), 8212 (BK2 tests), 8213 (BK2 a11y)
— ONE port and ONE scratch subdirectory per agent, never shared; Playwright
path as before; dark mode via a real `#theme-toggle` click; axe via
addScriptTag with `target-size` FORCED through `runOnly` — it is off in the
default rule set; manifests under
`/home/darrell/work/agents2/.claude/worktrees/retired-couple-ui-layout-397a9a/.swarm/manifests/`).

## BK.3 Tasks

| ID | Task | Files | Tier | Checks | Why |
|----|------|-------|------|--------|-----|
| BK1 | Focus ring on inputs/selects/textareas uses the accent token | `styles.css` | 1 | a11y | One rule, sitewide, strong oracle (measured ring contrast). Lead-direct. |
| BK2 | Major Expenses: bulk-pin buttons and row toggles to ≥ 24 px; spacer header labelled; render guards | `pages/major-expenses.html`, `render_major_expenses_test.go` | 2 | tests,a11y | 47 controls + JS hooks; handler/render tests are the regression oracle, axe the a11y oracle. |

### BK1 — Focus ring (Tier 1, checks: a11y; lead)

`input:focus, select:focus` → `input:focus, select:focus, textarea:focus`
with `box-shadow: 0 0 0 2px rgb(var(--accent))` (indigo-600 light,
indigo-300 dark). No `!important`; nothing else.

Acceptance: with REAL keyboard focus (Tab, not `.focus()`), the ring on a
text input, a date input and a select measures ≥ 3:1 against the input's
own fill AND the card behind it, both themes (expect light ≈6.7:1 on
white, dark ≈4.7:1 on stone-700); the What-If number inputs and the
Dashboard date inputs behave the same; no other focus style changed
(`git diff` is that one rule); axe clean on /dashboard, /whatif,
/major-expenses at 1280 both themes; `make css-verify`.

### BK2 — Major Expenses small controls (Tier 2, checks: tests,a11y)

1. `#major-expenses-bulk-pin-apply` and `.major-expenses-bulk-pin-clear`:
   `px-2 py-0.5 … text-xs` → `px-3 py-1.5 … text-body-sm` (keep colours,
   ids, `hidden`/`disabled` handling, aria-label, text).
2. Every `.major-expense-row-toggle` button: add
   `inline-flex h-6 w-6 items-center justify-center rounded` (24 px box
   at the 16 px base, ~25.5 px at the 17 px root); the SVG icon, its
   `aria-*`, `data-*` and the class the JS selects are unchanged.
3. The chevron column header `<th scope="col" class="w-6"></th>` gains
   `<span class="sr-only">Details</span>`.
4. `render_major_expenses_test.go`: extend the existing BL5 guards to
   assert the Apply button's new classes, the row-toggle class string, and
   the `Details` sr-only header; assert `px-2 py-0.5` no longer occurs
   next to `text-xs` on the page (note line ~306 has `px-2 py-0.5` on a
   `<p>`, not a control — do not touch it, and do not assert on it).

Acceptance: `go test ./internal/handlers/majorexpenses/... ./internal/templates/...`
green; at 1280 and 390, both themes, with a `.major-expenses-pin-check`
ticked so Apply/Clear are visible and every `<details>` open: axe with
`target-size` forced → zero `target-size`, zero `empty-table-header`;
Apply, Clear and every row toggle ≥ 24 × 24 CSS px; a row toggle still
expands/collapses its row by mouse click and by keyboard (Enter/Space),
`aria-expanded` (if present) toggling; the sortable and bulk-pin JS
unchanged (`git diff` touches only the two files); the reverted template
makes the new guards FAIL; `make css` / `make css-verify`.

## BK.4 Rulings

(recorded as they happen; each catch names its mechanism)

- **BK-2026-09-08a** (observation — mechanism: WORKER on BK2): at exactly a
  1280 px viewport, Chromium's scrollbar gutter can leave the desktop nav
  (`hidden xl:flex`, xl = 1280) just under the breakpoint, so the desktop
  `#theme-toggle` is not visible to an actionability-checked Playwright
  click. Test harnesses should use 1300 px (or the mobile toggle at 390);
  real users at 1280 with an overlay scrollbar are unaffected. Backlog
  candidate: none — behaviour is correct, only the probe width matters.
- **BK-2026-09-08b** (observations — mechanism: PRIMARY CHECKER
  checker-tests on BK2, PASS): (1) brief accuracy — master produced NO axe
  `target-size` hit for these controls (the SC 2.5.8 spacing exception
  applies), only `empty-table-header`; the defect is shown by measurement
  (14.9 → 25.5 px, 21 → 34 px), not by an axe delta. (2) `swarm/t7-
  coverage.sh` exits 1 identically on branch and master — pre-existing,
  not in `make check`. (3) the new guards' messages still say "BL5 guard"
  under BK2 comments — cosmetic.
- **BK-2026-09-08c** (catch — mechanism: PRIMARY CHECKER checker-a11y on
  BK2, PASS with a real pre-existing finding): `.major-expense-row-toggle`
  (a `<button>` with no explicit focus class) shows the browser default
  ring at 1.48:1 in dark mode — the same defect class BL3 fixed for scroll
  regions, now on buttons; byte-identical on master. Promoted to BK3.

### BK3 — Fallback focus indicator for unstyled controls (Tier 1, checks: a11y; lead)

`styles.css` appends
`:where(button, [role="button"], a[href], summary, [tabindex="0"]):where(:not([class*="focus-visible:ring"], [class*="focus:ring"])):focus-visible { outline: 2px solid rgb(var(--accent)); outline-offset: 2px; }`
plus, for controls inside the accent header,
`nav :where(button, a[href]):where(:not(…same…)):focus-visible { outline-color: rgb(255 255 255); }`
(attempt 2, ruling BK-2026-09-08d). `:where()` keeps specificity at zero
(the `nav` prefix adds 0,0,1) so every element's own Tailwind utilities
(0,1,0) still win; the `:not()` excludes anything that already carries a
ring utility, so no control gets two indicators. No `!important`.

Acceptance (real keyboard Tab, both themes, verify server): the Major
Expenses row toggle, the Restore/Discard buttons, a nav link, the mobile
menu toggle, a `<summary>` (Period details) and a `[tabindex="0"]` scroll
region show a 2 px accent ring ≥ 3:1 against their background; a control
WITH explicit utilities (`#import-csv-btn`: `focus:outline-none
focus-visible:ring-2 focus-visible:ring-accent`; the What-If tabs; the
Insights tabs) renders exactly as on master (no double indicator — outline
stays the transparent Tailwind one); mouse click on a button shows no ring
(`:focus-visible`); axe clean on /dashboard, /major-expenses, /whatif,
/insights at 1300 and 390 both themes; `make css-verify`.

- **BK-2026-09-08d** (catch — mechanism: PRIMARY CHECKER checker-a11y on
  BK3 attempt 1, FAIL CONCEDED; against the LEAD's own change): (1) in
  light mode `--accent` and `--accent-strong` are the same indigo-600, so
  the accent ring on a nav link or the menu toggle was pixel-identical to
  the header (1.00:1) where the browser default had been visible; (2) tiles
  with `focus-visible:ring-2` but no `focus:outline-none` got the outline
  on top of their ring. Both invisible to axe; found by a real-Tab pixel
  walk. Ruling: header controls get a white ring via a `nav`-scoped
  `:where` rule; the fallback excludes `[class*="focus-visible:ring"]` and
  `[class*="focus:ring"]`. Attempt 2. Lesson (third time this week): a
  sitewide rule must be walked on every surface it can land on, including
  the accent header, before it is called done.
- **BK-2026-09-08e** (contract rewrite — mechanism: PRIMARY CHECKER
  checker-a11y on BK3 attempt 2, FAIL CONCEDED; two consecutive FAILs to
  the same class = lead/spec defect per the hard-stop rule): the header
  override fixed the nav, but every OTHER accent-filled control outside
  `<nav>` (`#whatif-new-scenario-toggle`, `#add-chain-step-btn`, the
  projection Nominal toggle, the active date-range preset, three more
  `bg-accent-strong` buttons) still got a 1.00:1 accent ring in light mode.
  A single ring colour cannot contrast with both neutral cards and accent
  fills. Contract rewritten: ONE rule, the concentric two-tone ring —
  `box-shadow: 0 0 0 2px rgb(255 255 255)` (white inner, flush) plus
  `outline: 2px solid rgb(var(--accent)); outline-offset: 2px` (accent
  outer); the `nav` override is removed. Acceptance for attempt 3 (the
  LAST allowed): for every BK3-ringed control on /dashboard, /whatif,
  /major-expenses, /insights, /transfers, /accounts in both themes, the
  BETTER of (white inner ring vs the colour immediately outside the
  element) and (accent outer ring vs the colour it sits on) is ≥ 3:1; no
  control with a ring utility changes; mouse click shows no ring; inputs
  unchanged. If attempt 3 fails, BK3 halts and is reported.
- **BK-2026-09-08f** (HARD STOP — mechanism: PRIMARY CHECKER checker-a11y
  on BK3 attempt 3, FAIL): the two-tone ring fixed the contrast defect on
  every surface (full Tab sweep, six pages, both themes, minimum 5.76:1;
  every attempt-2 offender now visible). The FAIL is narrower: the What-If
  and Insights tabs and the What-If collapse toggles carry a BESPOKE
  outline rule (`[data-wf-tab]:focus-visible` etc., no Tailwind ring
  utility), so the `:not()` exclusion misses them and they gain the white
  inner band on top of their own accent outline — a "controls unchanged"
  deviation, not a contrast regression (imperceptible in light, a visibly
  wider ring in dark). Three failed attempts halt the task per the
  constitution; the lead does not spend a fourth on its own authority.
  Options for the user: (a) one more attempt adding the bespoke-outline
  selectors to the `:not()` list (a one-line change, well understood);
  (b) accept the wider ring on those tabs as the new look; (c) drop BK3,
  ship BK1+BK2. Lesson: an exclusion list built from Tailwind class
  patterns cannot see project-level focus rules — enumerate the
  stylesheet's own `:focus-visible` selectors before writing a fallback.
- **BK-2026-09-08g** (USER ruling, reopen — 2026-09-08, "2"): the user
  chose option (b): the wider two-tone ring on the What-If tabs, Insights
  tabs and What-If collapse toggles is accepted as the new look. Per the
  reopened-scope precedent (2026-08-29c/d), this later, specific ruling
  governs acceptance: the "controls unchanged vs master" clause now
  applies only to controls with a Tailwind ring utility; bespoke-outline
  controls MAY gain the white inner band provided the combined ring
  measures ≥ 3:1 against its surroundings in both themes and renders as
  one coherent indicator. Attempt 4 is a re-verification of the attempt-3
  code (no change) under this acceptance; attempt-3 evidence for the
  sweep, axe and hygiene may be reused where the tree is unchanged.
- **Run BK closed 2026-09-08**: `gate.sh done` exit 0; `gate.sh stats`
  verbatim: `first-attempt clean: 15/19 (no-evidence rows: 0)` across
  LT+RF+BL+BK. `make check` green; agents2 smoketest ALL PASS. Shipped as
  budget2 commit 141e6ea on `feat/backlog-a11y-2`, PR #101 merged as
  master a71e8b9 and deployed to :8080 the same afternoon (pid 3878904,
  health v1.4.0-1111-ga71e8b9). Catches by mechanism: PRIMARY CHECKER FAIL ×3 (BK3
  attempts 1–3, all against the lead's own CSS, all invisible to axe),
  PRIMARY CHECKER observations ×3 (rulings a–c; c became BK3), USER
  ruling ×1 (g, reopen). The four-attempt BK3 arc is the run's real
  output: a sitewide focus rule is a design decision, not a one-liner —
  enumerate every surface (neutral card, dark card, accent fill, header)
  and every existing focus rule (utilities AND bespoke selectors) before
  writing it, and use a two-tone ring so no single background can hide it.
