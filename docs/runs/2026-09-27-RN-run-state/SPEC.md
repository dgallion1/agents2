# SPEC.md — Correct the phaseBasisRecords comment (RN run)

Run prefix: **RN**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **e58598c** (master = live
:8080, 2026-09-27, PR #124). Implementation worktree
`.worktrees/rn-comment` on branch `fix/rn-comment`. This run's `.swarm/`
lives in the agents2 worktree `.claude/worktrees/budget2-review-c6867a`
(gitignored), agents2 branch `claude/budget2-rn-comment`. Fresh ledger.

## 0. Status — RN1 ACCEPTED at attempt 1 (gate `OK: RN1 accepted at tier 1 (attempt 1)`; `gate.sh done`: `OK: all tasks accepted, evidence verified, no unresolved flags`; `gate.sh stats`: `first-attempt clean: 1/1 (no-evidence rows: 0)`); commit 93050fc on `fix/rn-comment`, simpleBudget PR #125 MERGED 3f9cbec + DEPLOYED :8080 2026-09-27 (health v1.4.0-1184-g3f9cbec; old binary budget2.old-1322)

## 1. Problem (run RB backlog F2, 2026-09-27)

The comment above `phaseBasisRecords()` in
`web/static/js/whatif-rate-assumptions.js` (lines 13-17 at e58598c) ends
"Made lazily -- this file can be re-executed when its component is
swapped." That is false. User decision (2026-09-27): "fix the code comment
backlog item too".

## 2. Facts (verified at e58598c, lead)

- The script tag is defined in `rate-assumptions.html:591-593` (block
  `whatif-spending-preview-scripts`) and included only by
  `pages/whatif.html:164`, outside the `#whatif-rate-assumptions-card`
  that save responses swap; no handler or partial includes it (grep over
  `web/templates` and `internal`). RB1 attempt 2's checker saw no
  re-execution in the real-page replay.
- The first three sentences of the comment (page-level on purpose; every
  save's response swaps in a fresh card) are true (RB ruling 2026-09-27c).

## 3. Design

Replace only the false sentence with a true one: the script itself loads
once per page (`pages/whatif.html`), outside that card. No code change —
the lazy creation stays (harmless; changing it is not asked for).

## 4. Task table

| Task | Tier | Checks | Owner | Acceptance criteria |
|------|------|--------|-------|---------------------|
| RN1 | 1 | tests | lead (lean exception) | (a) The diff vs e58598c touches only comment lines of `web/static/js/whatif-rate-assumptions.js`: the file's JS token stream (comments stripped) is identical to e58598c's. (b) The new comment makes no claim that the file re-executes on a swap, and every claim it does make is true against the templates (cite the grep). (c) No other file changed. (d) `node --test web/static/js/*.test.cjs` all pass, 0 fail (the RB1 self-checks patch `updatePersonRole`, not this comment — confirm they still find their targets). |

Tier 1: strong mechanical oracle (token identity), reversible, one file.

## 5. Rulings

- **2026-09-27e — RN1 attempt 1, checker-tests PASS (primary checker).**
  Raw diff one hunk (2 comment lines); comment-stripped token streams
  identical to e58598c under acorn (2734) and esprima (2709), with a
  mutant proving the comparison detects code changes; the new sentence
  holds against the templates (`whatif-content` rendered only as a full
  page; scenario handlers `HX-Redirect`; no hx-boost). No catch.
- Final a11y pass: token identity (acorn) proves no runtime change, so the
  RB full-site sweep of e58598c stands as the evidence; no servers started.
- **2026-09-27f — "/explorer footer landmark" is not a defect; dropped
  (mechanism: lead verification against ACCESSIBILITY.md, before any
  dispatch).** The RB and RN a11y sweeps called it a "point-1 landmark
  gap"; point 1 names `<main>`, `<nav>`, `<header>` only, WCAG 2.2 AA
  requires no contentinfo landmark, and the footer is hidden on explorer by
  design (`base.html` "Footer (hidden on explorer page)", viewport-height
  `<main>`; BL/BK/RF already recorded it as deliberate). The foreign
  `.worktrees/version-footer` also edits those footer lines. User: "drop
  it and correct the record". RB README backlog line corrected in place;
  the checkers' sweep reports are left verbatim as evidence.
