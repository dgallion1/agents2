# Final-pass accessibility sweep — Run RN (comment reword)

Standard: `/home/darrell/bin/ai/budget2/ACCESSIBILITY.md` (numbered points) + WCAG 2.2 AA.

## Scope confirmed

Worktree: `/home/darrell/bin/ai/budget2/.worktrees/rn-comment`, branch
`fix/rn-comment`.

- `rtk proxy git -C <worktree> rev-parse HEAD` → `e58598c145fc...` (exactly
  `e58598c`, the PR #124 / run-RB merge commit — the same commit the RB
  final-a11y-sweep audited as its "RUN" state, confirmed by content match
  below). No other commits on top.
- `rtk proxy git -C <worktree> status --porcelain` → exactly one line:
  `M web/static/js/whatif-rate-assumptions.js`. No untracked files.
- `rtk proxy git -C <worktree> diff e58598c --stat` → the same single file,
  `1 file changed, 2 insertions(+), 2 deletions(-)`.

No template, CSS, or Go file differs from `e58598c` in any way. This is the
entire footprint of run RN.

## Diff content

```
@@ -13,8 +13,8 @@ function hasSpousePerson() {
 // Phase-basis values updatePersonRole coerced away, keyed by person ID.
 // Page-level on purpose: every save's response swaps in a freshly rendered
 // Rate Assumptions card (whatif.html, hx-swap-oob), so anything kept on
-// the rows or the select is gone before the user flips a role back. Made
-// lazily -- this file can be re-executed when its component is swapped.
+// the rows or the select is gone before the user flips a role back. The
+// script itself loads once per page (pages/whatif.html), outside that card.
 function phaseBasisRecords() {
```

Both the old and new hunks are `//` line-comments immediately preceding
`function phaseBasisRecords()`. No code line (line not starting with `//`)
appears in the diff.

## Mechanical proof the change is comment-only (real tokenizer, not eyeballing)

Extracted both file versions:
- `e58598c:web/static/js/whatif-rate-assumptions.js` (via
  `rtk proxy git -C <worktree> show e58598c:...`) → `old.js`
- the worktree's on-disk file → `new.js`

Both are 526 lines; `diff old.js new.js` reproduces exactly the two-line
comment hunk above and nothing else.

Tokenized both with **acorn 8.16.0** (a real, independently-installed
JS parser found under
`/home/darrell/work/webSites/elpasto-public/node_modules/acorn`, not
hand-rolled), using `acorn.tokenizer(src, {ecmaVersion: 2022, sourceType:
'script'})` — acorn's token stream omits comments by construction (they are
only visible via an explicit `onComment` callback, which was not supplied):

```
old.tokens: 2734 tokens
new.tokens: 2734 tokens
diff old.tokens new.tokens  →  (empty) → TOKEN STREAMS IDENTICAL
```

Every token (type + value) in the two files is identical, in the same
order, same count. This mechanically proves the two files parse to the
same program: the reworded comment has zero effect on parsed code, and
therefore zero effect on runtime behaviour, DOM output, computed styles,
ARIA attributes, focus behaviour, or anything axe-core (or a human) can
observe in the served page.

## Conclusion — no new sweep needed, no server started

Per the task instructions: the proof holds (single file differs from
`e58598c`; that file's non-comment tokens are provably identical to
`e58598c`'s; no template/CSS/Go file differs at all). Because RN's served
behaviour is byte-for-byte identical to `e58598c`'s served behaviour, the
prior full-site sweep of `e58598c` — run for **RB**
(`/home/darrell/work/agents2/docs/runs/2026-09-27-RB-run-state/final-a11y-sweep.md`)
— stands as complete, valid full-site accessibility evidence for run RN.
That report already covers:

- 9 pages × 2 themes (light + dark) × axe-core 4.13.0, real Playwright
  render of the live served HTML/CSS/JS (not template source, not
  hand-built HTML) — 0 new violations; the one violation found (`/whatif`
  dark-theme "Adjust spending rules manually" `<summary>` contrast,
  1.38:1) is pre-existing (identical on the pre-fix base commit).
- h1 count = 1 on every page/theme; landmarks (`main`, `nav`) present
  everywhere except the pre-existing `/explorer` missing-`<footer>` gap
  (identical on base, out of scope).
- The `/whatif` Rate Assumptions role-flip walkthrough that exercises
  `phaseBasisRecords()` itself (the exact function whose leading comment
  RN reworded) — keyboard and mouse, both builds, confirms the phase-basis
  restore behaviour, focus-after-htmx-swap, and the `aria-live="polite"`
  status message are correct and identical across builds.
- No console/page errors.

No new server was started for this final pass (none was needed or
permitted once the comment-only proof held). `ss -ltnp` was not re-run
since no build/listen step occurred in this session; `:8080` (live) was
never touched, and `/home/darrell/bin/ai/budget2/data` was never written
to (only read via `git show`, which touches no data files).

## VERDICT (informal, final-pass only — not a task .verdict file)

**PASS.** No accessibility regression is possible from a change that is
provably comment-only at the token level. All findings in scope are
identical to the RB sweep's already-accepted results.

## OBSERVATIONS (non-blocking, for the lead)

1. Carried forward from RB, still pre-existing and out of RN's scope:
   `/whatif` dark-theme "Adjust spending rules manually" `<summary>`
   color-contrast 1.38:1 vs 4.5:1 required (known backlog item).
2. Carried forward from RB, still pre-existing and out of RN's scope:
   `/explorer` renders with 0 `<footer>` elements server-side (point 1
   landmark gap).
3. Process note: this is the second consecutive run (RB, now RN) whose
   entire footprint is a JS comment/doc-string change with no runtime
   effect. If this pattern continues, a lighter-weight final pass
   (git diff + tokenizer proof only, skip the "read prior sweep" step)
   could be pre-authorized for comment-only diffs — flagging for the lead
   to decide, not asserting it here.
