# Final-pass accessibility sweep — Run RB (role-basis)

Standard: `/home/darrell/bin/ai/budget2/ACCESSIBILITY.md` (numbered points) + WCAG 2.2 AA.

## Scope confirmed
`git diff 6bf3839` inside the RUN worktree (`fix/role-change-phase-basis`,
uncommitted) touches exactly two files, both JS:
- `web/static/js/whatif-rate-assumptions.js` (+36 lines: `phaseBasisRecords()`
  helper + `updatePersonRole` change)
- `web/static/js/whatif-rate-assumptions.test.cjs` (tests only, no runtime
  effect)
No template, CSS, or Go change. Every other page byte-identical to 6bf3839.

## Method
Built RUN (worktree copy) and base (6bf3839 archive) with
`nice -n 19 GOMAXPROCS=4 go build`, each against its own `cp -rL` data copy,
one server at a time (127.0.0.1:18094 for RUN, 127.0.0.1:18095 for base),
never touching :8080. Drove real Playwright (cached chromium) against the
live servers, injected real axe-core 4.13.0 (version-matched to the cached
`@axe-core/cli`), theme set via `localStorage.theme` before navigation (the
site's own inline theme-init script then applies `class="dark"`/`"light"` to
`<html>` — no hand-built HTML or guessed CSS). Confirmed with
`ss -ltnp | grep -E ':(8080|1809[0-9])'` before/after that only the
pre-existing :8080 stayed listening.

## 1. Site-wide axe sweep, RUN vs base
9 pages (dashboard, explorer, insights, major-expenses, whatif, accounts,
transfers, filemanager, duplicates) × 2 themes (light/dark) × 2 builds = 36
runs, `wcag2a/2aa/21a/21aa/22aa/best-practice` rule tags.

**Result: RUN and base produced byte-identical violation and incomplete
sets on every one of the 18 page/theme combinations.** One axe VIOLATION
found, present identically on both trees:
- `/whatif`, dark theme only: `color-contrast` (serious) on
  `.mt-5 > summary` ("Adjust spending rules manually"), 1.38:1 vs required
  4.5:1 — this is the documented pre-existing backlog item, confirmed
  present on 6bf3839 too. Not introduced by this run. **OBSERVATION, not a
  FAIL** (attribution: identical on master).

All other pages/themes: 0 violations. `incomplete` color-contrast findings
(axe can't auto-resolve backgrounds behind gradients / Plotly SVG chart
text / obscured elements) are identical in count and target list between
RUN and base on every page — pre-existing, matches the known backlog
pattern (`/dashboard` axe color-contrast "incomplete", chart-text noise).

h1 count = 1 on every page/theme/build. Landmarks (`main`, `nav`) present
everywhere. One pre-existing gap, identical on RUN and base: `/explorer`
has **0 `<footer>`** elements in the server-rendered HTML itself (confirmed
via raw `curl`, not a client rendering artifact) — present on 6bf3839,
unrelated to this task's two-file JS diff. **OBSERVATION** (point 1
landmark gap, pre-existing, out of scope for this run).

No console errors or page errors on any page/theme, either build.

## 2. /whatif Rate Assumptions flow — RUN vs base

Both builds started from the live data's actual "Spending Phase Based On"
value (`older` / "Older Person").

**Step A — set to "Spouse Age Only" and persist:** on both RUN and base,
setting the phase select to `spouse`, waiting ~900ms (500ms debounce +
margin) for the autosave, then reloading, correctly persisted `spouse` /
"Spouse Age Only". No difference — expected, this path is untouched by the
diff.

**Step B — flip the spouse row's Role select to "Other", wait for the save
response to land (≥2s + response awaited), then flip back to "Spouse",
wait for the save again, then reload:**

Tested via keyboard (focus + Arrow keys) and via a real mouse click
(`click()` to focus + `selectOption()` — see focus note below) on RUN;
via real mouse click on base.

| build | input method | after Role→Other: phase select `.value` | dropdown container class | after Role→Spouse: phase select `.value` / text | persisted after reload |
|---|---|---|---|---|---|
| RUN | keyboard | `older` (coerced, correct/unchanged) | `hidden` | `spouse` / "Spouse Age Only" (**restored**) | `spouse` / "Spouse Age Only" |
| RUN | mouse | `older` | `hidden` | `spouse` / "Spouse Age Only" (**restored**) | `spouse` / "Spouse Age Only" |
| base | mouse | `older` | `hidden` | `older` / "Older Person" (**not restored — the bug**) | `older` / "Older Person" |

