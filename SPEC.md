# SPEC.md — Vendor-neutral swarm: Claude or Sol may lead (VN run)

Run prefix: **VN**. Target repo: **agents2 itself** — worktree
`.claude/worktrees/codex-sol-agent-integration-f64e99`, branch
`claude/codex-sol-agent-integration-f64e99`, base master **12f6413**.
VN5 also touches the budget2 repo (its own branch/PR). This run's `.swarm/`
lives here (gitignored). Fresh ledger.

## 0. Status — Phase 0 SIGNED OFF 2026-09-30 (VN1–VN7); all six probes answered (§5)

Build is **blocked on run CD merging** (worktree
`unifi-camera-streaming-7be695`, CD1 attempt 3 in checking): CD4 edits
`CLAUDE.md`, `TIERS.md`, `swarm/gate.sh` and `dashboard/lib/parse.mjs`,
which VN restructures. After CD merges: rebase onto the new master, then
write briefs and oracles and run the surface census against the post-CD tree.
The previous SPEC (run GH) is archived byte-identical at
`docs/runs/2026-09-29-GH-run-state/SPEC.md`.

## 1. Problem and decisions (user, 2026-09-30)

Models keep shipping, so which vendor fills each role should be something
you set, not something baked into the files. The user wants GPT-6-Sol (Codex)
to lead some runs, for cost (the lead is ~37% of Claude spend at list
price) and capability, while Claude can still run the same system.

| # | Decision |
|---|---|
| D1 | Either **Claude or Codex/Sol may lead** a run. The gate, ledger, verdict format, tiers and hard stop are the same whichever vendor leads. |
| D2 | **Run CD's D3 is relaxed for the LEAD only.** A Sol lead may see live data (budget2 `data/`, its MCP, the live app), as a Claude lead does. Every NON-lead Codex role stays under D3: data-free copy, container, egress allowlist (CD1's harness). |
| D3 | **One constitution**, no copies (§3a). Signed off. |
| D4 | Model choice per role is **one table row** with exact model IDs, re-tuned as releases ship (§3b). Signed off. |
| D5 | **Cross-vendor independence rule approved** (§3d): at Tier 3, and at Tier 2 when `second` is named, a checker from a vendor other than the lead's must run. |
| D6 | Stale Codex constitution **renamed aside now** (done 2026-09-30, §7). |
| D7 | Choices of lead, worker and checker are re-tuned from **mechanically kept stats** under pre-registered rules (§3f). Signed off. |
| D8 | The user reports Sol is very strong at computer use; VN7 gives it a UI-checker role, scored by VN6. Signed off; P6 narrowed it to browser automation. |

## 2. Why, with evidence (Phase-0 probes 2026-09-30)

- **Copies drift within days.** The Sep 5 Codex-as-lead port (a
  find-and-replace of CLAUDE.md, updated 09-23) is 298 lines against
  CLAUDE.md's 357. It still says "all lanes on Codex since 2026-08-19" and
  lacks the surface census and the 09-29 gate hardening. budget2 shows the
  same thing: its `AGENTS.md` (07-03) and `CLAUDE.md` (09-02) share only 4
  of 18 paragraphs.
- **Codex was following a stale copy** (fixed the same day, D6 and §7).
  `~/.codex/AGENTS.md` sent every Codex build task to
  `~/work/agents2/AGENTS.md`, the untracked, drifted port in the main
  checkout.
- **Aliases drift silently.** In one hour the same `sonnet` alias ran
  `claude-sonnet-5` from the headless CLI 2.1.260 and `claude-sonnet-5-5`
  from the desktop app's subagents (run CD). Exact IDs work even on a client
  that does not know them: `claude-sonnet-5-5` ran from 2.1.260 with only an
  `unrecognized_model` warning.
- **Headless cross-vendor dispatch works.** `claude -p --agent
  surface-census --output-format json` loaded the project role (`PROBE-OK
  surface-census`, $0.10), and `claude -p --resume <session_id>` continued
  it (`RESUME-OK PROBE-OK`). `codex exec resume <id>` exists in the bundled
  0.159 CLI. So each vendor's lead can dispatch and resume the other
  vendor's roles, and the resume-don't-re-dispatch rule survives.
