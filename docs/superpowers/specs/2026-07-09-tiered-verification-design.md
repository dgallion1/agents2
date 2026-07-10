# Tiered Verification for the Boss/Worker/Checker Swarm — Design

**Date:** 2026-07-09
**Status:** Approved
**Base:** the boss/worker/checker swarm kit (LiteLLM gateway; lead on Claude
Fable 5 / Opus 4.8; workers on GLM 5.2 and local Qwen via vLLM; checkers on
Haiku), installed into `/home/darrell/work/agents2`.

## Problem

The base kit verifies every task with a single mechanical checker and routes
disputes to the boss. That leaves three known weaknesses:

1. **Correlated blind spots** — checkers and boss share model-family priors;
   a wrong boss is also the final court of appeal ("boss is the ceiling").
2. **Uniform rigor** — a news post and a payment path get the same level of
   verification, so rigor is either wasted or missing.
3. **Prompt-only enforcement** — nothing mechanical stops the boss from
   skipping a verification step across a long run.

## Goal

Verification rigor is selected per task from three tiers, escalates upward on
evidence, can be overridden by the user, and is **mechanically enforced** by
an acceptance gate the boss cannot bypass.

| Tier | When | Protocol | Marginal cost |
|------|------|----------|---------------|
| 1 | Default: reversible, oracle-checkable | Worker → one mechanical checker | none (base kit) |
| 2 | Medium blast radius, weak oracle, or escalated | Worker → **dual checkers, different model families**, both must PASS; disputes go to a 3-judge panel | +1 cheap checker call |
| 3 | Irreversible / high blast radius (payments, auth, deploys, migrations, external publishing) | **N-version**: 2 workers, different families, blind, isolated worktrees → behavioral divergence report → boss reviews divergences only → merged result still gets Tier 2 checks | ~2× execution + setup |

## Decisions made during brainstorming

- **Tier control:** boss proposes a tier per task in SPEC.md using the TIERS.md
  rubric; the user approves/overrides at the existing Phase 0 sign-off gate.
  Mid-run changes are escalations only (up, never down).
- **Escalation triggers (mechanical, detected by the gate):**
  1. Two consecutive FAILs on the same task.
  2. A recorded boss overrule of a checker (the re-run happens one tier up).
  3. Any touched file matching the user-approved `critical.globs` list.
  (Sampled audits of passes: considered, excluded from scope.)
- **Tier 2 content:** dual independent checkers on different model families
  (both must pass) + 3-judge majority vote replacing solo boss adjudication
  on disputes. (Boss pre-review of task specs: excluded from scope.)
- **Tier 3 resolution:** behavioral diff via boss-authored executable
  acceptance checks; boss adjudicates only where the two versions diverge.
- **Architecture:** Approach C — prompt-driven dispatch, **mechanical
  acceptance gate** (`gate.sh`) over an evidence ledger. Rejected: pure
  prompt-level rules (compliance is probabilistic — the exact failure mode
  this system exists to prevent) and fully scripted orchestration (scripts
  cannot dispatch subagents, so full determinism is unreachable; the gate
  buys the enforceable part cheaply).
- **Deliverable:** the extended kit in `agents2` + a `smoketest/` validation
  project including seeded faults.

## Architecture

### Layout

```
agents2/                          # the reusable kit (git repo)
├── README.md                     # kit docs + tier documentation
├── CLAUDE.md                     # orchestration rules, extended with tier rules
├── TIERS.md                      # risk rubric + per-tier protocol definitions
├── litellm-config.yaml           # + checker-glm alias (GLM as 2nd checker family)
├── docker-compose.yaml           # unchanged
├── .claude/agents/
│   ├── worker-coder.md           # base + writes file manifest to .swarm/
│   ├── worker-local.md           # base + same
│   ├── checker-content.md        # base + writes verdict file to .swarm/
│   ├── checker-a11y.md           # base + writes verdict file to .swarm/
│   ├── checker-second.md         # NEW: spec-compliance checker on GLM
│   ├── judge-claude.md           # NEW: dispute judge, Haiku, correctness lens
│   ├── judge-glm.md              # NEW: dispute judge, GLM, standards lens
│   └── judge-local.md            # NEW: dispute judge, local Qwen, user-impact lens
├── swarm/
│   ├── gate.sh                   # mechanical acceptance gate (enforcement core)
│   ├── tier3-setup.sh            # creates 2 isolated git worktrees for a task
│   └── tier3-compare.sh          # runs acceptance checks in both, emits report
└── smoketest/                    # validation project (see Validation)
```

