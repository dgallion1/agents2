# SPEC.md — Swarm Mission Control (read-only dashboard)

A local web UI that renders the state of a running boss/worker/checker swarm
by **reading `.swarm/` and never writing to it**. The dashboard cannot accept,
reject, or edit any task — status flows only through verdict files and the
gate, exactly as `CLAUDE.md` requires. The UI is a window onto the evidence,
not a second path around the gate.

## 1. Architecture

- **Server-rendered first, live-reloaded second.** A zero-dependency Node
  server (Node ≥ 24, built-in `http`/`fs` only — no npm install, honoring
  cost discipline) reads `.swarm/`, builds a state object, and renders the
  **complete HTML** on every `GET /`. The client's only job is to reconnect an
  SSE stream and swap in fresh HTML when files change. This means: the real
  content lives in the initial HTML (so `axe` audits the true page, and a
  content checker can grep rendered values against source files), and the
  dashboard works with JavaScript disabled.
- **Read-only.** The server opens `.swarm/` for reading. The only endpoints
  that run anything are explicit, operator-triggered *read* actions that shell
  out to the existing `swarm/gate.sh` (`check`, `escalate-scan`) and stream its
  stdout back — they change no dashboard state and write no files. There is no
  "accept" button anywhere. (These action endpoints are **out of scope for
  this build** — see §6; the build ships the viewer only.)
- **Data source is swappable.** The watched directory is `SWARM_DIR`
  (default `.swarm`), so the same binary can point at a live run or at the
  demo fixtures.

### File layout (everything under `dashboard/`)

```
dashboard/
  server.mjs            # http + SSE + fs.watch glue; reads SWARM_DIR from disk
  lib/parse.mjs         # pure: (swarmDir contents) -> state object   [no HTTP]
  lib/render.mjs        # pure: (state) -> full HTML string           [no I/O]
  test/parse.test.mjs   # node --test suite for parse.mjs against fixtures
  fixtures/swarm-demo/  # sample .swarm tree (ledger, verdicts, ...) + spend.jsonl
  spend-callback.py     # LiteLLM custom logger -> spend.jsonl  (inert; not wired)
  README.md             # how to run: `node dashboard/server.mjs [SWARM_DIR]`
```

## 2. Data contracts

These are the interfaces workers code against. They are fixed here so the five
tasks are mutually blind and independent — each codes to this document, not to
another worker's output.

### 2a. `.swarm/` file formats (already defined by `swarm/gate.sh` + agent protocols — do not invent)

- `ledger.tsv` — TAB-separated, 7 columns, `#` comments allowed:
  `task_id  tier  checks  status  attempt  worker  reason`.
  `tier ∈ {1,2,3}`, `attempt` is a non-negative integer, `checks` is a
  comma-list or `-`.
- `manifests/<task>.<attempt>.files` — repo-relative paths, one per line.
- `verdicts/<task>.<attempt>.<checker>.verdict` — line-oriented `KEY: value`
  header (`VERDICT`, `CHECKER`, `FAMILY`, `TASK`, `ATTEMPT`), then a `---`
  separator, then free-text evidence. `VERDICT ∈ {PASS, FAIL, UPHOLD,
  OVERRULE}`. `FAMILY ∈ {anthropic, glm, local}`.
- `flags/<task>.flag` — `TARGET_TIER: <n>` and `REASON: <text>`.
- `tier3/<task>/report.md` — free text; significant lines are `RESOLUTION:`
  (presence = resolved) and a per-check matrix.
- `spend.jsonl` — **new, defined by this project** (§2c). Absent ⇒ cost views
  render an empty state, never an error.

### 2b. State object (the `parse.mjs` → `render.mjs` contract)

`parse(swarmDir)` returns a plain object; `render(state)` consumes exactly it.
Unknown/malformed inputs are surfaced in `state.errors`, never thrown away.

```js
{
  tasks: [{
    id, tier, checks: [..], status, attempt, worker, reason,
    manifest: [paths] | null,
    verdicts: [{ checker, family, verdict, task, attempt, evidence, path }],
    flag: { targetTier, reason } | null,
    tier3: { hasResolution, resolution, matrix: [{ check, a, b, agree }] } | null,
    derived: { state: 'building'|'checking'|'disputed'|'accepted'|'flagged'|'blocked',
               familiesPassed: [..], isDispute: bool }
  }],
  summary: { accepted, inVerification, disputed, flagsOpen,
             byTier: { '1': n, '2': n, '3': n } },
  spend: null | {
    total, perAlias: [{ alias, family, tokens, cost }],
    perTier:  [{ tier, tasks, avgCost }],
    derived:  { perAcceptedTask, verificationSharePct, disputeOverhead, localTokens }
  },
  errors: [{ file, message }]
}
```

