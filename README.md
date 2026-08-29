# Boss/worker/checker swarm for Claude Code

Replicates the "expensive boss, cheap workers, mechanical checkers" pattern:
lead session on a frontier Claude model, workers and checkers on cheaper
Claude model tiers, all through the same Anthropic API — no gateway, no
second vendor (user decision 2026-08-19).

## How the routing works

There is no proxy. Claude Code talks to the Anthropic API directly, and a
subagent's `model:` frontmatter value picks a Claude model tier for that
role (e.g. `opus` for judges and heavy checkers, `sonnet` for workers,
`haiku` for cheap checkers and bulk work). Cost control is entirely
per-agent model choice, not per-vendor routing. `worker-local` is not a
local endpoint — the name is legacy from when it was; it is now just the
Haiku-tier worker for high-volume, low-judgment tasks.

## Setup

1. Launch the lead session directly in the target project:
   ```
   cd your-project/   # dir containing .claude/agents/ + CLAUDE.md
   claude
   ```
   No env vars, no proxy, no separate gateway process to bring up. Every
   role — lead, workers, checkers, judges — authenticates the same way your
   `claude` CLI normally does.

2. Kick it off with a "big work" prompt, e.g.:
   > Read CLAUDE.md. Phase 0 first: draft SPEC.md and ACCESSIBILITY.md for
   > <project>, show me both for sign-off, then run the build rounds.

`swarm/start.sh` still exists for anyone whose muscle memory reaches for it;
it now just explains that the gateway is gone and exits.

## Caveats

- The subagent `model:` field expects a Claude alias or model ID (e.g.
  `opus`, `sonnet`, `haiku`) — there is no gateway to resolve an arbitrary
  name, so it must be a real Claude model.
- If your account is under a managed org policy, an `availableModels`
  allowlist can override frontmatter model choices.
- Tier 2's dual-lane requirement is about the **job** (primary verifier vs.
  adversarial `checker-second`) and **model tier**, not a second vendor —
  see "Verification tiers" below and CLAUDE.md.
- Checkers are cheap but not free: keep their checks mechanical (diffs,
  axe-core, explicit constitution points) so a small model can't drift.

## Verification tiers

Rigor is chosen per task, not applied uniformly (see `TIERS.md`):

- **Tier 1** — reversible, oracle-checkable work: worker → one mechanical
  checker. Same cost as the base kit.
- **Tier 2** — shared/weak-oracle work: two independence lanes must both
  PASS — the relevant primary verifier (`checker-tests`/`checker-a11y`/
  `checker-content`, lane `anthropic`) and `checker-second` (lane
  `adversarial`), which defaults to FAIL on ambiguity. All lanes run on
  Claude; the independence is job + model tier, not vendor. Disputes go to a
  3-judge panel (`judge-claude`, `judge-standards`, `judge-impact`).
- **Tier 3** — irreversible / high blast radius (payments, auth, deploys,
  migrations, publishing): oracle-first. The lead writes an executable
  acceptance oracle (`.swarm/tier3/<task>/accept.sh`) before dispatch and
  validates it at both ends (fails on a featureless tree, passes on the
  spec's own examples), a single worker builds against it, `accept.sh` must
  log an `ORACLE PASS`, then the result still goes through the same Tier-2
  dual-lane check.

A pure-bash gate enforces it: a task is accepted only when `swarm/gate.sh check
<task>` exits 0, and the run completes only when `swarm/gate.sh done` does.
`swarm/gate.sh escalate-scan` raises a task's tier on evidence (two consecutive
fails, a checker overrule, or a change to a `critical.globs` path). Every agent
writes its own evidence into `.swarm/`, so the boss cannot fabricate a check.

Run the deterministic gate tests (no API keys, no network calls):

```
bash smoketest/gate/run_tests.sh
```

## Dashboard (mission control)

A zero-dependency Node dashboard (`dashboard/`) reads `.swarm/` and renders a
running swarm as server-rendered HTML with live reload. It is READ-ONLY — it
never writes to `.swarm/`, so it cannot become a second path around the gate
(there is no accept button; status still flows only through verdict files and
`gate.sh`).

Run it:

```
node dashboard/server.mjs [SWARM_DIR]   # defaults to .swarm
# then open http://127.0.0.1:8787  (set PORT to change)
```

It live-reloads over SSE whenever a file under the watched dir changes.

What it shows: the ledger with tier badges; a per-task drawer with the worker
manifest and every verdict rendered verbatim; a dispute panel with both
checker verdicts and the three judge votes plus the mechanical tally; the
Tier-3 oracle log and (for the legacy divergence-report contract) the
RESOLUTION line; and a cost panel.

Anti-lie note: the dashboard computes each task's state from the verdict
evidence, not from the ledger `status` string — so a task that the ledger
calls `accepted` but that lacks a real PASS-quorum (or has an open escalation
flag) renders as a surfaced discrepancy, never as a false `accepted`. It
agrees with `gate.sh check` by construction.

Demo without a live run: `node dashboard/server.mjs dashboard/fixtures/swarm-demo`
serves a fixture exercising every state.

Cost data: the cost panel reads `.swarm/spend.jsonl`; if that file is absent
the panel shows a calm empty state. `dashboard/spend-callback.py` predates
the 2026-08-19 gateway removal and is not currently wired to anything —
populating `.swarm/spend.jsonl` needs a new integration against the direct
Anthropic API; see that file's docstring for the shape it expects.

See `dashboard/README.md` for endpoint details.
