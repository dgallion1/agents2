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
  acceptance at the old tier while a flag is unresolved. Mechanics worth
  knowing: the two-consecutive-fails trigger reads the ledger's `attempt`
  column (bump it on every re-dispatch or the trigger stays silent), and the
  next scan clears a flag automatically once the tier is raised — no manual
  deletion.

You never transcribe a verdict. Workers write manifests; checkers and judges
write verdict files. You read evidence and update ledger status only.

### Tier 1 — one checker
Worker → the mechanical checker(s) named in the ledger `checks` column
(`checker-content` and/or `checker-a11y`) → `gate.sh check` → accept.
The `checks` column is load-bearing: a `-` or blank there makes
`gate.sh check` accept the row with zero verdicts. Never leave it empty.

### Tier 2 — two independence lanes + judge panel on disputes
Worker builds once. Then two checkers run in parallel in **different
independence lanes**: the relevant primary verifier (`checker-tests` for code,
`checker-a11y` / `checker-content` for UI and content — lane `anthropic`) **and**
`checker-second` (lane `adversarial`). Both must PASS.

A lane is not a vendor. Every agent now runs on Claude, so the second opinion
cannot come from a different training lineage; it comes from a different **job**
and a different **model tier**. The primary verifier asks "does this meet the
criteria?" and must cite the command proving each one. `checker-second` asks
"what would make this wrong?", defaults to FAIL on ambiguity, and is performing
its role badly if it never disagrees. Treat two PASSes as weaker evidence than
the old cross-vendor pair did — this is a real reduction in independence,
accepted deliberately (user decision 2026-08-19).

If they disagree (any FAIL), it is a dispute: dispatch all three judges —
`judge-claude` (primary lane), `judge-standards` (adversarial lane),
`judge-impact` (user-impact lane) — each with the task, the work, the contested
verdict + evidence, and the constitution. Majority OVERRULE accepts; majority
UPHOLD sends the task back to the worker. Record the ruling in SPEC.md
"Rulings". The gate enforces the vote count and the distinct-lane requirement
mechanically. The arithmetic, precisely: once any FAIL exists at the attempt,
judge votes REPLACE the two-lane PASS requirement; the panel needs ≥3
verdicts, each with a unique judge identity AND a unique lane, and a strict
OVERRULE majority — ties uphold. Valid `FAMILY` values are `anthropic`,
`adversarial`, `impact` (plus `glm`/`local`, accepted only so pre-2026-08-19
verdicts still validate — never write them). Note `checker-a11y` and
`checker-content` both sit in the `anthropic` lane, so pairing them does NOT
satisfy Tier 2's two-lane quorum — every Tier-2 pair includes
`checker-second`.