- **Claude's private memory holds operational safety rules a Sol lead
  would not have**: budget2 binaries parse no flags (any invocation starts
  a server and kills live :8080); never `git checkout` on a swarm tree
  (wipes uncommitted worker output); rtk rewrites git output and falsifies
  diffs; throttle heavy verification (nice + capped parallelism); agents2 is
  PUBLIC (redact names from evidence); worktree `data/` symlinks live data.
  Under D2 a Sol lead has live access, so these rules must be in the shared
  constitution.

## 3. Design

### 3a. One constitution (VN1)
- `SWARM.md`: the vendor-neutral body of today's CLAUDE.md. It uses
  role-level verbs (dispatch, resume, run in the background) and never
  names a vendor's tool (Agent tool, SendMessage, `codex exec`). It gains
  an **Operational rules** section holding the generic rules from §2,
  with no household facts because the repo is public.
- `CLAUDE.md` = `@SWARM.md` plus the Claude adapter: the Agent tool,
  SendMessage, background runs, where transcripts record the `model` ID.
- `AGENTS.md` is **generated** (Codex has no `@` import) by
  `swarm/gen-adapters.sh` from `SWARM.md` + `swarm/adapters/codex.md`,
  with a do-not-edit header. The Codex adapter says: dispatch every swarm
  role through `swarm/dispatch.sh`; never use native Codex subagents for a
  swarm role (they would inherit the lead's live access and break D2's
  non-lead boundary); model IDs come from the Codex session JSONL.
- Doc tests (`smoketest/doc_test.sh`) retarget `SWARM.md` and add three
  checks: `AGENTS.md` regenerates byte-identical, `CLAUDE.md` imports
  `@SWARM.md`, and `SWARM.md` names no vendor tool (a neutrality lint).

### 3b. One role → model table (VN2)
- `swarm/roles.tsv`: `role  vendor  model  effort  fallback`, with **exact
  model IDs** (never aliases, §2). A new release means editing a row, and
  the ACTIVE EXPERIMENT rule already requires that change to be recorded
  and not mixed with a process change.
- Role prompts are single-source in `swarm/roles/<role>.md`. The generator
  writes `.claude/agents/<role>.md` with frontmatter from the table. No
  `.codex/agents/*.toml` is generated: Codex-vendor roles run only through
  the container wrappers.
- `agents_test.sh` asserts that every generated file is fresh and that its
  frontmatter model matches the table.

### 3c. Cross-vendor dispatch (VN3)
- `swarm/dispatch.sh <role> <task> <attempt> <brief>` reads `roles.tsv`:
  - **anthropic** role → `claude -p --agent <role> --model <id>
    --permission-mode <P> --output-format json` in the target tree;
  - **openai** checker → `swarm/codex-check.sh` (CD1, in the container);
    an **openai** worker → refused until the Codex worker lane exists
    (§6).
- It records `.swarm/dispatch/<task>.<attempt>.<role>.json` (session id,
  vendor, the model ID actually reported, cost, exit status).
  `dispatch.sh --resume <task> <attempt> <role> <message-file>` continues
  the same session, for BLOCKED returns and checker FAIL answers.
- A Claude lead may keep the native Agent tool for anthropic roles. A Sol
  lead uses `dispatch.sh` for every role.
- `<P>` is `auto` (probe P5): the same classifier-gated rights as a native
  subagent, never `bypassPermissions`, so a Sol lead cannot widen a Claude
  role.