Per-project run state, created by the boss in Phase 0, gitignored:

```
.swarm/
├── ledger.tsv                    # task_id  tier  checks  status  attempt  worker  reason
│                                 #   checks: comma list of required checkers
│                                 #   (content,a11y) set by the boss at dispatch
├── critical.globs                # user-approved critical-path patterns, 1/line
├── manifests/<task>.<attempt>.files            # written by WORKERS
├── verdicts/<task>.<attempt>.<checker>.verdict # written by CHECKERS/JUDGES
├── flags/<task>.flag             # escalation flags written by gate.sh
└── tier3/<task>/report.md        # divergence reports from tier3-compare.sh
```

### Evidence principle

**Every agent writes its own evidence.** Workers write their file manifests;
checkers and judges write their verdict files directly (via Bash — they remain
forbidden from editing project files). The boss never transcribes evidence; it
reads evidence and updates ledger status. A forgetful or rationalizing boss
therefore cannot fabricate a verification that did not happen.

Verdict file format (parseable header + free evidence):

```
VERDICT: PASS | FAIL | UPHOLD | OVERRULE
CHECKER: <agent name>
FAMILY: anthropic | glm | local
TASK: <task-id> ATTEMPT: <n>
---
<evidence: diffs, axe output, reasoning>
```

### gate.sh — the enforcement core

~100–150 lines of bash, three subcommands, no LLM calls:

- **`gate.sh check <task-id>`** — may this task be accepted?
  - Tier 1: every checker named in the ledger's `checks` column has a PASS
    verdict file for the current attempt.
  - Tier 2: PASS verdicts from **two different `FAMILY` values**; if a dispute
    was recorded, three judge verdicts exist with a majority resolution.
  - Tier 3: divergence report exists and contains a `RESOLUTION:` line
    (appended by the boss when adjudicating divergences), and the merged
    result has Tier 2 dual-family PASS verdicts.
  - Any unresolved flag in `.swarm/flags/` for the task → fail regardless.
- **`gate.sh escalate-scan`** — reads ledger, verdicts, and manifests; writes
  `.swarm/flags/<task>.flag` for each trigger listed above. A flag means "tier
  is now min(current+1, 3); re-verify at that tier."
- **`gate.sh done`** — run-level: all ledger tasks `accepted`, zero unresolved
  flags → exit 0; otherwise list exactly what is missing.
- Every invocation validates ledger format first, so corruption is caught at
  the next check, not at the end of the run.

CLAUDE.md hard rule: *a task's status may only become `accepted` after
`gate.sh check <task>` exits 0, and the run may only be declared complete
after `gate.sh done` exits 0; paste the gate output into the accepting
message.* One mechanical checkpoint instead of a dozen distributed rules.

### Tier protocols

**Tier 1** — unchanged from the base kit: worker → single mechanical checker
(content and/or a11y per task type) → gate → accept.

**Tier 2** — worker builds once; then two checkers run in parallel from
different families: the relevant mechanical checker (Haiku) plus
`checker-second` (GLM), which verifies the work against the task's acceptance
criteria and the constitution. Both must PASS.

**Tier 3** —
1. Boss writes **executable acceptance checks into the task block** before
   dispatch: commands plus expected observations. This is the oracle.
