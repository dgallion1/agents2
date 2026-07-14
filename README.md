# Boss/worker/checker swarm for Claude Code

Replicates the "expensive boss, cheap workers, mechanical checkers" pattern:
lead session on a frontier Claude model, coding workers on GLM / local Qwen,
verification on Haiku, all through one LiteLLM gateway.

## How the routing works

Claude Code sends every request — main session and subagents — to
`ANTHROPIC_BASE_URL`. Point that at the LiteLLM proxy and the proxy becomes
the switchboard: a subagent's `model:` frontmatter value is just a name the
proxy resolves. All cloud models (Anthropic and GLM families alike) route
through OpenRouter under one key; `worker-local` lands on your DGX Spark's
vLLM at $0. One endpoint, one cloud vendor relationship, per-agent economics.

```
Claude Code (lead: Fable 5 / Opus 4.8)
        │  ANTHROPIC_BASE_URL=http://localhost:4000
        ▼
   LiteLLM gateway ──► openrouter/anthropic/*  (boss + checkers)
                   ──► openrouter/z-ai/glm-5.2 (worker-coder, checker-glm)
                   ──► spark.local vLLM        (worker-local, $0)
                   ──► api.z.ai direct         (worker-zai fallback, unused
                                                by default)
```

## Setup

1. Env vars — copy the example and fill in real keys (`.env` is gitignored):
   ```
   cp .env.example .env
   # OPENROUTER_API_KEY=sk-or-...      # required — all cloud models route through OpenRouter
   # GLM_API_KEY=...                   # optional — only the worker-zai direct fallback
   # LITELLM_MASTER_KEY=sk-swarm-local # optional — compose defaults to this value
   ```

2. Start the gateway and launch the lead session in one step:
   ```
   swarm/start.sh -C your-project/   # dir containing .claude/agents/ + CLAUDE.md
   ```
   The script brings up the compose stack, waits for `:4000/health`, then
   `exec`s `claude` in the project dir with `ANTHROPIC_BASE_URL` /
   `ANTHROPIC_AUTH_TOKEN` set. Pass `--model claude-opus-4-8` for half the
   price (default is `claude-fable-5`), or `--gateway-only` to start the
   proxy without launching a session.

3. (Optional, $0 worker) Serve Qwen on the Spark:
   ```
   vllm serve nvidia/Qwen3-32B-NVFP4 --host 0.0.0.0 --port 8000
   ```
   Adjust `api_base` in `litellm-config.yaml` (Tailscale hostname works).
   That command runs in the foreground and dies with the shell — for real
   runs, keep it alive as a service on the Spark (e.g. a systemd user unit
   with `Restart=on-failure`, or at minimum `tmux`/`nohup`). If `worker-local`
   dispatches start failing mid-run, check the endpoint first:
   `curl http://spark.local:8000/v1/models`.

   To add another local model (any OpenAI-compatible server — vLLM, Ollama's
   `/v1`, llama.cpp server), append a `model_list` entry to
   `litellm-config.yaml`:
   ```yaml
   - model_name: worker-local-small        # the alias agents will use
     litellm_params:
       model: hosted_vllm/<served-model-name>
       api_base: http://<host>:<port>/v1
       api_key: "unused"
   ```
   then reference the alias in an agent's `model:` frontmatter and restart
   the gateway (`docker compose restart litellm`).

4. Manual equivalent, if you'd rather not use the script:
   ```
   docker compose up -d
   curl http://localhost:4000/health -H "Authorization: Bearer $LITELLM_MASTER_KEY"
   export ANTHROPIC_BASE_URL=http://localhost:4000
   export ANTHROPIC_AUTH_TOKEN=$LITELLM_MASTER_KEY
   cd your-project/   # containing the .claude/agents/ + CLAUDE.md from here
   claude --model claude-fable-5    # or claude-opus-4-8 for half the price
   ```

5. Kick it off with a "big work" prompt, e.g.:
   > Read CLAUDE.md. Phase 0 first: draft SPEC.md and ACCESSIBILITY.md for
   > <project>, show me both for sign-off, then run the build rounds.

