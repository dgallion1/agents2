# SPEC.md — Refused person removal keeps the spending-phase basis (PS run)

Run prefix: **PS**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **888999a** (master = live
:8080, 2026-09-24, PR #122). Implementation worktree
`.worktrees/phase-select-restore` on branch `fix/phase-select-restore`.
This run's `.swarm/` lives in the agents2 worktree
`.claude/worktrees/budget2-review-c6867a` (gitignored). Fresh ledger.

## 0. Status — PS1 ACCEPTED at attempt 1 (gate `OK: PS1 accepted at tier 2 (attempt 1)`; `gate.sh done`: `OK: all tasks accepted, evidence verified, no unresolved flags`; `gate.sh stats`: `first-attempt clean: 1/1 (no-evidence rows: 0)`); commit 2907838 on `fix/phase-select-restore`, simpleBudget PR #123 MERGED 6bf3839 + DEPLOYED :8080 2026-09-27 (health v1.4.0-1180-g6bf3839; old binary budget2.old-1013)

## 1. Problem (external review, 2026-09-27)

Review of 2026-09-20..27 (five commits, 48 files), finding P2 at
`web/static/js/whatif-rate-assumptions.js:54-59`: with "Spouse Age Only"
selected, removing a spouse still linked by a healthcare entry is refused
and the row is restored — but "Older Person" stays selected, and the next
unrelated Rate Assumptions save persists that change. User decision
(2026-09-27): fix it as a one-task Tier-2 run, `checker-tests`, lead-direct.

## 2. Facts (verified at 888999a, lead, 2026-09-27)

- `removePersonRow` (`whatif-rate-assumptions.js:29-72`) removes the row,
  then calls `togglePhaseReferenceDropdown()` (line 38), which — with no
  spouse row left — hides `#phase-age-reference-container` and sets
  `#phase-age-reference-select` from `spouse` to `older` (lines 190-203).
- On a refused save (`htmx:afterRequest`, `successful: false`) lines 54-59
  re-insert the row and call `togglePhaseReferenceDropdown()` again; the
  container is shown, but nothing restores the select's value.
- The select is inside the same form (`rate-assumptions.html:91-100`,
  `name="phase_age_reference"`; form `hx-post="/whatif/settings"`,
  `hx-target="#whatif-results"`), so the form is never re-rendered by the
  refusal and the next change-triggered save sends `older`.
- The refusal itself writes nothing: `handleWhatIfSettings`
  (`internal/handlers/whatif/handlers_rates.go:36-58`) returns 400 from
  `personRemovalBlockedByHealthcare` before any update is applied.
- Server-side, `NormalizePhaseAgeReference` (`prepare/normalize.go:47`)
  already coerces `spouse` → `older` when no spouse exists, so the
  in-flight removal request sending `older` is consistent with the
  spouse-less plan it proposes; only the refusal path is wrong.
- Reproduced by the lead with a throwaway probe on the existing
  `whatif-rate-assumptions.test.cjs` harness (scratch copy): current code
  `after-restore=older` (assert `'older' !== 'spouse'`); with the fix
  below the probe and all 18 existing tests pass (19/19).
- Out of scope (observation only): changing a person's role Spouse →
  Other also coerces the select to `older` and switching back does not
  restore it — a visible, user-initiated change, not a refused one.
- Foreign in-flight work: `.worktrees/version-footer`
  (`feat/version-footer`, uncommitted: Makefile, cmd/server/main_test.go,
  internal/templates/render.go + test, internal/version/*,
  web/templates/layouts/base.html). No overlap with this run's paths.
- There is no make target for the node tests (WS backlog F3: `make check`
  skips them); run them with `node --test web/static/js/*.test.cjs`.

## 3. Design

In `removePersonRow`, capture `#phase-age-reference-select`'s value before
`row.remove()`; in the refusal branch, after the row is re-inserted and
BEFORE `togglePhaseReferenceDropdown()`, set the select back to the
captured value. A missing select (fixtures, other pages) is a no-op. The
successful path is unchanged (stays `older` when no spouse remains). No
markup, template, Go or CSS change.

## 4. Task table

| Task | Tier | Checks | Owner | Acceptance criteria |
|------|------|--------|-------|---------------------|
| PS1 | 2 | tests | lead (lean exception) | (a) A new test in `web/static/js/whatif-rate-assumptions.test.cjs` builds the person-rows fixture plus `#phase-age-reference-container` holding `#phase-age-reference-select` (value `spouse`) inside the same form; after `removePersonRow` on the spouse row the select reads `older` and the container is hidden (removal-time behavior unchanged); after a refused `htmx:afterRequest` the select reads `spouse`, the container is not hidden, the row is restored in place and the Remove button refocused. (b) A test pins that a SUCCESSFUL removal leaves the select at `older` (not restored). (c) A patch-based self-check in the file's existing style proves the new refusal test FAILS against the 888999a refusal branch (no value restore). (d) `node --test web/static/js/*.test.cjs` all pass, 0 fail; `node web/static/js/whatif-rate-assumptions.test.cjs` reports the new tests passing. (e) `go build ./... && go vet ./...` clean and `go test ./internal/handlers/whatif/ ./internal/templates/` green (no Go change expected; proves nothing else moved). (f) Diff vs 888999a confined to `removePersonRow` in `web/static/js/whatif-rate-assumptions.js` and new tests in its `.test.cjs`; no other file. |

Not a defect-history surface (no formatting, rounding, thresholds across
surfaces, or displayed money) → `second` not named.

## 5. Rulings

- **2026-09-27a — the defect itself (mechanism: external review, confirmed
  by lead probe).** Caught before this run by the external review; the
  lead reproduced it on the existing harness before any fix. No catch
  inside the run: PS1 attempt 1 PASSed checker-tests on (a)–(f).
- **2026-09-27b — m2 survivor is equivalent (primary checker, observation).**
  Moving the restore after `togglePhaseReferenceDropdown()` survives all
  tests; it differs only when the page starts with `spouse` selected and no
  spouse row, which the server's normalization and the load-time toggle
  make unreachable. Not pinned.
- Observations (primary checker, backlog, not fixed): a person added and a
  new phase picked inside the ~500 ms + round-trip window of a refused
  removal would be overwritten by the restore; the fake-DOM harness has no
  real `<select>` option validation or real htmx (4xx no-swap verified by
  reading base.js, not by running htmx).