### Tier 3 — oracle-first, then Tier 2
Blind N-version was dropped (user decision 2026-08-26): across the budget2
runs the two arms' oracle scores were identical every time real divergence
existed, both arms inherited the brief's errors, and every Tier-3 catch came
from the oracle or the Tier-2 pass that followed — not from the comparison.
A defect in the brief itself propagates identically into every arm, so
replication can never audit the lead. What remains is the oracle discipline:
1. Write **executable acceptance checks** as `.swarm/tier3/<task>/accept.sh`
   before dispatch — commands plus expected observations. This is the oracle.
   It must assert on the observable output of **every existing consumer** of
   any data the task touches, and be validated at both ends before dispatch
   (a featureless tree must fail it; the spec's own examples must pass it).
2. Dispatch a single `worker-coder` with the task block.
3. Run `accept.sh` against the result and tee the output to
   `.swarm/tier3/<task>/oracle.<attempt>.log`. The gate requires all four:
   the file exists, it is **executable** (`chmod +x` at authoring time), a
   log exists at THIS attempt number, and the log's final line is exactly
   `ORACLE PASS` — so the script must emit that marker only on the all-pass
   path. Any failure goes back to the worker as a failed attempt.
   ⚠ A `report.md` in the task's tier3 dir flips the gate to the legacy
   blind-arm contract and bypasses the oracle entirely — never reuse a
   pre-2026-08-26 tier3 directory for a new task.
4. Run the Tier-2 dual-checker verification (both lanes, judge panel on
   disputes). `gate.sh check` requires a PASS from each lane at the current
   attempt.

### Disputes in practice (2026-08-29, first panel use)
- The lead may CONCEDE an uncontested FAIL — treating it as an implicit
  UPHOLD and sending the task straight back to the worker — when the lead
  agrees the defect is real and in-scope. Reserve the three-judge panel for
  verdicts the lead would overrule; dispatching judges to rubber-stamp a
  FAIL you believe wastes a cycle.
- **The scope of a reopened attempt governs its acceptance.** When the user
  reopens a hard-stopped task with an explicit scope ("Nothing else"), that
  later, specific ruling controls over any earlier general ruling. Checkers
  report beyond-scope findings as observations for the backlog; they do not
  FAIL on them (ruling 2026-08-29c/d precedent).
- Judges verify the contested verdict's FACTUAL premise first — a FAIL can
  simply be wrong (2026-08-29d: the claimed same-figure contradiction was
  two different figures).

### Recurring defect classes (checkers hunt these; workers avoid them)
Three classes produced most of the last week's real catches:
1. **Split classification** — a threshold applied to a figure must live in
   ONE source consumed by every surface rendering that figure; the checker's
   job is to ENUMERATE the surfaces (templates, JS, charts, tools), not
   trust the diff (ruling 2026-08-29a; W4 found three independent
   classifiers ring by ring).
2. **Rendered-string arithmetic** — "the displayed figures must sum" is a
   claim about the RENDERED strings, not the floats; assert on rendered
   output with a fractional-cent fixture, and derive every displayed figure
   through one rounding path (ruling 2026-08-29b).
3. **Dual formatters** — two formatters for one value (Go `%.0f` half-even
   vs JS `Math.round` half-away vs locale-dependent `toLocaleString`) WILL
   disagree on real inputs; pin one rule and an explicit locale at every
   site (W2 attempts 2–4).
When a checker proves a behavior with a throwaway probe, promote it: a
test-only follow-up task in the same run (V3 pattern) so the evidence
outlives the verdict file.

### Oracle calibration (additions to the both-ends rule)
- Validate every check for the RIGHT failure: at the fail end, confirm the
  failing check is the defect, not a harness error; at the pass end, use a
  throwaway prototype, then discard it.
- Calibrate assertions against MASTER's own rendering first: html/template
  strips HTML comments (don't anchor on them); whitespace-only lines and
  permanently-tinted sibling elements may be master-native — pin counts
  relative to that baseline, or the oracle fails a perfect fix.
- When an escalated attempt adds new oracle checks, the whole extended
  oracle re-validates at both ends before dispatch.

### Concurrent runs in one repo
Two leads may run in one repo only with: distinct ledger prefixes, an
explicit written territory list per run (exact paths), a freeze handshake
before any lane that copies the tree (a `cp -a` of a mid-edit foreign
territory poisons a checker's baseline), and NO git-state changes (HEAD,
branches, stash, index) by the non-committing session. Checkers are told
the foreign territories verbatim so they attribute, not FAIL. The lead
stages ONLY its own manifest paths plus its own `.swarm/` files;
`gate.sh done` over the shared ledger belongs to whichever run finishes
last. (Established with agents2-26, 2026-08-29 — including one HEAD switch
under a live run that this section exists to prevent.)
Two consequences that change what verification may demand:
- A shared tree cannot require a green FULL suite from a checker — the
  other run's uncommitted edits ride along in every copy. Acceptance
  stands on package-scope evidence plus one lead-run integration suite at
  commit time, with foreign territories declared to every checker verbatim
  so they attribute rather than FAIL.
- Task-ID prefixes are a namespace, not a nicety: a collision surfaces at
  merge time as ledger-row moves, manifest/verdict renames, AND `TASK:`
  header surgery inside each verdict, because the gate parses filename and
  header together (the T12→T12F cleanup).

### Disputes at Tier 1
You adjudicate against the written documents (unchanged). Record an overrule by
writing a verdict file (`VERDICT: OVERRULE`, `CHECKER: boss`, `FAMILY:
anthropic`); an overrule is itself an escalation trigger, so the re-run happens
one tier up.

### Hard stop
Two failed attempts at Tier 3, or three at any tier, halts the task and reports
to the user. Escalation never silently loops. The gate does NOT enforce this —
`escalate-scan` writes no flag once a task is already Tier 3, so counting
attempts and halting is the lead's own discipline. And when two attempts fail
to the SAME defect class, treat it as a lead/spec defect: rewrite the
contract before spending the last attempt (T18 precedent — the fix was a
contract change to dormant validation, not a third try at the same design).

## Final pass — review your own work too
Before declaring done: run `checker-a11y` across the full site, then do your
own review pass of every file you personally authored or modified. Your code
gets checked by the same standard as worker code. Also run
`bash smoketest/gate/run_tests.sh` (in this repo) and require ALL PASS —
doc and agent-contract drift is detected only there; the gate never checks
that the constitution still matches the code, and four failures once sat
red across two doc commits because nothing consulted the suite.

## Cost discipline
- Lead session: judgment tier only (planning, specs, review, adjudication).
- Do not use the lead model for mechanical tasks a worker can do.
- Prefer `worker-local` (Haiku) when the task is high-volume, low-judgment.
- All agents run on Claude; there is no gateway and no local endpoint. Model
  choice per agent lives in `.claude/agents/*.md` frontmatter.