## Caveats

- **Verify model slugs against the OpenRouter model list** before first run —
  all cloud entries in `litellm-config.yaml` use `openrouter/...` slugs. The
  direct Z.ai endpoint + model ID matter only for the `worker-zai` fallback
  (unused by default); check those against current Z.ai docs if you enable it.
- The subagent `model:` field officially expects Claude aliases or model IDs;
  arbitrary names work **only because the gateway resolves them**. Confirm the
  session is actually routed through the gateway before a run: `echo
  $ANTHROPIC_BASE_URL` should point at the proxy, and `curl :4000/health`
  should answer. If `ANTHROPIC_BASE_URL` is `https://api.anthropic.com` or the
  proxy is down, the non-Anthropic aliases (`worker-glm`, `worker-local`,
  `checker-glm`) fail to resolve with an error like "the selected model
  (worker-local) may not exist or you may not have access". Fallback: either
  relaunch the session through the gateway (`swarm/start.sh -C <project-dir>`,
  which starts the proxy and sets the env for you) or run the swarm
  Anthropic-only
  by overriding each dispatch's model (haiku/sonnet/opus) and recording a
  degraded-family ruling. Tier 2's "two families" then holds across two
  Anthropic model tiers instead of two vendors, and verdict `FAMILY` fields
  should record what actually ran rather than claiming `glm`/`local`. The
  mechanical gate enforces the family count on whatever `FAMILY` strings get
  written either way.
- If your account is under a managed org policy, an `availableModels`
  allowlist can override frontmatter model choices.
- Subscription (Max plan) usage does not flow through a proxy — this setup
  is API-key billing. That's inherent to the multi-vendor trick.
- Checkers are cheap but not free: keep their checks mechanical (diffs,
  axe-core, explicit constitution points) so a small model can't drift.

## Verification tiers

Rigor is chosen per task, not applied uniformly (see `TIERS.md`):

- **Tier 1** — reversible, oracle-checkable work: worker → one mechanical
  checker. Same cost as the base kit.
- **Tier 2** — shared/weak-oracle work: two checkers on different model
  families must both PASS; disputes go to a 3-judge panel (`judge-claude`,
  `judge-glm`, `judge-local`).
- **Tier 3** — irreversible / high blast radius (payments, auth, deploys,
  migrations, publishing): two workers build blind in separate git worktrees;
  `swarm/tier3-compare.sh` reports behavioral divergences; the boss adjudicates
  and the merge still gets Tier 2 checks.

A pure-bash gate enforces it: a task is accepted only when `swarm/gate.sh check
<task>` exits 0, and the run completes only when `swarm/gate.sh done` does.
`swarm/gate.sh escalate-scan` raises a task's tier on evidence (two consecutive
fails, a checker overrule, or a change to a `critical.globs` path). Every agent
writes its own evidence into `.swarm/`, so the boss cannot fabricate a check.

Run the deterministic gate tests (no API keys, no gateway):

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
Tier-3 worktree-A/B divergence matrix and RESOLUTION line; and a cost panel.

Anti-lie note: the dashboard computes each task's state from the verdict
evidence, not from the ledger `status` string — so a task that the ledger
calls `accepted` but that lacks a real PASS-quorum (or has an open escalation
flag) renders as a surfaced discrepancy, never as a false `accepted`. It
agrees with `gate.sh check` by construction.

Demo without a live run: `node dashboard/server.mjs dashboard/fixtures/swarm-demo`
serves a fixture exercising every state.

Cost data: the cost panel reads `.swarm/spend.jsonl`; if that file is absent
the panel shows a calm empty state. To populate it, wire
`dashboard/spend-callback.py` (a LiteLLM custom logger) into the gateway —
see that file's docstring. That wiring edits `litellm-config.yaml` and is a
Tier-3 change; it is NOT enabled by default.

See `dashboard/README.md` for endpoint details.
