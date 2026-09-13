# Run IP — Insights page presentation (2026-09-13)

Run prefix: **IP**. Lead: this session (agents2 worktree
`insights-page-presentation-aff8ff`). Target repo:
`/home/darrell/bin/ai/budget2` (github.com/dgallion1/simpleBudget).
Implementation worktree: `.worktrees/insights-presentation` on branch
`feat/insights-presentation` at master **763337f**, with `data -> ../../data`
symlink (untracked, LIVE data — never write to it). All manifest paths are
budget2-repo-relative. `.swarm/` lives in THIS agents2 worktree.

Previous runs are archived in `docs/runs/`. Lean-verification experiment
(agents2 CLAUDE.md, 2026-08-31) still active: record every catch in §7 with
the mechanism that caught it; run `swarm/gate.sh stats` at the end.

## 0. Status — IP1 ACCEPTED 2026-09-13 (gate OK at attempt 2, dual-lane); `gate.sh done` OK; stats 0/1 first-attempt clean. Uncommitted on `feat/insights-presentation`; commit/push/PR/deploy pending user go-ahead.

Approved 2026-09-13 ("yes, go ahead") on the recommended design.

User request (verbatim): "Can you improve the presentation here?
http://localhost:8080/insights?end=2026-08-27&start=2026-01-01".

## 1. What the lead found (live :8080, 2026-01-01..2026-08-27)

1. **Key figures are prose.** "What changed" states Selected / Prior /
   Dollar difference as three grey sentences. The Dashboard shows the same
   class of figure as tiles.
2. **Largest contributors** are a plain list; the delta sits far right with
   only the percent coloured; no sense of magnitude.
3. **Findings** are three lines of undifferentiated text each. Severity and
   finding type ("Category outlier · high severity") are plain text; every
   amount carries the prefix "Actual transaction:".
4. **Recurring spending** is three same-looking cards; the three monthly
   figures that matter are scattered across three intro lines.
5. **Period context** is a large grey block; the stale-data warning is
   indistinguishable from the neutral facts beside it.
6. **The page is long**; the chart tabs are at the bottom with no way to
   reach a section without scrolling.

## 2. Goals and non-goals

Goals: make the Insights page scannable — figures as tiles, deltas with
magnitude and sign, findings with visible severity/type, recurring totals
gathered, stale-data warning distinguished, in-page navigation — while
keeping every figure's formatter, wording that tests pin, and the a11y
standard.

Non-goals: no change to any analytic, threshold, sort order, or figure
(the numbers on screen after this run are byte-identical to before); no
change to the Dashboard's rendering of `shared/period-context`; no change
to the chart tabs' JS behaviour; no two-column layout; no new dependencies.

## 3. Design (approved)

All markup lives in `web/templates/pages/insights.html`,
`web/templates/components/insights-investigation.html`, and
`web/templates/components/shared/period-context.html` (opt-in flag only);
styling uses existing Tailwind utilities and the tokens in
`web/static/css/styles.css` (`accent`, `positive`, `negative`, `warning`,
`*-soft`). Rebuild `web/static/css/tailwind.css` with `make css` and commit
it (`make css-verify` must pass).

### 3.1 "What changed" figure strip
Replace the two sentences "Selected period: … · Prior period: …" and
"Dollar difference: …" with three tiles in the Dashboard KPI style
(`rounded-xl border p-4`, `text-label font-semibold uppercase tracking-wide`
label, `num text-3xl font-bold` value; grid `grid-cols-1 sm:grid-cols-3`):
- **Selected period** — `formatMoney .Current`.
- **Prior period** — `formatMoney .Previous`.
- **Change** — the existing `insights-dollar-change` partial (unchanged)
  as the value, coloured by direction (`text-negative` up, `text-positive`
  down, neutral otherwise), with the existing `insights-change-cell`
  partial beneath it as the caption. The tile's border/background uses the
  matching `*-soft` token so sign is also conveyed by the label text
  ("increase"/"decrease" is already in the partial — meaning is not colour
  alone).
When `HistoryAvailable` is false, render only the Selected tile plus the
existing "Not enough history to compare" sentence.

### 3.2 Contributor bars
Each `Largest contributors` row keeps its link and its delta text
(`insights-dollar-change · insights-change-cell`, unchanged), and gains:
- the dollar delta coloured by direction (same rule as 3.1);
- a bar beneath the name: a track (`bg-gray-200 dark:bg-gray-700`, 6–8 px
  tall, rounded) with a fill whose width is `round(100 × |Change.Amount| /
  max|Change.Amount| over the rendered contributors)` percent, fill colour
  `bg-negative` for increases and `bg-positive` for decreases. The largest
  row is 100 %. Guard max = 0 (no bar). The bar is decorative
  (`aria-hidden="true"`); the text carries the meaning. Contributors are
  already sorted by |change| desc, so max is the first row's |change|.
