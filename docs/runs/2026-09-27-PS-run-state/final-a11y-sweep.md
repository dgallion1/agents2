# Final accessibility sweep — run PS (phase-select-restore)

Date: 2026-09-27
Scope: `/home/darrell/bin/ai/budget2/.worktrees/phase-select-restore` (branch
`fix/phase-select-restore`, uncommitted, base 888999a = live :8080).
Standard: `/home/darrell/bin/ai/budget2/ACCESSIBILITY.md` (16 numbered
points) + WCAG 2.2 AA. This is the run's final-pass site-wide sweep, not a
per-task checker verdict — no `.verdict` file was written.

## Method

- `cp -a` of the worktree built with `go build ./cmd/server`; real data
  copied read-only (`cp -rL`) into a scratch dir; server run at
  `127.0.0.1:18090` (PS build) with `BUDGET_DATA_DIR`/`BUDGET2_BACKUP_DIR`/
  `BUDGET2_IMPORT_DIR` pointed at the scratch copies. A second server was
  built from `git archive 888999a` and run at `127.0.0.1:18091` (base) on
  its own fresh data copy, for direct A/B comparison.
- `npx @axe-core/cli`-equivalent audit run via a Playwright script that
  injects a real axe-core (`~/.npm/_npx/e003b6b07d062486/node_modules/
  axe-core/axe.min.js`) into the live rendered page (not template source,
  not hand-built HTML) and loads the project's own built stylesheet as
  served by the app. Ran against both themes by seeding
  `localStorage.theme` before navigation (the same mechanism
  `web/templates/layouts/base.html` reads on load).
- Interactive walkthrough scripted with Playwright (real click/keyboard
  events, real htmx round trips against the running server), not a static
  DOM guess.
- Both servers killed at the end; confirmed via `ss -ltnp` that only the
  pre-existing `:8080` remains.

## 1. Site-wide axe sweep (light + dark), PS build vs base build

Pages: dashboard, explorer, insights, major-expenses, whatif, accounts,
transfers, filemanager, duplicates (9 pages x 2 themes = 18 combinations),
tags `wcag2a wcag2aa wcag22aa best-practice`.

| Page | Light | Dark |
|---|---|---|
| dashboard | 0 | 0 |
| explorer | 0 | 0 |
| insights | 0 | 0 |
| major-expenses | 0 | 0 |
| whatif | 0 | **1** (pre-existing) |
| accounts | 0 | 0 |
| transfers | 0 | 0 |
| filemanager | 0 | 0 |
| duplicates | 0 | 0 |

The PS build and the base-888999a build were diffed programmatically over
all 18 page/theme results: **the violation sets are byte-identical between
PS and base at every page/theme combination.** No new violation was
introduced anywhere on the site by this run's change.

