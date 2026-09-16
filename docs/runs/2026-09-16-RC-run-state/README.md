# Run RC — month rollover keeps scheduled cash flows; Apply keeps the comparison minimum (2026-09-16)

Target: simpleBudget branch `fix/rollover-schedule` in the in-repo worktree
`.worktrees/rollover-schedule` (base bcb6226; master moved to d1aca01
during the run, merge preview clean). Source: the user's review of the
09-09..16 changes (P1 rollover drift, P2 lost comparison minimum). Design
signed off as Option A (month-precise schedules).

Outcome:
- RC1 (P2, Tier 2, lead): ACCEPTED attempt 1, ec42346.
- RC2 (P1 core, Tier 3, worker): ACCEPTED attempt 2, f479de3 + ee7af8a.
- RC3 (P1 UI, Tier 3, worker): attempts 1 and 2 failed (1f9a35a,
  a57394c) — the constitution's Tier-3 hard stop; the user authorized
  attempt 3 under a rewritten contract (one model-level schedule-status
  source read by every surface), ACCEPTED at 5d4c10f with all three lanes.

`gate.sh stats`: `first-attempt clean: 1/3 (no-evidence rows: 0)`.
`gate.sh done`: `OK: all tasks accepted, evidence verified, no unresolved
flags`.

Catches by mechanism (SPEC.md §4 has the full rulings):
- worker pre-implementation read: a (brief template expression), d (oracle
  banned an out-of-scope card / assumed nonexistent edit forms), g (oracle
  clause banned the required Remove URL) — all lead artifacts.
- checker-second: b (missed second template caller → every mutation
  truncated), e (rollover-clamped ended row unsaveable), h (Budget Fit
  note invents a month for the ended entry). i = user decision to reopen.
- checker-tests: b (independently), c (observation, later refuted by the
  worker with evidence).
- checker-a11y: f (add-form errors not announced / not associated).
- oracle: none on its own; it was extended three times after checker
  catches (template lane, post-clamp fixture).

Lesson that drove the halt: a value the rollover CLAMPS is a distinct UI
state; its rule must live in the model and be asserted on EVERY surface
that renders the entry (list rows, Budget Fit notes, timeline events,
funding markers), not fixed surface by surface.