RUN matches the fix's contract exactly, on both input methods; base
reproduces the documented pre-fix defect exactly. No error/alert appeared
beyond the expected, identical-on-both-trees
`role="status" aria-live="polite"` message "Plan inputs changed. Previous
spending previews were cleared." (plus two other empty `aria-live="polite"`
status regions already present in the DOM) — same text, same mechanism, on
RUN and base; not a new hidden-text/alert-abuse issue (point 16 n/a here:
the message is genuinely paired with a genuine settings change, and it is
identical pre-existing behaviour).

**Focus after the htmx card re-render (`#whatif-rate-assumptions-card`
outerHTML oob-swap):** Playwright's `selectOption()` alone does *not*
reflect real mouse-click focus behaviour (verified directly: calling it
without a preceding `click()` leaves `document.activeElement` on `<body>`,
a tooling artifact, not a browser/user fact — a plain `page.click()` on the
same `<select>` focuses it exactly like a real user would). Corrected mouse
method: `click()` then `selectOption()`. With that, and with keyboard, on
**both RUN and base**, `document.activeElement` after each card re-render
is the *same-ID* Role `<select>` — confirmed via a dataset-marker probe
that the underlying DOM node truly was destroyed and replaced (outerHTML
swap, no idiomorph/morph in this app) but htmx's own built-in behaviour
(captures `document.activeElement`'s `id` pre-swap,
`document.getElementById(id)` + `.focus()` post-swap — see
`htmx.min.js`'s settle step) re-focuses the new same-ID element. **This is
htmx's built-in mechanism, identical on RUN and base, not touched by the
diff.** Point 10 ("focus restored to a sensible element inside the
swapped region") is met for this control on both trees — **OBSERVATION**
only, pre-existing, matches the backlog note about the whole-card swap race
being "same on base."

**Post-flip axe, RUN, `/whatif`:** light — 0 violations, 1 incomplete
(color-contrast, chart/gradient noise, same set as the sweep above). Dark —
1 violation (the same pre-existing "Adjust spending rules manually"
1.38:1 contrast item, unchanged), 1 incomplete. No new violations from the
post-flip DOM state.

## 3. Name / role / value / focus visibility

- Role select: `<select id="person-role-{id}" data-person-role-selector>`
  with `<label for="person-role-{id}">Role</label>` — proper
  programmatic association (point 4), native select is fully keyboard
  operable (point 9).
- Phase select: `<select id="phase-age-reference-select">` with
  `<label for="phase-age-reference-select">Spending Phase Based On</label>`
  — same, compliant.
- Focus visibility: both selects, focused, in both themes, resolve a
  visible `box-shadow` ring (light: `rgb(79,70,229) 0 0 0 2px`; dark:
  `rgb(165,180,252) 0 0 0 2px`) — `outline: none` is replaced by a visible
  ring (point 9 compliant). This is pre-existing sitewide focus-ring CSS,
  untouched by the diff (previously vetted in run BK per project history).
- Focus-after-swap: covered above — pre-existing htmx behaviour, identical
  on both trees, not a new defect.

## VERDICT: PASS (no blocking findings introduced by this run)

## FAILURES
None. No axe violation, focus-order defect, missing label, missing
landmark, or hidden-text/parity issue was found that is new relative to
6bf3839. The one violation found (`/whatif` dark "Adjust spending rules
manually" contrast) and the one landmark gap found (`/explorer` missing
`<footer>`) are both byte-identical to master and are listed as
observations only, per the attribution rule (`git diff master` shows no
change to the markup/CSS responsible for either).

## OBSERVATIONS (non-blocking, for the lead)
1. Pre-existing (identical on 6bf3839): `/whatif` dark-theme "Adjust
   spending rules manually" `<summary>` contrast 1.38:1 vs 4.5:1 required
   (already on the known backlog list).
2. Pre-existing (identical on 6bf3839, confirmed via raw server HTML, not
   a client-rendering artifact): `/explorer` renders with 0 `<footer>`
   elements — a point-1 landmark gap, out of this run's scope.
3. Pre-existing, identical on RUN and base: the whole-card htmx
   outerHTML-swap after a Rate-Assumptions save relies entirely on htmx's
   own built-in focus-by-id restoration (no app code does this
   explicitly); it happens to work for the Role select on both trees.
   Worth a regression test if the app ever renders that select with a
   *different* id across swaps (currently it doesn't).
4. Pre-existing, identical on RUN and base: a Role flip made while the
   previous save is still in flight is erased by that save's card swap
   (the documented whole-card swap race) — already on the known backlog
   list, not re-flagged here.
5. Testing-tool note for future audits: Playwright's `elementHandle.
   selectOption()` does not leave real DOM focus on the `<select>` the way
   a genuine mouse click does — a "mouse" a11y probe must precede it with
   `click()` or it will falsely report focus loss that a real user would
   never experience.