The one violation (`/whatif`, dark theme):
```
color-contrast (serious): .mt-5 > summary
"Adjust spending rules manually"
foreground #000000 / background #292524 -> 1.38:1 (needs 4.5:1)
```
This is the documented pre-existing backlog item ("what-if 'Adjust spending
rules manually' summary dark-theme contrast"). Confirmed pre-existing by
`git diff 888999a -- web/templates web/static/css` on the PS worktree
returning **no output** — the PS branch touches zero template/CSS files, so
this markup is byte-identical to master. OBSERVATION only, not a new FAIL.

`dashboard` also produced one axe `color-contrast` **incomplete** (not a
violation) result on both PS and base builds identically — axe could not
resolve it automatically. Dashboard is untouched by this diff. OBSERVATION,
pre-existing, out of scope.

## 2. /whatif Rate Assumptions — the path this run changes

The real data (`data/settings/whatif.json`) has a healthcare-linked spouse
(<spouse>, `healthcare_persons[1].person_id` == the spouse `persons[1].id`),
so the refusal path IS reachable — no fabrication needed.

Walkthrough (scripted, both themes, against the PS build on :18090):

1. Set "Spending Phase Based On" to "Spouse Age Only" (`select#phase-age-
   reference-select` -> `spouse`). Autosaves in ~500ms via
   `hx-trigger="change delay:500ms"` on the enclosing form. Confirmed
   persisted with a full page reload: `phase-age-reference-select`.value ==
   `spouse` after reload, both themes.
2. Click "Remove" on the spouse row (keyboard-activated: focus + Enter, and
   separately mouse-activated: both tested). The server refuses (400,
   "Remove <spouse>'s healthcare entry first" — the healthcare-entry link
   is real, not staged). Observed on the live DOM immediately after the
   failed `htmx:afterRequest`:
   - Error message: exactly one `[role="alert"]` node, text "Error / Remove
     <spouse>'s healthcare entry first", inserted as the **first child of
     the `<form>`** that encloses the person rows (base.js's existing
     `errorHost()`/`insertBefore(node, host.firstChild)` — unchanged by
     this diff; the alert sits above the person rows/phase select rather
     than directly beside the Remove button, which is pre-existing WS4
     behavior, not something this run touched).
   - Re-triggering the identical refusal a second time reuses the **same
     DOM node** (verified by tagging it and checking identity) rather than
     removing/reinserting it — confirms it is announced once, not
     re-announced on a repeated identical failure (pre-existing base.js
     "existing.__wfText === text" guard).
   - The spouse row is back at its original position (`["<primary>",
     "<spouse>"]`, same order as before removal).
   - `document.activeElement` is the row's own "Remove" button
     (`data-remove-person-row`) in every trial.
   - Keyboard-activated focus: the Remove button shows a real visible
     focus ring in **both** themes after being refocused
     (`outline: solid 2px`, indigo-600 on light / indigo-300 on dark, plus
     a white 2px box-shadow ring — the sitewide fallback focus ring from
     run BK). Confirms `:focus-visible` actually matches
     (`el.matches(':focus-visible') === true`) — not just a CSS rule that
     never fires.
   - `phase-age-reference-select` visible value: **"Spouse Age Only"**,
     and `document.getElementById('phase-age-reference-select').value`:
     **`"spouse"`** — matches the expected fixed behavior in both themes.
   - Live axe run on this exact post-refusal DOM: 0 violations in light,
     the same 1 pre-existing dark-mode `<summary>` contrast violation in
     dark (identical to the baseline scan — no new issue introduced by the
     refusal state itself).
3. Changed an unrelated field in the **same** `<form>` as the phase select
   (ticked, then unticked, "Spouse is sole IRA beneficiary" — this form
   submits all its own fields including `phase_age_reference` on every
   `change`), let it autosave, reloaded: saved "Spending Phase Based On"
   is still **"Spouse Age Only"** on the PS build, both themes.
   Also tested changing a field in the *separate* Rate Assumptions form
   (inflation slider, arrow-key nudge) — as expected from
   `internal/handlers/whatif/form_spec.go`'s "absent form key is left
   alone" inclusion rule, that save does not touch `phase_age_reference`
   at all (it isn't in that `<form>`), so this path was never going to
   reproduce or mask the defect either way; reported for completeness.

### Base-888999a comparison (same script, same real data, port :18091)

Repeating the identical sequence against a `git archive 888999a` build
confirms the pre-fix defect is real, not a checker-tests artifact:
   - After the refused removal: `phase-age-reference-select` shows
     **"Older Person"** (`.value === "older"`) even though the persisted
     setting is still `"spouse"` (the refused save never wrote anything).
   - After the same "tick/untick the sole-beneficiary checkbox" unrelated
     same-form save + reload: saved "Spending Phase Based On" is now
     **"Older Person"** — the coerced, wrong value has overwritten the
     user's actual "Spouse Age Only" choice. This is exactly the defect
     the PS diff fixes.
   - The base build's axe results were confirmed byte-identical to the PS
     build's at every page/theme (section 1) — the base build isn't
     accessibility-worse in the automated sweep sense; the defect this run
     fixes is a state-persistence bug that happens to be reachable through
     an accessible, keyboard-operable control, not an axe-detectable a11y
     violation in isolation.

## 3. Judgment against ACCESSIBILITY.md

- Point 4 (label association): `phase-age-reference-select` has its own
  `<label for="phase-age-reference-select">` — unchanged, present, correct
  in the observed DOM both before and after the refusal.
- Point 5 (validation errors announced): the refusal is announced via a
  `role="alert"` node inserted next to (within the same form as) the
  control that triggered it. Satisfied, pre-existing, unchanged by this
  diff.
- Point 7/12 (contrast, dark parity): no new contrast failures; the one
  dark-mode contrast failure found is pre-existing and template/CSS
  byte-identical to master (confirmed by `git diff 888999a`).
- Point 9 (focus visible, keyboard operability): confirmed live — visible
  focus ring on the Remove button after keyboard-triggered refusal, both
  themes; `:focus-visible` genuinely matches.
- Point 10 (focus restored after a swap that removes the focused element;
  destructive actions announce their result): focus is restored to the
  Remove button; the result (refusal) is announced via the alert node.
  Note: the mechanism is `role="alert"` (implicit `aria-live="assertive"`),
  not literally `aria-live="polite"` as point 10's text names — this is
  pre-existing WS4 machinery in `base.js`, completely untouched by the PS
  diff (`git diff 888999a` touches only the two
  `whatif-rate-assumptions.js`/`.test.cjs` files), so it is OUT OF SCOPE
  for this task per the attribution rule, not a new FAIL. Flagged as an
  OBSERVATION for the backlog since point 10's letter and the shipped
  mechanism disagree.
- Point 16 (client-side suppression parity): the row removal/restoration
  is a real DOM `remove()`/`insertBefore()`, not a CSS-hide, so there is no
  visual/AT channel split during the optimistic-then-reverted UI. The
  specific bug this run fixes (the select's DOM value staying coerced to
  "older" after a restore) was a **same-channel** defect — it showed the
  wrong value to sighted and AT users alike, not an AT-only mismatch — so
  it is better characterized as a data-integrity bug than a strict point-16
  violation, though it shares point 16's "one accessible truth" concern.
  Not a FAIL either way (there is nothing in the constitution to fail on a
  same-channel bug the JS diff already fixes); noted for completeness.

## VERDICT (informal, final-pass sweep — no ledger/gate entry)

**PASS.** No new axe violations anywhere on the site, in either theme,
introduced by this run. The interactive walkthrough of the exact code path
this run changes shows the fix working correctly and accessibly in both
themes (visible focus, single non-duplicated alert announcement, correct
label/value pairing). All contrast/focus findings encountered are
pre-existing and confirmed byte-identical to master 888999a.

## OBSERVATIONS (non-blocking, for the lead)

1. Known backlog, reconfirmed unaffected: `/whatif` "Adjust spending rules
   manually" summary dark-theme contrast (1.38:1); `/dashboard` axe
   `color-contrast` **incomplete** result (not a violation) on both PS and
   base builds. (Explorer opacity-50 rows and `/filemanager` nav contrast
   at 1024px from the brief's known-backlog list were not independently
   re-probed this pass since neither page was touched and the full-page
   axe scan at default viewport came back clean on both.)
2. The refusal alert lands at the top of the enclosing `<form>`, not
   immediately adjacent to the Remove button that triggered it — a
   screen-reader user tabbing from the button won't hear it announced from
   that position; it is however read immediately via `role="alert"`
   regardless of DOM position. Pre-existing WS4 design, unchanged by this
   diff, not this run's to fix.
3. Point 10 names `aria-live="polite"` for destructive/state-changing
   action results; the shipped mechanism uses `role="alert"` (implicit
   `aria-live="assertive"`) sitewide. Pre-existing, out of scope for this
   task, flagged for a future doc-vs-code reconciliation pass.
4. This run's diff is JS-logic-only (`web/static/js/whatif-rate-
   assumptions.js` + its `.test.cjs`); no template, CSS, or Go changes —
   confirmed via `git diff 888999a --stat` on the worktree.
