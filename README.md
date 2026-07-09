# Boss/worker/checker swarm for Claude Code

Replicates the "expensive boss, cheap workers, mechanical checkers" pattern:
lead session on a frontier Claude model, coding workers on GLM / local Qwen,
verification on Haiku, all through one LiteLLM gateway.

## How the routing works

Claude Code sends every request — main session and subagents — to
`ANTHROPIC_BASE_URL`. Point that at the LiteLLM proxy and the proxy becomes
the switchboard: a subagent's `model:` frontmatter value is just a name the
proxy resolves, so `worker-glm` lands on Z.ai, `worker-local` lands on your
DGX Spark's vLLM, and `claude-fable-5` / `checker-haiku` pass through to
Anthropic. One endpoint, four vendors, per-agent economics.

```
Claude Code (lead: Fable 5 / Opus 4.8)
        │  ANTHROPIC_BASE_URL=http://localhost:4000
        ▼
   LiteLLM gateway ──► anthropic/*          (boss + checkers)
                   ──► z.ai glm-5.2         (worker-coder)
                   ──► spark.local vLLM     (worker-local, $0)
                   ──► openrouter/*         (fallback)
```

## Setup

1. Env vars (`.env` next to the compose file):
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   GLM_API_KEY=...
   OPENROUTER_API_KEY=...        # optional
   LITELLM_MASTER_KEY=sk-swarm-local
   ```

2. Start the gateway:
   ```
   docker compose up -d
   curl http://localhost:4000/health -H "Authorization: Bearer $LITELLM_MASTER_KEY"
   ```

3. (Optional, $0 worker) Serve Qwen on the Spark:
   ```
   vllm serve nvidia/Qwen3-32B-NVFP4 --host 0.0.0.0 --port 8000
   ```
   Adjust `api_base` in `litellm-config.yaml` (Tailscale hostname works).

4. Launch the lead session through the gateway:
   ```
   export ANTHROPIC_BASE_URL=http://localhost:4000
   export ANTHROPIC_AUTH_TOKEN=$LITELLM_MASTER_KEY
   cd your-project/   # containing the .claude/agents/ + CLAUDE.md from here
   claude --model claude-fable-5    # or claude-opus-4-8 for half the price
   ```

5. Kick it off with a "big work" prompt, e.g.:
   > Read CLAUDE.md. Phase 0 first: draft SPEC.md and ACCESSIBILITY.md for
   > <project>, show me both for sign-off, then run the build rounds.

## Caveats

- **Verify GLM endpoint + model ID** against current Z.ai docs before first
  run; the values in `litellm-config.yaml` are placeholders in shape.
- The subagent `model:` field officially expects Claude aliases or model IDs;
  arbitrary names work **only because the gateway resolves them**. Without
  `ANTHROPIC_BASE_URL` set, `worker-glm` will error.
- If your account is under a managed org policy, an `availableModels`
  allowlist can override frontmatter model choices.
- Subscription (Max plan) usage does not flow through a proxy — this setup
  is API-key billing. That's inherent to the multi-vendor trick.
- Checkers are cheap but not free: keep their checks mechanical (diffs,
  axe-core, explicit constitution points) so a small model can't drift.