- Beware ZgotmplZ: a computed width in a `style` attribute must render as a
  literal `width: NN%` in the HTML — assert it in a test.

### 3.3 Findings rows
Each `insights-finding` row becomes a two-column row (`flex justify-between
gap-4`, wrapping at narrow widths):
- Left: merchant link (unchanged href/text) on the first line; a chip row
  on the second line: a finding-type chip with the row's `Label`
  ("Category outlier", "New merchant", "Price creep", …; neutral
  `bg-gray-100 dark:bg-gray-700`) and, for anomaly findings, a severity
  badge — `high` → `bg-negative-soft text-negative` text "High severity";
  `medium` → `bg-warning-soft text-warning` text "Medium severity". Add a
  `Severity string` field to `FindingView` set from the anomaly's
  `Severity` (empty for price-creep). The badge text keeps the word
  "severity" so the information is in text, not colour. Third line: the
  meta line (date · category · Major Expense) muted, unchanged text.
  Price-creep rows keep their evidence sentence (`Median of first three
  vs last three charges: $A → $B (x% increase), d1 to d2.`) as a fourth
  muted line.
- Right: the amount `formatMoney .Transaction.Amount` in `num text-lg
  font-semibold`, right-aligned, with a small muted caption "actual
  transaction · outflow" beneath it (the qualifier stays in the DOM —
  price-creep rows show a median that differs from the actual amount).
- Anomaly rows drop the "· high severity" plain text from the third line
  (the badge carries it). The count sentence and both `<details>` folds are
  unchanged.

### 3.4 Recurring summary strip
Under the "Detected recurring spending" heading and its "Retained
estimates" sentence (sentence unchanged — RF5 guard), add a three-tile
strip, one tile per group in `Groups` order: label (`.Label`), monthly
figure `formatMoney .Monthly` (`num text-2xl font-bold`), caption
"`N` series · `formatMoney .Annual` a year". Each tile is a link
(`href="#recurring-<ID>"`) to its group card. Group cards are unchanged.

### 3.5 Compact period context (Insights only)
`shared/period-context` gains an optional `Compact` field: when the
template is invoked with a dict `(dict "Period" .Period "Compact" true)`
it renders (a) the summary sentence as one `text-sm` muted line with NO
card chrome (no `bg-white … shadow p-4`), (b) the `Period details`
fold unchanged, and (c) when `Stale`, the stale sentence as a callout:
`rounded-lg border border-warning bg-warning-soft text-warning px-3 py-2`
prefixed by a visually-present "Note:" so it is distinguishable without
colour. When `Compact` is absent/false the partial renders exactly as
today (the Dashboard, `/insights/*` partials, and the LT1/DI2 tests must
be byte-identical). `insights.html` passes `Compact true`. Keep
`id="period-context"` on the wrapper and keep it BEFORE `#insights-lead`
(RF3 test).

### 3.6 In-page navigation
Directly under `#insights-lead`, a `<nav aria-label="On this page">` with
four links: "What changed" → `#insights-change`, "Review" →
`#insights-findings`, "Recurring" → `#insights-recurring`, "Charts" →
`#insights-supporting`. Styled as a row of `text-sm` accent links with
`gap-4`, wrapping at narrow widths. Sections keep their order. (The lead
substituted this for the earlier "move the tab strip up" idea: a tablist
separated from its panels harms grouping and a11y; anchors give the same
reach.) `scroll-margin-top` on the four targets so the sticky header does
not cover the heading.

### 3.7 Invariants
- Lead sentence (`#insights-lead`) text and the `insights-dollar-change`
  partial are pinned character-for-character by
  `internal/templates/render_insights_rf3_test.go` and must not change.
  `investigation_sv1_test.go` pins the findings count sentence and
  `<details id="all-findings">`.
- Every money figure is rendered by `formatMoney`; no new formatter, no
  arithmetic over rendered strings. The only new computed number is the
  decorative bar width (3.2).
- Both themes; 375 px and 1440 px; ACCESSIBILITY.md (budget2) applies —
  contrast 4.5:1 text / 3:1 non-text (bars, badges), heading order, no
  colour-only meaning, focus visible on new links, target size ≥ 24 px on
  the new nav/strip links.

## 4. Tasks

| Task | Tier | Checks | Worker | Scope | Acceptance |
|---|---|---|---|---|---|
| IP1 | 2 | a11y,second | worker-coder | §3.1–3.6 in the three templates + `FindingView.Severity` + tests + `make css` | `go build ./... && go vet ./... && go test ./... -count=1` green; `make css-verify` passes; new render tests cover: bar width 100 % on the largest contributor and a literal `width:` in the HTML (no ZgotmplZ), severity badge text for high/medium and absent for price-creep, Compact period-context callout only when Stale, non-Compact output byte-identical to master's; RF3/SV1/LT1/DI2 tests untouched and green; checker-a11y PASS (both themes, 375/1440, axe zero, points cited); checker-second PASS (figures byte-identical to master for the same fixture; Dashboard period-context unchanged) |