- A Sol lead runs `dispatch.sh` as an escalated command and must request
  escalation UP FRONT for every dispatch (probe P3): inside Codex's sandbox
  `claude -p` hangs and then fails on DNS, and Codex does not infer that it
  should escalate. The unit of approval is one dispatch, or a narrow Codex
  permission profile for that one script (network plus writes to `~/.claude`
  and the run's `.swarm/`), never a whole unsandboxed session.

### 3d. Vendor attribution and cross-vendor independence (VN4)
- The run's lead is declared once, in a ledger header line
  `# lead: <vendor> <model-id>`. `check`/`done` refuse a new-format ledger
  without it.
- Verdicts gain an optional `MODEL:` header (dispatch.sh stamps it from
  the CLI's own report). `FAMILY` stays an independence **lane**, not a
  vendor (gate.sh comment, line 64).
- **Rule (approved, D5):** at Tier 3, and at Tier 2 when `second`
  is named, the attempt must hold a verdict or skip record from at least
  one checker whose vendor is not the lead's.
  - A Sol lead meets it through the Claude checkers.
  - A Claude lead meets it by naming `codex` (CD4 semantics: a FAIL
    counts, a PASS never does).

  The surface census follows the same rule but stays advisory. Reason:
  every lean-era catch landed on the lead's own artifacts.
- `gate.sh stats` gains a `lead:` line plus first-attempt clean rates split
  by lead vendor and by worker vendor, so the choice of lead is decided by
  data. `parse.mjs` mirrors all of it.

### 3e. budget2's own instructions (VN5, budget2 repo)
budget2's `AGENTS.md` becomes generated from its `CLAUDE.md` (same pattern
and freshness test). budget2-specific operational rules (binary flags,
deploy recipe, file-rename trap) move there from Claude's memory, because
the target repo's instructions are what any lead reads there.

### 3f. Stats that drive the setup (VN6)
Principle: stats are **derived from evidence files**, like the gate, and
never transcribed by the lead, because the lead's own choices are among the
things being scored.
- **Record** at run close (`stats/record.py`), appending to tracked
  `docs/runs/stats/`:
  - `attempts.tsv`: run, task, tier, attempt, lead and worker vendor+model,
    outcome, first-attempt clean, elapsed.
  - `verdicts.tsv`: checker, vendor+model, lane, verdict, overruled?,
    unique? (the only FAIL at that attempt).
  - `cost.tsv`: role, vendor, model, tokens; Claude $ at list price; Codex
    weekly-quota % (session `token_count.rate_limits`).
  - `catches.tsv`: mechanism, catcher vendor+model, target (lead artifact
    or worker output), defect class.

  Checker and oracle catches come from verdicts and logs. Census and user
  catches come from a fixed tag the lead writes in Rulings (`[catch:
  <mechanism> <target> <class>]`); it is the only hand-written input, and
  the final pass checks it. Model IDs come from Claude transcripts, Codex
  session JSONL and VN3's dispatch records.
- **Report** (`stats/report.py`): aggregates across runs by (role, vendor,
  model). It partitions at every commit that changes `swarm/roles.tsv`, so
  before and after a model change never mix, and it shows counts with n,
  never bare percentages.
- **Pre-registered decision rules** (the user signs them, as with the lean
  rule). The report prints which rules fire and the user decides.
  `roles.tsv` changes only between runs:
  - **Worker:** at ≥10 tasks per vendor, the default worker goes to the
    higher first-attempt clean rate; on a tie, the cheaper vendor.
  - **Checker yield:** zero unique catches over ≥15 tasks → reserve it for
    defect-history surfaces. ≥2 overruled FAILs per 10 → review its prompt.
  - **Codex PASS promotion:** ≥2 upheld Codex-only FAILs and 0 overruled
    FAILs over ≥10 tasks → propose letting a Codex PASS count.
  - **Lead:** lead-artifact catches per task and cost per accepted task, by
    lead vendor, after ≥3 runs each.
  - **New release:** the new model starts a fresh partition; the old
    model's numbers are the baseline it must beat.
  - **Quota guard:** Codex weekly quota >80% at run start → Codex roles use
    their fallback row for the run, and the fallback is recorded.
- **Backfill** from `docs/runs/` plus the local transcripts that still
  exist; runs without usable evidence are marked, not guessed.

## 4. Task table

| Task | Tier | Checks | Owner | Depends | Acceptance (summary; full blocks at dispatch) |
|------|------|--------|-------|---------|-----------------------------------------------|
| VN1 | 3 | tests,second,codex | worker-coder | CD merged | §3a. Oracle: every current `doc_test.sh` assertion holds against `SWARM.md`; every paragraph of master's CLAUDE.md appears in `SWARM.md` or the Claude adapter, or is listed in `.swarm/tier3/VN1/rewrites.tsv` (old → new, reviewed by both checkers), so no rule is silently dropped; regeneration is idempotent; mutations (drop a paragraph, hand-edit `AGENTS.md`, name `SendMessage` in `SWARM.md`) each fail the suite. |
| VN2 | 3 | tests,second,codex | worker-coder | VN1 | §3b. Oracle: generated `.claude/agents/*.md` are byte-identical to master's apart from the `model:` line; every model is an exact ID matching `roles.tsv`; the freshness test fails on a hand edit. |
| VN3 | 3 | tests,second,codex | worker-coder | VN2, CD1 | §3c. Oracle, with a stub `claude` and a stub Codex on PATH: exact argv per vendor, dispatch record fields, `--resume` reuses the session id, openai worker refused, permission mode never `bypassPermissions`, a stub failure → recorded non-zero status and no verdict; plus ONE live `claude -p` probe of a real role. |
| VN4 | 3 | tests,second,codex | worker-coder | VN3, CD4 | §3d in `gate.sh` + `parse.mjs` (differential scenarios); ledgers without a lead header and pre-VN verdicts still validate; `stats` lines exact. |
| VN6 | 2 | tests,second | worker-coder | VN4 | §3f (signed off). `second` because it renders rates shown to the user (defect-history surface). Oracle: a fixture archive with known counts → exact report lines; a roles.tsv change splits a partition; a lead-transcribed figure has no path in (every column traces to an evidence file or a `[catch:]` tag); each decision rule fires exactly at its threshold and not below it. Lives in `stats/`, outside the critical globs. |
| VN7 | 3 | tests,second | worker-coder | VN3, VN6 | Signed off; P6 narrowed it to the browser path. A `checker-ui` role (openai, Sol): drives the built UI in headless Chromium through Playwright inside the container, against a synthetic-data demo instance built from the data-free copy, and writes a verdict whose evidence is an action log plus screenshots, each with a replay script a Claude checker can re-run. Under CD's trial rule its FAIL counts and its PASS never does. VN6 scores its unique catches against `checker-a11y`'s (~8% of Claude spend). The image adds Chromium and the Playwright MCP, which are downloads that need approval at build time. |
| VN5 | 2 | tests | worker-coder | VN1 | §3e in budget2: generated `AGENTS.md` + freshness test; operational rules present; nothing household-specific added to agents2. |

Tiers: VN1–VN4 are Tier 3 because they change the constitution, the role
definitions, the process that launches agents on live data, and the gate
(critical globs below). VN5 is docs in the target repo. Every Tier-3 task
gets a `surface-census` pass on its draft brief and `accept.sh` before
dispatch, and every oracle is validated at both ends. `codex` is named on
VN1–VN4 as trial data points for CD's lane (a FAIL counts, a PASS never
does). Its copy excludes `docs/runs/` and `*.png`.

