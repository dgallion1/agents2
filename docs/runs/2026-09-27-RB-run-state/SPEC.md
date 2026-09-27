# SPEC.md — Flipping a person's role back to Spouse restores the spending-phase basis (RB run)

Run prefix: **RB**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **6bf3839** (master = live
:8080, 2026-09-27, PR #123). Implementation worktree `.worktrees/role-basis`
on branch `fix/role-change-phase-basis`. This run's `.swarm/` lives in the
agents2 worktree `.claude/worktrees/budget2-review-c6867a` (gitignored),
agents2 branch `claude/budget2-role-basis`. Fresh ledger.

## 0. Status — RB1 ACCEPTED at attempt 2 (gate `OK: RB1 accepted at tier 2 (attempt 2)`; `gate.sh done`: `OK: all tasks accepted, evidence verified, no unresolved flags`; `gate.sh stats`: `first-attempt clean: 0/1 (no-evidence rows: 0)`); commit 275d0d8 on `fix/role-change-phase-basis`, simpleBudget PR #124 MERGED e58598c + DEPLOYED :8080 2026-09-27 (health v1.4.0-1182-ge58598c; old binary budget2.old-1143)

## 1. Problem (run PS backlog, 2026-09-27)

With "Spending Phase Based On" = "Spouse Age Only", changing the spouse's
Role select to "Other" switches the phase basis to "Older Person"; changing
the same person back to "Spouse" leaves "Older Person", and that save
persists it. A flip-and-flip-back should leave the saved plan as it was.
User decision (2026-09-27): "fix the role change backlog item too".

## 2. Facts (verified at 6bf3839, lead)

- `updatePersonRole(select)` (`web/static/js/whatif-rate-assumptions.js:13-20`)
  copies the Role select's value into the row's hidden
  `person_role[]` input, then calls `togglePhaseReferenceDropdown()`, which,
  with no spouse row left, hides `#phase-age-reference-container` and sets
  `#phase-age-reference-select` from `spouse` to `older`.
- The Role `<select>` (server-rendered rows: `rate-assumptions.html:57-62`;
  JS-added rows: `addPersonRow`) has `onchange="updatePersonRole(this)"`
  and no `name`; its change event bubbles to the form, whose
  `hx-trigger="change delay:500ms, …"` saves the whole form (hidden role +
  phase select) — so each flip is saved.
- Server: `NormalizePhaseAgeReference` coerces `spouse` → `older` whenever
  no spouse exists, so the Spouse → Other save carrying `older` is correct.
  Only the flip back is wrong: nothing remembers the user's choice.
- A Role change keeps the person's ID, so `personRemovalBlockedByHealthcare`
  never refuses it.
- The script tag is DEFINED in `rate-assumptions.html:591-593` (block
  `whatif-spending-preview-scripts`) but included only by
  `pages/whatif.html:164`, outside the swapped card, so it runs once per
  page load (corrected after attempt 2 — checker F2; attempt 1's "may be
  re-executed on a swap" premise was wrong, and harmless).
- **Every successful save replaces the whole card** (corrected after
  attempt 1): `handleWhatIfSettings` → `renderRecalc`
  (`handlers.go:195`) renders `whatif-results-with-oob`, which carries
  `<div id="whatif-rate-assumptions-card" hx-swap-oob="true">`
  (`whatif.html:286`). Rows, the phase select and anything stored on them
  are new elements after each save; only page-level state (`window`,
  `document`) survives.
- Fake-DOM test harness (`whatif-rate-assumptions.test.cjs`, `rpEl`) has
  get/set/removeAttribute but no `dataset`.
- Foreign in-flight work: `.worktrees/version-footer` (feat/version-footer,
  uncommitted footer/version files). No overlap.

## 3. Design (attempt 2 — contract rewritten after ruling 2026-09-27c)

In `updatePersonRole`, capture the phase select's value before
`togglePhaseReferenceDropdown()`, and read the row's person ID
(`input[name="person_id[]"]`). Records live in a page-level map
`window.whatifPhaseBasisBeforeRoleChange`, keyed by person ID, created
lazily inside a function (no top-level declaration), so they survive the
save response's out-of-band swap of the card.
- New role NOT spouse and the toggle changed the phase select → record
  `{before, coerced}` for that person ID.
- New role IS spouse and a record exists for that person ID → restore
  `before` only if the (possibly re-rendered) phase select still shows
  `coerced`; delete the record either way.
- No record when nothing was coerced, or when the row has no saved person
  ID yet (a brand-new unsaved row).
- Records are per page load (lost on reload — the saved plan is then the
  truth). Not in scope: a brand-new person added after a spouse was
  removed does NOT bring "Spouse Age Only" back. PS1's `removePersonRow`
  unchanged.
- Known limit (lead self-review): if another spouse appeared meanwhile and
  the user deliberately chose the coerced value itself ("Older Person"),
  the flip back still restores — indistinguishable from the coercion.
No markup, template, Go or CSS change.

## 4. Task table

| Task | Tier | Checks | Owner | Acceptance criteria |
|------|------|--------|-------|---------------------|
| RB1 | 2 | tests | lead (lean exception) | (a) New tests in `web/static/js/whatif-rate-assumptions.test.cjs` on a card fixture (form with a primary row and a spouse row, each with `person_id[]`, hidden `person_role[]`; the spouse row with a Role select; `#phase-age-reference-container` holding `#phase-age-reference-select` = `spouse`): Spouse → Other gives `older` + container hidden (unchanged); flipping back on the SAME elements gives `spouse` + container shown. (a2) **Swap path:** Spouse → Other, then the card is replaced by a freshly rendered one (same person IDs, that person's role `other`, phase select `older`, container hidden, no carried state); flipping the NEW row back to Spouse sets the NEW phase select to `spouse` and shows the container. (b) Guard: after Spouse → Other, a second spouse row appears and the phase select is `younger`; flipping the first person back leaves `younger`. (c) No record without coercion (basis `primary`) and none for a row with an empty person ID. (d) The record is consumed by the flip back. (e) Patch-based self-checks prove (a2) FAILS against the 6bf3839 `updatePersonRole` AND against the attempt-1 row-attribute version. (f) `node --test web/static/js/*.test.cjs` all pass, 0 fail; `go build ./... && go vet ./...` clean; `go test ./internal/handlers/whatif/ ./internal/templates/` green. (g) Diff vs 6bf3839 confined to `updatePersonRole` (+ its comment and one small helper for the page-level map) in `whatif-rate-assumptions.js` and new tests in its `.test.cjs`; no other file; `removePersonRow` byte-identical to 6bf3839. (h) Real-page replay (checker's jsdom + vendored htmx harness from attempt 1): flip back at 100 ms, 450 ms, 700 ms and 1500 ms each ends with a save carrying `phase_age_reference=spouse`. |

Not a defect-history surface → `second` not named.

## 5. Rulings

- **2026-09-27c — RB1 attempt 1, checker-tests FAIL, CONCEDED (mechanism:
  primary checker).** (a)–(g) all met, but the SPEC's own problem statement
  was not: every save OOB-swaps `#whatif-rate-assumptions-card`, so the
  row-attribute record was gone before any flip back slower than the
  500 ms debounce. Checker proved it with the vendored htmx 2.0.10 + real
  Go-rendered responses in jsdom (branch: flip back at 100/450 ms → `spouse`;
  700/1500 ms → `older`; base → `older` always); lead confirmed the OOB
  block in `whatif.html:286`. Lead/spec defect (design premise; the facts
  even said "each flip is saved"). Contract rewritten for attempt 2: record
  keyed by person ID in page-level state, plus a swap-path test (a2) and
  the real-page replay (h). Checker observation (not pursued): a save
  posting role `other` with basis `spouse` renders `spouse` in the response
  despite save-time normalisation; the client never sends that pair.
- **2026-09-27d — RB1 attempt 2, checker-tests PASS (primary checker).**
  (a)–(h) met; m1–m8 all killed; real-page replay (vendored htmx 2.0.10,
  Go-rendered responses) ends `spouse` at 100/450/700/1500 ms (700/1500
  after a card swap with new row elements), base 6bf3839 `older` at all
  four; the page-level map is the same object across the swap. Backlog
  (checker, beyond scope): **F1** a flip back made while the first save is
  still in flight is erased by that save's card swap — the role change
  itself is lost, identically on base (whole-card swap race); a second
  flip then saves `older` on both. **F2** the spec's re-execution premise
  was wrong (fact corrected above); the new code comment repeats it
  ("this file can be re-executed when its component is swapped") —
  harmless, left as backlog rather than spend attempt 3 (the hard-stop
  attempt) on a comment.