2. `tier3-setup.sh <task>` creates two git worktrees.
3. `worker-coder` (GLM) and `worker-local` (Qwen) receive the identical task
   block in parallel, blind to each other, one per worktree.
4. `tier3-compare.sh <task>` runs the acceptance checks in both worktrees and
   emits `.swarm/tier3/<task>/report.md`: per-check pass/fail matrix plus
   output diffs where the versions disagree.
5. Boss reviews **only the divergences**, picks a winner or synthesizes,
   appends a `RESOLUTION:` line to the report, merges into the main tree.
6. The merged result gets Tier 2 dual-checker verification on top — N-version
   guards against logic blind spots; checkers guard against constitution
   violations both versions might share.

### TIERS.md rubric

Three questions per task: *Is there an executable oracle? Is a bad merge
trivially reversible before harm? What is the blast radius?* A mapping table
assigns the tier; the tie-break rule is **round up**. In Phase 0 the boss adds
a `Tier` column with a one-line justification to SPEC.md's task table and
drafts `critical.globs`; both are covered by the existing user sign-off.

### Escalation and disputes

- After every verdict lands, the boss runs `gate.sh escalate-scan`. A flag
  bumps the task one tier (ceiling: 3), the reason goes in the ledger, and the
  task re-runs under the new protocol. The gate refuses acceptance at the old
  tier while the flag stands.
- **Disputes at Tier 1:** boss adjudicates against the written documents
  (unchanged) — but an overrule is itself an escalation trigger.
- **Disputes at Tier 2+:** three judges replace the boss. Each receives the
  task block, work product, contested verdict + evidence, and relevant
  constitution sections, with a distinct lens (correctness / standards /
  user-impact) on a distinct model family. Each writes UPHOLD or OVERRULE
  with reasoning. Majority rules; boss records the ruling in SPEC.md
  "Rulings" and acts on it.
- **Hard stop:** two failed attempts at Tier 3, or three at any tier, halts
  the task and reports to the user. Escalation never silently loops.

### Error handling

- **Missing evidence is failure:** a crashed or forgetful checker means no
  verdict file, so the gate cannot pass — safe default; boss re-dispatches.
- **Worker BLOCKED:** unchanged (boss answers or fixes the spec);
  BLOCKED-disputing-a-verdict routes to the dispute path.
- **Endpoint failures:** LiteLLM retries as configured. The GLM family runs
  through OpenRouter by default; `worker-zai` is the documented manual
  fallback straight to Z.ai. Gateway down = nothing runs (loud).

## Validation (`smoketest/`)

Three layers, cheapest first:

1. **Gate unit tests** — deterministic, no LLM calls. Fixture `.swarm/`
   directories assert: Tier 2 with one verdict fails; two consecutive FAILs
   produce a flag; a manifest matching `critical.globs` produces a flag; a
   resolved 2-of-3 judge vote passes; malformed ledger is rejected.
2. **Checker evals** — planted artifacts reproducing the known failure modes:
   a paraphrased quote, hidden text (`opacity:0`), a button invisible in dark
   mode, plus clean counterparts. Checkers must FAIL every planted fault and
   PASS every clean version.
3. **Live end-to-end run** — a toy 3-page site with tasks spanning tiers:
   content migration (Tier 1), shared nav (Tier 2), pre-order button + deploy
   config on a critical glob (Tier 3). One Tier 1 task deliberately touches
   the critical glob to prove glob-escalation fires. Confirms dispatch,
   parallel checkers, worktrees, divergence report, and `gate.sh done`
   against real models through the gateway.

## Out of scope

- Sampled audits of passed work (false-pass-rate measurement).
- Boss pre-review of task blocks before dispatch.
- Tier de-escalation.
- Any change to the base kit's LiteLLM gateway topology or billing model.

## Cost expectations

Tier 1 is cost-identical to the base kit. Tier 2 adds one cheap checker call
per task. Tier 3 roughly doubles execution per task plus worktree setup —
which is why the rubric defaults down and escalates only on evidence or
explicit user override.