## 5. Phase-0 probes (run 2026-09-30) — all six answered

| # | Probe | Result |
|---|---|---|
| P1 | Headless dispatch of a project role | **Pass.** See §2. |
| P2 | Exact model ID in a role definition | **Pass.** See §2. |
| P3 | A Sol session runs `claude -p --agent …` from its own shell | **Pass (15:51).** An interactive Sol session (`gpt-6-sol`, approval `on-request`; the app-bundled CLI needs `--no-daemon`), told to request escalation up front, called `exec_command` with `sandbox_permissions: require_escalated`; the user approved once ("Yes, proceed", no standing rule); `claude -p --agent surface-census` returned exit 0, `"result":"PROBE-OK surface-census"`, $0.10, model `claude-sonnet-5` (the `sonnet` alias again resolving to the older model from CLI 2.1.260; VN2 pins exact IDs). Earlier attempts: the unsandboxed `codex exec -s danger-full-access` was blocked by Claude's auto-mode classifier ("Create Unsafe Agents") and is never launched from a Claude session. Inside Codex's sandbox, `claude -p` hung and then failed after 180 s with `Can't reach the API server … (ENOTFOUND)`, and Sol did not ask to escalate on its own; hence §3c's up-front escalation rule. The same session confirmed the new `~/.codex/AGENTS.md` pointer loads. |
| P4 | Which constitution a Sol lead sees in a worktree | **Done.** Sol (model `gpt-6-sol`, per its session JSONL) auto-loaded the worktree's `AGENTS.md` and also followed the global pointer to `~/work/agents2`, found no `AGENTS.md` there (D6), and said it would report that before falling back. Consequence: once VN merges, the main checkout holds master's `AGENTS.md`, so a Sol lead in a run worktree would see two constitutions. The global pointer must name the current agents2 worktree (§7). |
| P5 | Permission mode for headless roles | **Done.** `--permission-mode auto` gives a dispatched Claude role the same classifier-gated rights as a native subagent (it even allowed a benign `touch` in `~`, since removed). `dontAsk` is strictly narrower: allow-listed commands only, and it refused the write outside the repo. Frontmatter `tools` are enforced (no Write tool → none offered). §3c uses `auto`, never `bypassPermissions`, so a Sol lead cannot widen a Claude role. |
| P6 | Codex computer use confined to a nested display | **Done: desktop computer use is not available to the Codex CLI.** With `cua_repl` enabled for the run and `DISPLAY` set to a Xephyr display, Sol searched its tool list for screen/desktop tools, found only the Playwright MCP from the global config, and screenshotted a blank browser viewport (780×493, no text). Desktop control appears to be a ChatGPT-app feature. VN7 therefore takes its fallback: browser automation (headless Chromium + Playwright) inside the container. |

