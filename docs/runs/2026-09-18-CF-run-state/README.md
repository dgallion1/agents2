# Run CF — Spending option cards: base setting and starting budget on the card face (2026-09-18)

Target: simpleBudget branch `feat/card-face-budget`, commit fcecd1a over
master 7d0aec0 (worktree `.worktrees/card-face`). One task, Tier 2 with
`tests,a11y,second` (money on screen → second lane), lead-authored under
the lean exception. PR #117 MERGED 0b85199 + DEPLOYED :8080 2026-09-18 (health
v1.4.0-1163-g0b85199; old binary budget2.old-1240). Release built in the
in-repo detached worktree `.worktrees/release-CF` (vcs.modified=false),
then removed; feature branch deleted locally and on origin.

User question: "I don't see how that plan relates to the current plan."
The Current plan card led with "$8,701.30/month median funded living"
while the slider said $7,639; the saved plan adds a $2,000/mo boost to
2030-01 (starting budget $9,639.34) plus phases and guardrails. The only
statement of base and starting budget was inside the collapsed
"Supporting details" expander, and only when they differed. User
decision: "show the base and starting budget on the card face".

Outcome: accepted at attempt 2. `gate.sh stats`:
`first-attempt clean: 0/1 (no-evidence rows: 0)`.

Catches (by mechanism):
- **second checker (attempt 1, FAIL, conceded — ruling 2026-09-18a):**
  the lead's new "same" branch compared `math.Round(v*100)` per field
  while the displayed strings came from `FormatMoney` (`%.2f`); base
  7639.035 / start 7639.04 rendered "$7,639.03 … $7,639.04 (the same at
  the start)". Reproduced against the real function. Dual-rounding class
  (W2) — exactly the surface the `second` lane exists for. Fix: branch on
  the rendered strings; boundary fixtures pinned in the shipped test.
- tests and a11y PASSed both attempts (a11y: 7.63:1 light / 10.18:1 dark
  on the real built CSS, axe 0 violations both themes, heading chain
  h1→h5 traced through the real ancestor templates).

Observations for the backlog (checkers, non-blocking):
- `spendingAppliedAnnouncement` still formats the base with `$%.2f`, a
  second formatter next to `FormatMoney` (pre-existing, untouched).
- The mirror defect (old "differ" sentence over two identical strings)
  existed pre-CF1; now moot since both branches use the rendered strings.
- The current candidate never has a frontier row, so the cross-surface
  same-string property is pinned via a fractional non-headline candidate.

Process notes:
- Lead repeated the checkout trap on its own worktree: `git checkout --
  <template>` after a mutation check, BEFORE the WIP commit, restored
  master and the pre-commit hook refused the commit; the scratchpad
  backup saved it. Rule now: WIP-commit first, mutate second.
- Checkers worked in `cp -a` copies, never ran the binary, no git-state
  change on the real worktree (verified by each: clean status, HEAD
  unchanged). `bash smoketest/gate/run_tests.sh`: ALL PASS.
