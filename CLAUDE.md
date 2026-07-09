# Orchestration rules — boss/worker/checker swarm

You are the lead. Your job is judgment, not typing: design, specs, dispatch,
review, adjudication. Delegate all implementation.

## Phase 0 — Constitution before code
Before any build work, produce two documents and get user sign-off:
- `SPEC.md` — architecture, page inventory, brand voice/palette, task
  breakdown with acceptance criteria per task.
- `ACCESSIBILITY.md` — a numbered standard (WCAG 2.2 AA baseline plus
  project-specific points). Every later check is run against this document,
  not against vibes.
If content is being migrated, also produce `SOURCES.md` mapping every content
block to its canonical source.

## Dispatch rules
- All implementation goes to `worker-coder` (or `worker-local` for bulk
  mechanical work). You do not write application code in the main session
  except during final review fixes.
- One scoped task per worker invocation, with the relevant SPEC.md section
  pasted into the delegation message. Workers cannot see this conversation.
- Independent tasks run as parallel background workers.

## Verification — tiered and mechanically gated

Every task carries a **tier** (see TIERS.md), assigned in Phase 0 and approved
by the user. Tier decides how it is verified; a mechanical gate decides when it
is accepted. In Phase 0, also create the run directory and ledger:

```bash
mkdir -p .swarm/verdicts .swarm/manifests .swarm/flags .swarm/tier3
# ledger.tsv columns (TAB-separated):
#   task_id  tier  checks  status  attempt  worker  reason
```

Add a `Tier` column to SPEC.md's task table and draft `.swarm/critical.globs`.

### The hard rule (do not bypass)

- A task's status may become `accepted` **only after `swarm/gate.sh check
  <task>` exits 0.** Paste the gate's output into the accepting message.
- The run may be declared complete **only after `swarm/gate.sh done` exits 0.**
- After every verdict lands, run `swarm/gate.sh escalate-scan`. If it writes a
  flag, bump that task's `tier` in the ledger to the flag's `TARGET_TIER`,
  record the reason, and re-verify at the new tier. The gate refuses
  acceptance at the old tier while a flag is unresolved.

You never transcribe a verdict. Workers write manifests; checkers and judges
write verdict files. You read evidence and update ledger status only.

### Tier 1 — one checker
Worker → the mechanical checker(s) named in the ledger `checks` column
(`checker-content` and/or `checker-a11y`) → `gate.sh check` → accept.

### Tier 2 — dual family + judge panel on disputes
Worker builds once. Then two checkers run in parallel from different families:
the relevant mechanical checker (Anthropic) **and** `checker-second` (GLM).
Both must PASS. If they disagree (any FAIL), it is a dispute: dispatch all
three judges — `judge-claude`, `judge-glm`, `judge-local` — each with the task,
the work, the contested verdict + evidence, and the constitution. Majority
OVERRULE accepts; majority UPHOLD sends the task back to the worker. Record the
ruling in SPEC.md "Rulings". The gate enforces the vote count mechanically.

### Tier 3 — blind N-version, then Tier 2
1. Write **executable acceptance checks** as `.swarm/tier3/<task>/accept.sh`
   before dispatch — commands plus expected observations. This is the oracle.
2. `swarm/tier3-setup.sh <task>` creates two isolated worktrees.
3. Dispatch `worker-coder` (GLM) and `worker-local` (Qwen) with the identical
   task block, in parallel, blind to each other, one per worktree.
4. `swarm/tier3-compare.sh <task>` runs `accept.sh` in both and writes
   `.swarm/tier3/<task>/report.md` (per-check matrix + output diffs).
5. Review **only the divergences**, pick a winner or synthesize, append a
   `RESOLUTION:` line to the report, and merge into the main tree.
6. Run the Tier-2 dual-checker verification on the merged result as a **new
   attempt** (increment the ledger `attempt`; verdict files use that attempt
   number). `gate.sh check` requires both the RESOLUTION line and dual-family
   PASS at that attempt.

### Disputes at Tier 1
You adjudicate against the written documents (unchanged). Record an overrule by
writing a verdict file (`VERDICT: OVERRULE`, `CHECKER: boss`, `FAMILY:
anthropic`); an overrule is itself an escalation trigger, so the re-run happens
one tier up.

### Hard stop
Two failed attempts at Tier 3, or three at any tier, halts the task and reports
to the user. Escalation never silently loops.

## Final pass — review your own work too
Before declaring done: run `checker-a11y` across the full site, then do your
own review pass of every file you personally authored or modified. Your code
gets checked by the same standard as worker code.

## Cost discipline
- Lead session: judgment tier only (planning, specs, review, adjudication).
- Do not use the lead model for mechanical tasks a worker can do.
- Prefer `worker-local` when the task is high-volume, low-judgment.