Tier rationale (TIERS.md): weak oracle (taste in layout) + reversible +
one page → Tier 2. `second` added because the task re-renders money
figures and adds a computed width on a new surface; the adversarial lane
must prove no figure changed (diff the rendered numbers against master on
the same fixture) and that no threshold/classification was re-implemented
in the template (severity comes from ONE source, the anomaly service).

`critical.globs` copied from run CX; none of IP1's files match it.

## 5. Territory
Only the IP worktree `.worktrees/insights-presentation`. No other lead in
the repo at run start (other `.claude/worktrees/*` are idle sessions'
branches; not touched).

## 6. Deploy
After merge: build from a clean detached worktree at the merge commit
(rule from run TC), stop the live :8080 process, start the new binary
with the same cwd/env as the running one, verify `/insights` renders.

## 7. Rulings
(recorded as the run proceeds; each names the mechanism that caught it)

- **IP-2026-09-13a — IP1 attempt 1: Compact period-context never wired
  into the page.** Mechanism: **lead review** (own visual pass on a
  throwaway :8098 instance over a scratch copy of the synthetic demo data,
  before any verdict landed). `shared/period-context` gained the `Compact`
  branch and a partial-level test, but `insights.html:41` still calls
  `{{template "shared/period-context" .}}` with no `Compact`, so the live
  page renders the old card and never shows the "Note:" callout (§3.5).
  Cause: the worker's test rendered the partial in isolation; the spec's
  acceptance named "Compact period-context callout only when Stale" without
  saying "on the rendered page". Attempt 2 contract: pass `(dict "Period"
  .Period "Compact" true)` from the page; add a PAGE-level assertion (render
  `insights-content` with a Stale period and require `Note:` and the
  absence of the card chrome inside `#period-context`). Attribution update: **checker-second (adversarial lane) independently
  FAILED attempt 1 on the same defect** (`IP1.1.checker-second.verdict`:
  built and served the branch on :8099, found the card chrome; every other
  probe — money-figure diff vs master, single-source severity, bar widths,
  pinned tests unmodified, css-verify — clean). Lead CONCEDED the FAIL; no
  panel. Escalate-scan wrote no flag. checker-a11y's attempt-1 verdict is
  noted below when it lands.

- **IP-2026-09-13b — IP1 attempt 1: new neutral tiles' borders below 3:1.**
  Mechanism: **primary checker (checker-a11y)**, ACCESSIBILITY.md §7
  non-text contrast. The five neutral tiles (Selected, Prior, three
  recurring-strip links) used `border-gray-200 dark:border-gray-700`
  (1.15–1.70:1 measured, both themes). The spec pattern was copied from the
  Dashboard's `components/kpis.html`, which carries the same sub-3:1 pair
  untouched (backlog observation, out of scope). Lead CONCEDED. Attempt 2
  (lead-direct, Tier 2 lean exception): `border-gray-500 dark:border-gray-400`
  — stone-500 on white/stone-100 = 4.8/4.4:1, stone-400 on stone-800/900 =
  6.0/6.9:1 (lead WCAG calculation; checker re-measures) — pinned on all
  six neutral sites by `TestIP1NeutralTileBorderContrast`. Note for the
  attribution: checker-a11y's attempt-1 fixture exercised the stale period
  but did NOT flag the unwired Compact callout (ruling a); the lead and the
  adversarial lane did. checker-a11y attempt 1 otherwise clean: axe zero new
  violations (one pre-existing empty-text link in the category comparison
  table, byte-identical to master — backlog), heading order, landmarks,
  focus, target size, Dashboard and `/insights/*` partials byte-identical.

- **IP-2026-09-13c — final-pass a11y scope (lead ruling).** The constitution's
  site-wide `checker-a11y` pass was satisfied by: the full audit of
  `/insights` (both themes, 375/1440, axe) at attempt 2, PLUS proven
  byte-identity vs master of every other consumer of the only shared file
  touched (`shared/period-context`: Dashboard `/` and the three `/insights/*`
  partials, `diff` exit 0 in both lanes). `insights-investigation.html` and
  `insights.html` have no other consumers. No other page's markup changed,
  so a site-wide re-audit would re-measure master-native state.
- **Backlog observations (both lanes):** Dashboard `components/kpis.html`
  neutral tiles carry the same sub-3:1 `border-gray-200 dark:border-gray-700`
  pair (same defect class as ruling b, out of scope); one pre-existing
  axe `link-name` violation (empty-text link) in the category comparison
  table on `/insights`, byte-identical to master.