`derived.state` is computed, not read from the ledger `status` string alone, so
the badge can never claim `accepted` unless a PASS-quorum actually exists in the
verdict files. This is the anti-lie property; `parse.mjs` owns it.

### 2c. `spend.jsonl` line schema (one JSON object per line)

```json
{"ts": 1752115200, "alias": "worker-glm", "family": "glm", "tier": 2,
 "task": "dash-render", "prompt_tokens": 8123, "completion_tokens": 2044,
 "cost_usd": 0.031}
```

`tier` and `task` may be `null` (the gateway can't always attribute a call to a
task). `family` is derived from the alias per `litellm-config.yaml`. Cost is
whatever LiteLLM computed (`response_cost`). `worker-local` rows carry real
token counts and `cost_usd: 0`.

## 3. Page inventory

One page, seven regions (plus a per-task drawer). All server-rendered.

| Region | What it shows | Source |
|--------|---------------|--------|
| Header + summary cards | run name, accepted / in-verification / disputed / flags-open | `summary` |
| Flags strip | red banner listing open escalations + target tier (hidden if none) | `flag` |
| Ledger table | one row per task: id, tier badge, checks, attempt, family-colored worker, computed status | `tasks` |
| Task drawer (`?task=<id>`) | manifest files, each verdict as a card (family + verdict + evidence) | `tasks[].manifest/verdicts` |
| Dispute panel | for `isDispute`: both checker verdicts side by side, then the 3 judges with lenses + mechanical vote count | `verdicts` |
| Tier-3 diff | worktree-A vs -B check matrix, divergent rows highlighted, RESOLUTION line (or its conspicuous absence) | `tier3` |
| Cost panel | spend-by-alias table with token counts + bars, per-tier efficiency, derived metrics | `spend` |

## 4. Brand, voice, palette

Aligned to the Claude Design System so it reads as native tooling, not a
bolt-on. Full rules in `ACCESSIBILITY.md`; the essentials:

- **Surfaces**: neutral only; page is the darkest, cards step up. Light **and**
  dark mode both first-class (`prefers-color-scheme`, no toggle needed).
- **Family color = identity, not decoration.** Anthropic = coral, GLM = teal,
  local = gray. Used consistently for workers, checker verdicts, judges.
- **Status is never color-only.** Every pass/fail/dispute pairs a hue with an
  icon **and** a text label (accessibility point A-9).
- **Tier badges**: T1 gray, T2 purple, T3 pink — small pills, same everywhere.
- **Voice**: sentence case, no emoji, terse operator language. Numbers are
  rounded for display. Verdict evidence is shown verbatim, in a mono block —
  never paraphrased (this is a fidelity tool).

## 5. Task breakdown (tiers assigned per `TIERS.md`; approved at sign-off)

Tier rationale answers Oracle / Reversible / Blast-radius. All work is
reversible (local static viewer; nothing touches money, auth, deploys, or
migrations) so nothing is Tier 3.