Side finding, fixed 2026-09-30 (user OK): `~/.codex/config.toml` opted into `[features].use_legacy_landlock`. On Codex 0.159 that path crashes ("filesystem-restricted execution requires bubblewrap"), while bubblewrap works from the user's terminal despite `apparmor_restrict_unprivileged_userns=1`: reads allowed, writes and network blocked. The line was removed and the default sandbox verified; backup `~/.codex/config.toml.bak-2026-09-30`. It explains the first sandboxed P3 run, in which no command ran at all.

## 6. Out of scope (next runs)

- **The Codex worker lane** (`codex-work.sh`: patch out of the container,
  applied and fingerprinted by the harness; about 24% of Claude spend).
  It is its own run after VN and reuses CD1's container.
- **The trial**: Sol leads one real run (budget2 is allowed under D2);
  `stats` compares it with Claude-led runs.
- Letting a Codex PASS count, which is decided by CD's trial data.

## 7. User actions (outside this repo, need approval)

- **Done 2026-09-30 (D6):** `~/work/agents2/AGENTS.md` (the Sep 5 port,
  untracked) renamed to `AGENTS.md.stale-port-2026-09-05`, so Codex now
  finds no workflow source and, per `~/.codex/AGENTS.md`, reports that
  before falling back. The untracked `.codex/` (project config + 7 agent
  TOMLs, Sep 5) is still in place and loads only when Codex runs in the
  main checkout.
- **Done 2026-09-30:** P3 run by the user, interactively (§5).
- **Done 2026-09-30 (P4 consequence):** `~/.codex/AGENTS.md` now resolves
  the workflow source per session: inside an agents2 checkout or worktree
  (`git rev-parse --path-format=absolute --git-common-dir` =
  `/home/darrell/work/agents2/.git`), it uses that checkout's `AGENTS.md`;
  otherwise it uses `~/work/agents2`. The same edit replaced "per-run
  artifacts in the target project" with "run evidence is archived to agents2
  `docs/runs/`". Backup: `~/.codex/AGENTS.md.bak-2026-09-30` (sha256
  17d43df8…).
- At VN's merge, the main checkout's `git pull` is safe: the stale port is
  now `AGENTS.md.stale-port-2026-09-05`, and VN tracks nothing under
  `.codex/` (§3b). Delete both leftovers once VN1 lands.

## 8. Critical globs (`.swarm/critical.globs`)

```
swarm/**
dashboard/lib/**
.claude/agents/**
CLAUDE.md
SWARM.md
AGENTS.md
TIERS.md
```

## 9. Rulings

(none yet)