| Task | Tier | Checks | Worker | Why this tier |
|------|------|--------|--------|---------------|
| `dash-fixtures` | 1 | second | worker-local | Strong oracle (schema must satisfy `gate.sh validate_ledger`); reversible; small. Bulk mechanical → local. |
| `dash-parse` | 2 | content, second | worker-coder | Shared trust boundary — every view depends on it; a misparse makes the UI *lie about acceptance*, the one failure this whole system exists to prevent. Dual-family. |
| `dash-render` | 2 | a11y, second | worker-coder | Shared design system across all views; a11y oracle is only partial (axe can't judge contrast intent), so dual-family + a11y checker. |
| `dash-server` | 1 | second | worker-coder | Thin glue over parse+render; reversible; small blast radius. Oracle = endpoints answer + smoke test passes. |
| `dash-spend-callback` | 1 | second | worker-coder | An **inert standalone file** plus wiring instructions; it changes nothing until the user edits `litellm-config.yaml` (that activation is explicitly out of scope, and would itself be Tier 3 — it touches the shared gateway on a `critical.globs` path). Oracle = unit test: given a mock LiteLLM payload, it emits one schema-valid `spend.jsonl` line. |

### Acceptance criteria (the oracles)

- **dash-fixtures** — A sample `fixtures/swarm-demo/` tree that exercises every
  state: an accepted T1, a T2 mid-check, a T2 dispute with 2 checker + 3 judge
  verdicts, a T3 with a `report.md` (RESOLUTION present) and one without, one
  open flag, and a `spend.jsonl` with ≥1 row per family incl. a `cost_usd:0`
  local row. **Pass iff** `SWARM_DIR=dashboard/fixtures/swarm-demo bash
  swarm/gate.sh escalate-scan` and `... validate_ledger` run without a `gate:`
  error, and every verdict file parses as `KEY: value` + `---` + evidence.
- **dash-parse** — `node --test dashboard/test/parse.test.mjs` passes; tests
  assert (a) `derived.state==='accepted'` **only** when a PASS-quorum exists
  for the current attempt, (b) a `FAIL` from one family flips `isDispute`, (c)
  malformed lines land in `state.errors` rather than throwing, (d) ledger
  values appear in state **character-faithfully** (checker-content verifies the
  round-trip). Pure module: no `http`, no `process.exit`.
- **dash-render** — `render(state)` returns one complete `<!doctype html>`
  document. Running `npx @axe-core/cli` against a rendered fixture page yields
  **zero violations** in both `prefers-color-scheme` settings; every numbered
  point in `ACCESSIBILITY.md` holds; status is never conveyed by color alone;
  verdict evidence appears verbatim. No inline event handlers, no external
  origins (CSP-clean, self-contained CSS).
- **dash-server** — `node dashboard/server.mjs dashboard/fixtures/swarm-demo`
  serves `GET /` (200, full HTML), `GET /events` (SSE, `text/event-stream`),
  and `GET /?task=<id>` (drawer open). A touch to a fixture file pushes an SSE
  event within 1s. Serves nothing outside `dashboard/` and never opens `.swarm`
  for writing.
- **dash-spend-callback** — `spend-callback.py` exposes a LiteLLM
  `CustomLogger` whose success hook appends exactly one `spend.jsonl` line
  matching §2c for a mock payload; a bundled `python3` self-test asserts the
  line parses and has all required keys. It imports nothing project-specific
  and writes only to the path it is given. **Does not** modify
  `litellm-config.yaml` (that path is in `critical.globs`).

## 6. Out of scope (this build)

- Wiring `spend-callback.py` into the live gateway (edits `litellm-config.yaml`,
  restarts the container — the user's call; Tier 3 when done).
- The gate-action endpoints (`/run/check`, `/run/escalate-scan`). Deferred to a
  follow-up; the viewer ships first.
- Any write path into `.swarm/`. Permanently out of scope by design.

## 7. Rulings

**R-2 (2026-07-10, boss) — dash-parse attempt 1 sent back (dispute resolved by
rework, not panel).** At Tier 2, `checker-content` (anthropic-haiku) PASSed on
fidelity; `checker-second` (anthropic-sonnet) FAILed on quorum logic. I
independently reproduced the defect: for a task with ledger `status=accepted`,
a genuine 2-family PASS quorum, **and** an open escalation flag (`tier <
TARGET_TIER`), `parse()` returns `derived.state='accepted'` while `gate.sh
check` returns FAIL ("escalation pending"). The gate checks the flag *before*
tier acceptance (gate.sh cmd_check); `parse` did not, breaking the anti-lie
property. The two checkers examined different properties and do not genuinely
conflict, and a reproduced `gate.sh check` exit 1 is a settled mechanical fact,
not a matter of taste — so the 3-judge panel (whose only distinct outcome is
OVERRULE→accept-despite-FAIL) has nothing to arbitrate. Resolution: rework at
attempt 2. Fix: an open flag must prevent `derived.state==='accepted'` and, when
the ledger nonetheless says accepted, surface an `errors[]` discrepancy;
mirror gate precedence (flag check first). Regression test required.

**R-1 (2026-07-10, boss) — degraded-family run.** The LiteLLM gateway is not
running and this session's `ANTHROPIC_BASE_URL` points at api.anthropic.com,
so the `worker-glm` / `worker-local` / `checker-glm` aliases cannot resolve
(worker-local dispatch failed at model resolution; no work was lost). This run
proceeds Anthropic-only with per-dispatch model overrides. Tier 2's "two
families" is downgraded to two *model-tier lineages*: mechanical checkers on
Haiku (`FAMILY: anthropic-haiku`), second checker on Sonnet (`FAMILY:
anthropic-sonnet`). Verdict FAMILY fields record what actually ran — never
`glm`/`local` labels for models that didn't. The gate's distinct-family count
still operates on these strings. True vendor independence requires relaunching
the session through the gateway per README; tiers and checks are otherwise
unchanged.
