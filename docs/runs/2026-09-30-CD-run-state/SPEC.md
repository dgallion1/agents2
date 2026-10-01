# SPEC.md — Codex as an alongside checker lane (CD run)

Run prefix: **CD**. Target repo: **agents2 itself** — worktree
`.claude/worktrees/unifi-camera-streaming-7be695`, branch
`claude/codex-checker-lane`, base master **12f6413** (after #40 GH and #39
surface census). This run's `.swarm/` lives here (gitignored). Fresh ledger.
Saved inputs (not this run's source, reference only):
`.swarm/cd-inputs/de0532-codex-port/` — the 2026-09-23 update of the stale
Codex-as-lead port, rescued before the de0532 worktree was removed.

## 0. Status — Phase 0, awaiting user sign-off

## 1. Problem and decisions (user, 2026-09-29)

Every catch so far came from a Claude checker lane; a same-family second
opinion is the independence the lean experiment doubted. The user has a
Codex subscription and wants it as a second look. Decisions:

| # | Decision |
|---|---|
| D1 | Codex runs **alongside** Claude's `checker-second`, not instead of it (a trial). |
| D2 | Trial rule: **a Codex FAIL counts, a Codex PASS never does.** A FAIL is a FAIL (concede-and-rework, or the judge panel); a PASS satisfies no requirement, so Claude's checkers still decide acceptance. An outage writes a skip record and never blocks. |
| D3 | Codex must **never see live data**: it works on a data-free copy, inside a **container with an egress allowlist** — no host filesystem, no budget2 :8080 (it binds `*:8080`), no LAN. |
| D4 | Model **gpt-6-astra**, via the ChatGPT app's bundled CLI (`/usr/lib/chatgpt/resources/codex`, 0.155.0-alpha.16; the npm 0.159.1 release ships without its Linux binary — npm stays on 0.151.0). |
| D5 | Also fix the two gate defects run GH found, as separate tasks: a judge-named PASS supplies a lane (ruling GH-29f) and critical-glob evaluation fails OPEN (GH backlog B1). |
| D6 | budget2's tracked `PLANNING_LOG.md` (household facts) is excluded from every Codex copy. |

## 2. Phase-0 findings (probes 2026-09-29, recorded so no one re-derives them)

- `~/.codex/config.toml` wires MCP servers incl. **budget2** (live data),
  tailscale, computer-use, ~15 plugins; `~/.codex/AGENTS.md` tells Codex to
  act as the agents2 **lead** on build work; `~/.codex/hooks.json` routes
  shell through `rtk` (which can falsify `git diff` — memory).
- `--ignore-user-config` drops MCP but **still loads** `~/.codex/AGENTS.md`.
  A private `CODEX_HOME` holding only `auth.json` (symlinked) + an empty
  `config.toml` loads **no** MCP, instructions, hooks or user plugins (only
  Codex's built-in system skills); the real `auth.json` stayed byte-identical.
- Codex's own sandbox cannot confine reads here: 0.151 (Landlock) blocks
  writes but reads the whole disk; 0.155 requires bubblewrap, which fails
  inside this session's sandbox (`mountinfo path is not absolute`) and
  refuses the Landlock fallback (fails closed). Hence D3: the container is
  the sandbox.
- Codex endpoints (binary strings): `chatgpt.com/backend-api/codex`,
  `auth.openai.com` (token refresh); `api.openai.com` possible. The allowlist
  is calibrated by a live run at oracle pass-end validation.
- Docker 29.2.1 + Compose v5.0.2 are reachable; no suitable images are local.

## 3. Design

### 3a. The Codex check (CD1) — `swarm/codex-check.sh <task> <attempt>`
Run by the lead from the agents2 run worktree (`SWARM_DIR`, `SWARM_TREE` as
for the gate). It produces exactly one of
`verdicts/<t>.<a>.checker-codex.verdict` or `…checker-codex.skip`; the lead
never writes either.

1. **Preconditions** (each failure → a skip record, never a crash):
   `.swarm/codex.exclude` exists (the run's written exclusion policy — may be
   empty, must exist); `.swarm/codex/<t>.<a>.criteria.md` exists (the lead's
   criteria text, the same the Claude checkers get — never the census);
   the worker's manifest + `.sha256` sidecar exist; Docker is reachable.
2. **Data-free copy** into a private temp dir: files git tracks in TREE plus
   untracked-not-ignored files; no `.git`. Always excluded: `data/`,
   `.env*`, `*.pem`, `*.key`, `.codex/`, `.claude/`, `.swarm*/`, every
   `AGENTS.md` / `AGENTS.override.md` at any depth (Codex would load them as
   instructions); plus every glob in `.swarm/codex.exclude`. Symlinks are
   copied as links only if they resolve inside the copy; any escaping
   symlink → skip `unsafe-tree`. After copying, the manifest paths are
   re-hashed IN THE COPY against the sidecar (excluded paths are skipped and
   listed); a mismatch → skip `fingerprint-mismatch`.
3. **Container** (`swarm/codex/compose.yaml`): a toolchain image
   (`swarm/codex/Dockerfile`: `golang:1.26-bookworm` + `nodejs python3 git
   rsync ca-certificates`) runs as uid:gid 1000:1000 on an `internal: true`
   network whose only peer is an egress proxy (`swarm/codex/proxy/`:
   `debian:bookworm-slim` + `tinyproxy`, default-deny, allowlist
   `chatgpt.com`, `auth.openai.com`, `api.openai.com`, every CONNECT logged).
   Mounts, and only these: the copy at `/work` (rw); the Codex binary (ro); a
   private `CODEX_HOME` with an empty `config.toml` and `~/.codex/auth.json`
   bind-mounted as its `auth.json`; for a Go target, the host `GOMODCACHE`
   read-only with `GOPROXY=off`. No other host path.
4. **Codex invocation** inside: `codex exec
   --dangerously-bypass-approvals-and-sandbox` (the container is the external
   sandbox, which is what that flag is for) `--ephemeral --ignore-rules
   --skip-git-repo-check -m "${CODEX_MODEL:-gpt-6-astra}" -C /work --json
   --output-schema /schema/verdict.schema.json -o /out/last.json`; prompt =
   `swarm/codex/brief.md` (the adversarial checker role, adapted from
   `checker-second.md`) + the criteria file. Timeout `CODEX_TIMEOUT`
   (default 1800 s).
5. **Verdict**: `last.json` validated against `swarm/codex/verdict.schema.json`
   (`verdict` PASS|FAIL; `criteria[]` of {id, attack, command, result, pass};
   `observations[]`). Written as a verdict file with headers `VERDICT`,
   `CHECKER: checker-codex`, `FAMILY: crossvendor`, `TASK`, `ATTEMPT`,
   `MANIFEST_SHA256` (**stamped by the script** = the sidecar hash it just
   verified in the copy), `CODEX_MODEL`, `CODEX_VERSION`, then `---` and the
   per-criterion evidence. A PASS with any criterion lacking a command or a
   result → skip `evidence-free-pass` (no verdict). Schema-invalid output →
   skip `schema-invalid`.
6. **Skip record** `…checker-codex.skip`: `REASON:` one of
   `no-exclude-policy`, `no-criteria`, `no-evidence`, `docker-unavailable`,
   `unsafe-tree`, `fingerprint-mismatch`, `auth`, `quota`, `timeout`,
   `schema-invalid`, `evidence-free-pass`, `codex-error`; `DETAIL:` one line;
   `TASK`, `ATTEMPT`.
7. **Audit trail** kept in `.swarm/codex/<t>.<a>/`: the JSONL event stream,
   the proxy's CONNECT log (hosts contacted), the copy's file list and the
   excluded-paths list. The copy itself is deleted.

### 3b. Lane accounting (CD2 — ruling GH-29f)
A `PASS`/`FAIL` verdict is valid only from a `checker-*` identity;
`UPHOLD`/`OVERRULE` only from `judge-*` or `boss`. Any other pairing is an
invalid verdict file (tiers 2/3: hard fail, like any malformed
current-attempt file). `dashboard/lib/parse.mjs` mirrors it; the differential
battery covers it.

### 3c. Critical-glob evaluation fails closed (CD3 — GH backlog B1)
If the embedded python in `manifest_hits_glob` cannot read or decode
`critical.globs`, `test.globs` or any of the task's manifests, the result is
a **hit** (conservative), with a diagnostic on stderr, and `escalate-scan`
writes the flag with `REASON: critical-glob-unreadable`. `parse.mjs` mirrors
it (GH2 mirrored "no hit").

### 3d. The Codex lane in the gate, dashboard and docs (CD4)
- `crossvendor` becomes a valid `FAMILY` (an independence lane: another
  vendor's model).
- `codex` may appear in the ledger `checks` column. When it does, the attempt
  must hold a valid `checker-codex` verdict OR a valid `checker-codex.skip`
  record; neither blocks by itself.
- A `checker-codex` PASS never counts toward a named-checker requirement or a
  lane span (D2). A `checker-codex` FAIL is a FAIL: it opens the dispute path
  exactly like any checker FAIL. Its PASS still needs `MANIFEST_SHA256` (the
  script stamps it).
- `gate.sh stats`: a per-task `codex=` field (PASS / FAIL / skip:<reason> /
  none) beside `second=`, and a summary line
  `codex: ran n/m, FAIL k, same-verdict-as-second j, codex-only FAIL c` —
  the trial's measurement.
- `parse.mjs` mirrors all of it (differential scenarios); `render.mjs` stays
  unchanged.
- Docs also state CD3's rule: a present-but-unreadable `critical.globs`,
  `test.globs` or manifest escalates (`critical-glob-unreadable`); only an
  absent file keeps its old meaning (census CD3.1 G14).
- Docs: CLAUDE.md (Tier 2/3: when to name `codex`; the trial rule; Phase 0
  writes `.swarm/codex.exclude` — budget2 runs list `PLANNING_LOG.md`; the
  ACTIVE EXPERIMENT attribution mechanism `codex`; Codex never receives the
  census), TIERS.md, README; smoketest doc checks.

## 4. Task table

| Task | Tier | Checks | Owner | Depends | Acceptance criteria (summary — full blocks at dispatch) |
|------|------|--------|-------|---------|------------------|
| CD1 | 3 | tests,second | worker-coder | — | §3a exactly. Oracle drives the script against fixture trees with a STUB Codex binary (inside the real container) that records argv, env, the `/work` listing, `$CODEX_HOME` contents and network probes, and replays canned outputs: asserts every exclusion (incl. nested AGENTS.md, a `codex.exclude` entry standing in for PLANNING_LOG.md), escaping-symlink / missing-policy / fingerprint-mismatch skips, no host path visible in the container, 172.17.0.1:8080 and a non-allowlisted host unreachable, an allowlisted host reachable through the proxy, the exact Codex flags, verdict headers incl. the stamped `MANIFEST_SHA256`, every skip reason. |
| CD2 | 3 | tests,second | worker-coder | — | §3b in gate + parse.mjs; own differential scenarios; run_tests + dashboard green. |
| CD3 | 3 | tests,second | worker-coder | CD2 | §3c in gate + parse.mjs; chmod-000 / non-UTF-8 fixtures now escalate. |
| CD4 | 3 | tests,second | worker-coder | CD2, CD3 (CD1 for the integration check) | §3d; integration: a CD1-produced verdict and skip record pass the gate; stats line exact; docs + doc tests. |

All Tier 3: CD1 is a data-disclosure boundary (irreversible — whatever
reaches Codex has left the machine); CD2–CD4 change the gate or its mirror
(critical globs `swarm/**`, `dashboard/lib/**`). Per CLAUDE.md (#39), each
task gets a `surface-census` pass on its draft brief + draft `accept.sh`
before dispatch, and each oracle is validated at both ends. CD1 ∥ CD2; then
CD3; then CD4 (shared files).

Final pass: the trial's first real use is this run's own CD4 — Codex runs
alongside `checker-second` on CD4's result (its PASS never counts, per D2, so
it cannot vouch for itself). `run_tests.sh` ALL PASS; dashboard tests;
`gate.sh stats` verbatim; `gate.sh done`.

## 5. Downloads this run needs (explicit approval requested with sign-off)

| What | Source | Approx. size |
|---|---|---|
| `golang:1.26-bookworm` image | Docker Hub (official) | ~300 MB compressed |
| `debian:bookworm-slim` image | Docker Hub (official) | ~30 MB |
| `nodejs python3 git rsync ca-certificates tinyproxy` | deb.debian.org, at image build | ~100 MB |

Nothing is installed on the host; images are built locally and tagged
`agents2-codex-check:<sha>` / `agents2-codex-proxy:<sha>`.

## 6. Critical globs (`.swarm/critical.globs`)

```
swarm/**
dashboard/lib/**
.claude/agents/**
CLAUDE.md
TIERS.md
```

## 7. Out of scope

- The stale Codex-as-lead port (`~/work/agents2/AGENTS.md`, `.codex/`) and
  the user's global `~/.codex/AGENTS.md` / `config.toml`: untouched (the
  private `CODEX_HOME` makes them irrelevant to the checker).
- Upgrading npm's Codex (0.159.1 is broken on Linux).
- Promoting Codex beyond the trial rule — decided after the trial by the
  attribution data.

## 8. Rulings

- **CD-a — CD2 brief/oracle reconciled with surface census CD2.1
  (mechanism: census, pre-dispatch).** No contradicted claim; no existing
  fixture uses a now-invalid pairing (702 verdict files scanned). Oracle
  widened for the census's gaps: allow-list vs deny-list identities and exact
  boundaries (`worker-coder`, `lead`, bare `checker`/`judge`, `boss-2`,
  `Boss`), a valid boss UPHOLD at the current attempt, the message naming
  both fields, and gate-only probes of `escalate-scan` (a checker-cast
  OVERRULE no longer sets a FAIL aside; a judge-cast FAIL no longer counts),
  `stats` and `done`. Re-validated both ends: base → D 6/20 + E1–E4 fail;
  prototype → `ORACLE PASS`. Brief gained the consumer list and the two
  pre-existing gate/dashboard splits to keep out of scenarios.
- **CD-b — the lead's CD1 prototype leaked 72 Docker images (mechanism:
  census).** Compose names images per project, so one-project-per-run built
  a new image pair every run. Cleaned (`codexchk-*`, 72 removed). The brief
  now fixes image names (`agents2-codex-check:local`,
  `agents2-codex-proxy:local`) and the oracle counts images before/after.
- **CD-c — CD1 exclusions and prompt (mechanism: census).** `curl` added to
  the checker image (the oracle probes need it; SPEC §3a omitted it).
  Exclusions widened: basename `.env*` (was `.env`/`.env.*`), segment
  `.agents` (Codex reads `.agents/skills`), a FILE named `data`. The copy
  omits files agents2's own suites require (`.claude/agents/*`,
  `.env.example`), so a Codex FAIL — which counts under D2 — could be a
  copy artefact: the prompt now carries an "About this copy" section listing
  every exclusion and declaring such failures artefacts.
- **CD-d — never mount the whole Go module cache (mechanism: census).** The
  host cache (9.6 GB) holds records of the user's own modules
  (`dgallion1/docgest`, `pathstore`); a Go target now gets a per-run subset
  built by `go mod download` from the host cache as a `file://` proxy.
- **CD-e — outputs, re-runs and classification (mechanism: census).**
  `auth.json` is mounted rw into a container with Codex's sandbox bypassed,
  and `.swarm/codex/**` is an archive candidate in a PUBLIC repo: any
  auth secret in `last.json` → skip `secret-leak`, and every occurrence in
  the audit files is redacted. An existing verdict is never replaced (a
  re-run cannot launder a Codex FAIL; a new attempt is needed); a skip is.
  Failure classification reads only error events and stderr (repo text read
  by Codex may contain "quota"). New skip reasons `no-codex`,
  `container-error`, `secret-leak`; CD4's recognised list follows the CD1
  brief. Sidecar grammar pinned to the gate's; symlink, path, fingerprint,
  schema and classification edge cases added to the oracle; the proxy is
  probed for lookalike hosts, port 80, plain HTTP and each allowed host; the
  host-reachability probe gets a positive control (an oracle-owned
  listener). The brief (`.swarm/briefs/CD1.1.md`) supersedes §3a's detail.
- **CD-f — live calibration with the real Codex (mechanism: oracle pass-end
  live run, lead, pre-dispatch).** One real `gpt-6-astra` run through the
  prototype on a two-line fixture: the only allowlisted host it needed was
  `chatgpt.com`; it also tried `ab.chatgpt.com` (telemetry) and three
  `*.oaiusercontent.com` hosts — all refused, the run unaffected, so the
  allowlist stands. But it returned **FAIL** on correct code: the bundled
  CLI runs every command through `codex-code-mode-host`, which sits beside
  the binary and was not mounted, so no command could run — and under D2
  that FAIL would have counted. Fixed in the brief: mount the helper (ro);
  an error event saying tools are unavailable → skip `codex-error`, never a
  verdict. Re-run: PASS with executed evidence (`python3` asserts, exit 0);
  `~/.codex/auth.json` byte-identical before/after both runs.
- **CD-g — fixed image names must be rebuilt every run (mechanism: oracle
  fail-end calibration, lead).** Running the broken variants in parallel,
  the permissive-proxy variant's image, built under the fixed tag
  `agents2-codex-proxy:local`, was then used by the parallel runs — the same
  way a stale or foreign image would silently decide the isolation for a
  harness that builds only when the tag is missing. Brief: rebuild both
  images (layer-cached) at the start of every run. Oracle: tags an image
  without tinyproxy under the proxy's name before the runs. Variants
  re-run one at a time. The same calibration caught two oracle probes
  passing for the WRONG reason: curl ignores uppercase `HTTP_PROXY` for
  `http://` URLs, so the port-80 and plain-HTTP probes never reached the
  proxy and 'passed' only because the internal network has no route — the
  normal-network variant exposed it. The stub now names the proxy for both.
- **CD-h — CD2 accepted at attempt 1 (both gates: post-CD2 and master
  12f6413).** checker-tests PASS: 25 mutants all caught (the walk-only
  mutant passes the differential 20/20 and is caught only by the census-added
  E1–E3 escalate/stats probes — the census earned its keep); a 156-file
  identity×verdict sweep and an 840-row consequence harness, 0
  disagreements. checker-second PASS: ~25 mutants, 702 real verdict files
  and 32 swarm dirs behave identically under base and new. Observations
  (backlog, test-only): case-insensitive `checker-`/`judge-` and a
  task/attempt-less `load_verdict` call path are unpinned by shipped tests
  (the code is right); pre-existing header-parse splits confirmed.
- **CD-i — CD3 brief/oracle reconciled with surface census CD3.1
  (mechanism: census, pre-dispatch).** No contradicted claim; eight
  semantics pinned that the brief left open — evaluation order (unstarted
  rows never flagged), what PRESENT means (dangling links, FIFOs never
  opened), explicit UTF-8 (the gate's python decoded by locale: a valid
  UTF-8 path failed under `LC_ALL=C`), unreadable-beats-hit, evaluator
  failure (python3 missing/killed) is unreadable, the diagnostic contract,
  and `parse()` must not throw on an unreadable CURRENT manifest (it
  rethrew → HTTP 500). Oracle widened to match (tier 1, `done`,
  escalate-scan per input kind, locale, FIFO/dangling link, python shim,
  silence on clean inputs, stale comments, mutation checks pinned to the
  new tests). CD4 docs gain the rule (G14).
- **CD-j — CD1 attempt 1 FAIL, conceded: secret hygiene (mechanism: second
  checker).** F1a: redaction skipped any audit file it could not open, so a
  secret Codex wrote to a read-only file or a mode-000 folder under `out/`
  survived. F1b: the brief mounted `auth.json` READ-WRITE (lead's contract,
  meant for token refresh) and the secret set was read after the run — a
  container that truncated the file defeated both redaction and the
  `secret-leak` check, and in the checker's repro left a `VERDICT: PASS`
  file holding the full token and the HOST auth file at 0 bytes (the
  user's real login, had it been real). Contract rewrite for attempt 2:
  auth mounted READ-ONLY (a stale token just yields skip `auth`, which
  never blocks); the secret set taken before the run; the audit dir made
  owner-writable before redaction and any file still holding a secret or
  not rewritable deleted; and a PASS/FAIL inconsistent with its criteria
  (checker observation) → `schema-invalid`. Oracle extended (auth read-only,
  truncation attempt, read-only/locked leak files, consistency, and the
  lookalike refusal visible in the proxy log — the checker showed the old
  probe could not tell an unanchored filter). Re-validated both ends
  before resuming the worker.
- **CD-k — CD3 accepted at attempt 1 (both gates).** checker-tests PASS: 11
  mutants all caught; a 1,131-assertion unreadable-input matrix and 29 clean
  fixtures byte-identical to base; the old `parse()` hung forever on a FIFO
  current manifest (fixed as a side effect). checker-second PASS: ~75
  hand-built fixtures and a 1,000-fixture randomised differential, 0
  disagreements, 0 hangs; the worker's extension (an unlistable
  `manifests/` is unreadable) judged compatible hardening by both lanes.
  Backlog: a manifest whose NAME is invalid UTF-8 splits gate/dashboard in
  the conservative direction; untested dangling/looping `test.globs` and
  the evaluator's outer `except`; `parse()` still throws on a directory
  flag, mode-000 verdicts/dir and a directory oracle log (pre-existing);
  an unlistable `manifests/` flags unstarted rows too (letter of pinned
  semantic 1, corrupt layouts only).
- **CD-l — CD1 attempt 1 FAIL, conceded: the container could reach the host
  (mechanism: primary checker).** An `internal: true` Docker network still
  gives the HOST an address on its bridge (the gateway, e.g. 172.26.0.1).
  From inside the checker the primary checker reached a host listener
  through it and opened TCP to budget2's live :8080 (budget2 binds `*`) —
  Codex could have read live household data and sent it out, defeating D3.
  A lead contract defect (the lead assumed internal = host-isolated), and
  a lead ORACLE defect: its "host unreachable" probe hit only 172.17.0.1
  (docker0, not even on the checker's network) — passing for the wrong
  reason. Spike (lead, 2026-09-29): with
  `com.docker.network.bridge.inhibit_ipv4=true` the host has no address
  on the bridge; the gateway address, LAN, tailnet and bridge addresses
  and :8080 all unreachable, while a plain internal network reproduces
  the defect. Brief and oracle updated (every host IPv4 + the subnet .1,
  raw TCP on the listener port and 8080, with a host-side positive
  control); re-validated both ends before resuming. The primary checker
  independently reproduced both CD-j defects.
- **Process lesson (lead):** the lead rewrote the CD1 brief and oracle in
  place WHILE both CD1 checkers were running them (bash reads scripts as it
  runs; the primary checker had to discard its later mutant runs). Never
  edit an oracle or brief a verdict is being produced against; write the
  next attempt's versions after the verdicts land, or beside them.
- **CD-m — CD1 attempt 2 FAIL → HARD STOP (mechanism: primary checker).**
  An auth token Codex writes under `out/` at a host path longer than
  PATH_MAX (25 nested 200-char dirs) survives: `tools.py sweep()` swallows
  `ENAMETOOLONG` from `lstat`, skips the entry, reports "clean", and the
  harness writes `VERDICT: PASS`. Everything else held — host isolation
  (all 12 host IPv4s, IPv6 incl. link-local, every bridge .1: unreachable;
  the proxy refuses every IP literal), read-only auth. Same defect CLASS as
  CD-j F1a (scrubbing a tree the attacker controls), so per CLAUDE.md this
  is a lead/spec defect: the contract asked the harness to scrub arbitrary
  Codex-written files. Two failed Tier-3 attempts: CD1 halted, reported to
  the user for a decision. Oracle gaps the checker found: dropping the
  pre-run snapshot survives the oracle while auth is read-only; each half of
  chmod/delete-on-failure alone survives; no deep-path case. Both lanes'
  observation: a read-only auth file cannot stop the real Codex spending a
  refresh token inside the container (possible stale host login).
- **CD-n — user reopens CD1 (2026-09-30): "Reopen: stop scrubbing".** The
  attempt-2 second checker also FAILed in the same class: a signal during
  cleanup (`trap -` first) leaves the token in `events.jsonl`/`out/` and a
  copy of the auth file in the temp dir, and a re-run can never clean it
  (the verdict exists); DETAIL truncated before redaction (205 secret
  chars); escaped-key and encoded forms unredacted; container-planted
  symlinks to host paths survive in `out/`. Attempt-3 scope (explicit, per
  the 2026-08-29c/d reopen precedent): (1) the container writes to a
  PRIVATE output dir; only flat, small, regular files are copied into the
  audit dir, and only if they contain no secret in any recognised form —
  a file holding a secret is deleted, never redacted; everything else is
  discarded; (2) no secret ever on disk (the pre-run set lives in memory);
  (3) skip DETAILs are fixed per-reason text, never Codex's words; (4)
  cleanup ignores further signals; (5) a pre-run freshness gate: a login
  near refresh → skip `auth` before any container starts, so Codex never
  rotates the user's refresh token inside it. Fresh census; oracle
  re-validated both ends; the same worker resumed (it holds the code).
- **CD-o — CD1 attempt-3 brief and oracle reconciled with surface census
  CD1.3 (mechanism: census, pre-dispatch).** Contradictions in the lead's
  draft: "everything else unchanged" (the redaction machinery, DETAIL
  producers and `smoketest/codex` all change); SIGKILL can also leave the
  compose project; the audit dir's harness-written files were described as
  checked; secrets in FILE NAMES and dotfiles (`.git`) were not covered;
  DETAILs also carried host paths, docker/go stderr, symlink targets and
  sidecar lines; exit 1 undefined. Four lead ORACLE checks were vacuous:
  the deep-path attack never planted a file (the absolute path itself was
  too long), the "no on-disk auth copy" check ran after the temp dirs were
  gone, the TERM/KILL checks fired on timing guesses before any secret
  existed, and the leftover-container count was masked by the oracle's own
  kill-case sweep. Brief pins the name rule, order/limits, 16 MiB log cap,
  repeated decoding, empty-secret-set → skip `auth`, the `Z` timestamp,
  exit codes, the DETAIL rule, cleanup ordering, and a schema-only
  `/schema` mount. Oracle rebuilt accordingly (planted-then-signalled,
  during-run temp-dir scan, name secrets, boundaries, forms, proxy-log
  secret, mount source, exit 1, existing-verdict audit untouched).
- **CD-n clarification:** "no secret ever on disk" means no copy of the
  AUTH file's secrets written by the harness; Codex-written files in the
  private temp dir may hold secrets until cleanup (or after a SIGKILL).
- **CD-p — CD4 brief/oracle reconciled with surface census CD4.1
  (mechanism: census, pre-dispatch).** Contradictions in the lead's rules:
  "a Codex PASS never satisfies anything" vs "a verdict satisfies the
  evidence requirement"; "unnamed Codex files as today" vs "a PASS never
  counts"; lane exclusion keyed on FAMILY or CHECKER (and `crossvendor`
  would have become valid on ANY verdict). Pinned: crossvendor ⇔
  checker-codex; evidence = presence at the CURRENT attempt, first-match
  headers, 15 reasons, both-files refused, evidence before PASS/dispute
  logic; a Codex PASS never counts anywhere; a Codex FAIL counts wherever
  loaded; stats field placement, pair range and arithmetic; dashboard
  `familiesPassed`; the doc statements the lane falsifies. Oracle gaps
  fixed: a vacuous territory check (missing base file), wrap-blind and
  pre-satisfied doc greps, most reject scenarios passing at the pre-CD4
  gate for the wrong reason (invalid FAMILY), 1 of 15 skip reasons, thin
  tier-1/tier-3/stale-attempt/lane-span/done/stats coverage.
- **CD4's own acceptance (lead decision):** master's gate treats
  `crossvendor` as invalid, so a real Codex verdict in CD4's own `.swarm`
  would make the master gate refuse CD4. CD4's ledger row stays
  `tests,second`; the trial's first real use runs Codex on CD4's accepted
  result in a COPY of `.swarm` (`.swarm-codex-trial/`), evaluated there by
  the new gate, and its outcome is recorded as a trial observation.
- **Census observation for the user (not a blocker):** a data-free copy of
  budget2 still contains names and figures in tracked tests and docs, and
  agents2's copy contains `docs/runs/**` (names, balances, screenshots). All
  of it is already public on GitHub. Runs over agents2 should list
  `docs/runs/` and `*.png` in `codex.exclude`; CD4's docs say so, and say
  `.swarm/codex/**` is not archived to `docs/runs/` verbatim.
- **CD4 oracle validated at both ends (2026-09-30, mechanism: census →
  oracle).** Oracle rebuilt per census CD4.1: 56 differential scenarios
  (tiers 1–3, all 15 skip reasons, stale attempt, TASK/ATTEMPT/DETAIL
  defects, dir/FIFO/mode-000 skip records, first-match headers, lane span,
  pairing both ways, FAIL-overruled-but-no-evidence, `done` = `check`,
  dashboard `familiesPassed`, no "invalid FAMILY" on valid identities),
  a stats fixture (FAIL/FAIL, codex-only FAIL, invalid skip, verdict over
  skip, no-change excluded — rule 7 amended to say so), whitespace-normalised
  doc checks F1–F22, doc_test pins proven against `base-docs/` (F24), and a
  territory check that also refuses new files (`mkbase.sh` regenerates
  `base.sha256` once CD1 is accepted). Fail end on the pre-CD4 tree:
  `calibration-fail.log`, 40 FAIL, the 8 passing checks all non-discriminating
  by design (differential: only X17/X18/X35 pass, the behaviours CD4 keeps).
  Pass end on a throwaway lead prototype: `calibration-pass.log`, 48 ok,
  ORACLE PASS; the prototype was discarded.
- **CD-q — CD1 attempt 3 FAIL in both lanes → HARD STOP again (3 failed
  Tier-3 attempts).** The attempt-3 redesign ("stop scrubbing") held under
  heavy attack: both lanes re-ran the oracle (160 ok / 159 ok, ORACLE PASS);
  8 mutants of the attempt-3 rules were all killed by the oracle; a 9,238-body
  escaped-JSON differential, 794 TOCTOU races, 264 single-PID signal timings,
  host/LAN reach, and 20 writes against the auth file found nothing. Three
  small, local defects remain:
  - F1 (mechanism: primary checker; also an observation of the second
    checker): `codex-check.sh` `pys()` runs `env CD_SECRETS=<secrets> …`,
    so the auth secrets sit in `/usr/bin/env`'s argv (world-readable
    `/proc/<pid>/cmdline`; a /proc poller caught the access and refresh
    tokens in 1 of 6 runs). Violates step 7 "only via environment or pipes".
    Fix verified by the checker: a bash prefix assignment.
  - F2 (primary checker; also a second-checker observation; LEAD share):
    the `noline` fingerprint-mismatch DETAIL echoes a worker-written
    manifest path before the absolute/`..` check, e.g. `$HOME/.codex/auth.json`
    or `../../etc/shadow`. Violates "never host absolute paths"; the brief's
    own regex `^[A-Za-z0-9._/-]{1,200}$` admits a leading `/` and `..`, and
    the oracle never tried either.
  - G1 (mechanism: second checker): cleanup's `trap '' INT TERM HUP` does
    not protect the docker CLI — Go re-arms INT/TERM — so a fast repeated
    PROCESS-GROUP signal during `compose down` leaves one `<project>_isolated`
    network (7/7 with 3×TERM 0.4 s apart). Violates step 4 "torn down on
    every exit path" and reopen item (4). Low severity; fix verified by the
    checker: the teardown docker calls under `setsid -w`.
  - F3 (primary, minor): Codex doing `chmod 000 /out` after writing a valid
    `last.json` gives skip `codex-error` rather than the no-last.json path.
  Oracle gaps (lead): argv exposure, absolute/`..` manifest paths in DETAIL,
  group-delivered signals, leading-dot names and single-pass escape decoding
  (the last two are caught by the worker's own tests). Backlog observations:
  `dropped.txt` unbounded; duplicate-key auth JSON keeps only the last value;
  a >64 KiB here-string spills to `$TMPDIR` (unreachable with a real
  auth.json); interrupted runs exit 129/130/143 (the Interface lists 0/1/2);
  exclusion is by name, so a hard link under another name is copied.
  Reported to the user for a decision.
- **CD-r — user reopens CD1 again (2026-09-30): "Reopen: these 3 only".**
  Attempt-4 scope, explicit (reopen precedent 2026-08-29c/d): F1, F2, G1
  and the F3 label fix — nothing else (brief `.swarm/briefs/CD1.4.md`,
  amending CD1.3). The lead's share of F2 is corrected in the brief: the
  DETAIL path rule is now `^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`, ≤200
  bytes, no `.`/`..` segment, no secret, enforced at the single choke point.
  Oracle A4 additions: a strace'd run (no secret in any argv), four
  absolute/escaping manifest-path DETAIL cases, two process-group signal
  barrages with a project-scoped leftover check, and a `lockout` stub
  scenario (valid last.json, then `/out` mode 000). Fresh census CD1.4;
  oracle re-validated at both ends before dispatch; the attempt-3 worker is
  resumed. Any further FAIL is a final hard stop reported to the user.
- **CD-s — CD1 attempt-4 brief and oracle reconciled with surface census
  CD1.4 (mechanism: census, pre-dispatch).** CONTRADICTED, upheld:
  (1) the brief's item-3 oracle sentence no longer matched the oracle;
  (2) item 4 had drifted past the user's "chmod-000 LABEL fix": the
  attempt-3 checker framed F3's correct outcome as last.json-present →
  step 7 → `schema-invalid`; the draft restored `/out`'s mode instead,
  which would turn the case into a verdict. Item 4 is now the label fix:
  an unsearchable private output dir means last.json counts as present
  (→ `schema-invalid`), and no chmod of `/out`. Unlisted consumers added to
  the brief: `missing`/`drift`/`deletedexists` echo the RAW manifest path
  (not only `noline`); `compose()` is a bash function (`setsid -w compose`
  runs nothing); `stop_container` also runs in the main flow; a missing
  `setsid` must fall back, never skip teardown; a global `export` of the
  secrets would hand them to docker/go/Codex. Oracle gaps closed: strace
  now `-v` with execve+execveat, argv and env checked separately by
  `argv-env-check.py` (with a -v positive control); six more DETAIL shapes
  via `missing`/`drift`/`noline` (inner `..`, `./`, `//`, trailing slash,
  201 bytes, secret); three group barrages with "exactly one project",
  "compose down seen" and the run's own outcome/exit code asserted;
  `lockout` now expects `schema-invalid`. The first A4 group-signal cases
  did not reproduce G1 at the fail end (they fired before teardown) —
  caught by the lead's own fail-end calibration and redesigned to fire
  during this project's `compose … down`, where attempt-3 code now leaks
  (2/2) and the prototype does not.
- **CD1 attempt-4 oracle validated at both ends (2026-09-30).** Fail end
  (attempt-3 code): `calibration-a4-fail.log`, 13 FAIL — every one the
  intended defect (argv `env`, 8 DETAIL-path shapes + the DETAIL sweep,
  barrages (i)/(ii) leave a network, `lockout` → codex-error); barrage (iii),
  the 201-byte and secret-path cases pass there by design (boundaries
  attempt 3 already held). Pass end on a throwaway lead prototype:
  `calibration-a4-pass.log`, 193 ok, ORACLE PASS. Mutants: a main-flow
  `export` of the secrets, a noline-only path fix, and the pre-census
  mode-restore each fail exactly their intended check
  (`calibration-a4-mut{A,B,C}.log`). Prototype and mutants discarded.
- **CD-t — CD1 attempt 4: one disclosed change beyond the four items,
  accepted (lead over-specification; found by the worker's own test).** The
  brief/oracle pinned barrage (iii) (INT, then TERM×3 0.1 s later, to the
  group) to exit 130. Attempt-3's `wait "$RUNPID"` lets a TERM that becomes
  pending while bash is in `wait` run its trap first (worker: TERM-first
  10/12 with a bare `wait`, INT-first 12/12 with a poll loop), so exit 143
  ~5 of 6 runs — the lead's prototype passed (iii) once by luck. The
  worker replaced the main-flow `wait "$RUNPID"` with a `kill -0` poll
  (`sleep 0.2`) followed by a status-collecting `wait`. It serves an
  explicit brief outcome, so it is in scope for attempt 4; checkers are told
  of it by name and verify it is behaviour-preserving apart from signal
  ordering and ≤0.2 s latency.
- **CD-u — CD1 ACCEPTED at attempt 4 (2026-09-30), both lanes PASS, both
  gates.** Tree gate and master gate (12f6413): `OK: CD1 accepted at tier 3
  (attempt 4)`. checker-tests: oracle 193+1 (territory run read-only on the
  real tree), unit 141 / full 297 ALL PASS; argv/env parsed independently
  (387 and 407 execs); 37 path shapes (21 fail on attempt-3 tools.py);
  strace shows every teardown docker exec after `setsid()`; a sustained
  30 ms group barrage through all of cleanup: 0 leftovers (attempt 3 leaks
  under the same probe); CD-t: statuses and watchdog identical to a bare
  `wait`. checker-second: 12 post-run call phases barraged via a Go-like
  fake docker; `/out` modes 000–700; wait-loop 24/24 and 20/20 exit 130.
  Backlog observations (not graded): a caller-exported `SECRETS_JSON`/`res`/
  `r1` keeps its export attribute and would put the secrets in every child's
  environment (fix: `declare +x`/`unset` at the top); SIGQUIT untrapped;
  zero-gap INT→TERM still 143 in 3/30; the poll loop forks `sleep` 5×/s;
  shield detection needs `/usr/bin/true`; a caller whose SIGINT is ignored
  at entry (non-interactive `cmd &`) cannot trap INT — the oracle's
  `( exec setsid … ) &` launch is the valid form; the worker's absolute-path
  unit test is weak when TMPDIR is >200 bytes. Attempts: 4 (3 failed; two
  user reopens). First-attempt: failed.
- **CD-v — Codex trial model switched to `gpt-6-sol` (user decision,
  2026-09-30; relayed by the VN session, confirmed by the user in this
  session).** D4's `gpt-6-astra` is replaced BEFORE the first counted Codex
  verdict (none existed), so no model change mixes into the trial data. The
  bundled CLI is now `codex-cli 0.159.0` (updated 2026-09-29 12:13), not
  0.155.0-alpha.16. The harness default (accepted CD1 code) stays; the
  trial passes `CODEX_MODEL=gpt-6-sol`, and each verdict records
  `CODEX_MODEL`/`CODEX_VERSION`. One live calibration re-run on
  sol/0.159.0 precedes the first counted run. Host note (VN session, user's
  OK): `~/.codex/config.toml` lost `[features].use_legacy_landlock`; CD1
  uses a private CODEX_HOME, so the harness is unaffected.
- **CD-w — CD4 attempt 1 FAIL in both lanes (mechanism: primary checker AND
  second checker, same defect; LEAD share: the oracle had no non-ASCII or
  multi-locale fixture).** (d)/rule 8: `gate.sh skip_field` strips with
  `sed [[:space:]]` in the CALLER's locale — under UTF-8 glibc it strips
  U+2003 etc. — while `parse.mjs skipField` strips ASCII only. Repro (lead
  re-ran it): `DETAIL:<U+2003>` → gate refuses under en_US.UTF-8, accepts
  under C, dashboard `accepted`; `REASON:<U+2003>quota` splits the other way.
  The gate's own answer depends on the locale. Primary also: tier 1, codex
  named, a valid skip plus a dangling-symlink `checker-codex.verdict` → gate
  accepts (treats it as absent), dashboard blocks. (f): the new CLAUDE.md
  bullet puts "(at Tier 1 only when named)" over escalation and stats too,
  but an unnamed Tier-1 Codex FAIL still counts toward two consecutive fails
  and in stats (like any unnamed checker FAIL). Mutation survivors (test
  gaps): stats pairs starting at attempt 1 (no attempt-0 fixture); the
  dashboard's NUL check (the only NUL test puts it inside REASON); an
  invalid `checker-second` beside a Codex outcome in stats; tier-1 invalid
  Codex verdict + valid skip. Conceded (no panel). Backlog, pre-existing or
  foreign: a trailing comma in the checks column splits gate/dashboard (also
  in base); `FAMILY: x ` trailing space splits (CD-h class, also in base);
  `swarm/codex-check.sh`'s header still says "only after task CD4";
  `swarm/start.sh` still says "no second vendor".
- **CD-v calibration (2026-09-30, lead, live).** One real run through the
  accepted harness on a two-line fixture with `CODEX_MODEL=gpt-6-sol`:
  VERDICT PASS with executed evidence (`python3` asserts, exit 0), headers
  `CODEX_MODEL: gpt-6-sol`, `CODEX_VERSION: codex-cli 0.159.0`;
  `~/.codex/auth.json` byte-identical before/after; proxy log: 16× CONNECT
  `chatgpt.com` allowed, `ab.chatgpt.com` and three `*.oaiusercontent.com`
  refused with the run unaffected (as in CD-f); no Docker leftovers. The
  trial counts from here on sol/0.159.0.
- **CD-x — CD4 attempt-2 brief and oracle reconciled with surface census
  CD4.2 (mechanism: census, pre-dispatch).** CONTRADICTED, upheld: the
  draft's item 2 said the dashboard "already" treats a non-regular Codex
  verdict entry as invalid — false: `parseAllVerdicts` opens every
  `*.verdict` entry and swallows only ENOENT, so a directory, a symlink loop
  or a mode-000 entry makes `parse()` THROW and a FIFO makes it HANG, for any
  checker (pre-existing, surfaced by item 2). Item 2 now covers the
  dashboard: never open a non-regular entry, never throw or hang; such an
  entry, or an unreadable one, is an invalid verdict file. The draft oracle
  could not have passed a gate-only fix (X42 throws, X44 hangs the whole
  battery — which is what stalled the lead's first re-validation). M-e
  reworded (the attempt-1 tree already IS that mutant; the test sets its own
  UTF-8 locale); M-f added. Item 3 now also names TIERS.md and a parse.mjs
  comment. Ruled OUT of scope: verdict-HEADER parsing (gate `field_of` in the
  caller's locale and first-match vs the dashboard's Unicode `.trim()` and
  last-match) — pre-existing CD-h class for every checker, backlog. Oracle:
  `parse()` now runs in a child with a 20 s timeout; +12 scenarios (X37b–X49:
  leading VT, trailing U+2003, `ATTEMPT:<U+2003>`, dangling/loop/mode-000
  Codex verdicts at tier 1, non-regular entries at tiers 2/3 for Codex and
  another checker); X41–X44 fragments tightened to `invalid verdict
  checker-codex`; the stats fixture gains a U+2003 skip (s12) so its
  C-vs-UTF-8 identity check can fail; F25/F26 pin item 3's sentence.
- **CD4 attempt-2 oracle validated at three points (2026-09-30).** Pre-CD4
  gate/parse: differential 5/79 (`calibration-a2-pre-diff.log`). Attempt-1
  tree: ORACLE FAIL, 6 checks — 16 differential scenarios (locale splits
  X37–X40b/X39b, the dangling-link split X41, the wrong refusal X41b, parse()
  THREW on X42/X42b/X43b/X42c/X47/X49, HUNG on X44/X44c/X48), T s12 + summary
  + C-vs-UTF-8 identity, F25, F26 — every one the intended defect
  (`calibration-a2-fail.log`). Throwaway prototype (gate `LC_ALL=C sed`,
  `-e||-L` at tier 1, a parse guard, the corrected CLAUDE.md bullet): ORACLE
  PASS, 54 ok (`calibration-a2-pass.log`); discarded.
- **CD-y — CD4 ACCEPTED at attempt 2 (2026-09-30), both lanes PASS, both
  gates.** Tree gate and master gate (12f6413): `OK: CD4 accepted at tier 3
  (attempt 2)`. checker-tests: oracle 54/54; 622 smoketests and 126
  dashboard tests under en_US and C; its own harness — 936-row grid and 1,200
  random rows under three locales, 0 mismatches outside two pre-existing
  classes; stats byte-identical across locales; `done`=`check` on 240
  ledgers; the real harness + stub at tiers 1–3; doc_test pins fail on the
  base docs (29) and on the attempt-1 wording (4); each of M-a…M-f killed
  under an en_US AND a C caller. checker-second: ~1,500 fuzzed scenarios
  across both skip and verdict-entry shapes, 0 splits; a FIFO/regular-file
  rename race against `parse()` 150×: 0 hangs; M-a…M-f plus 10 own mutants
  killed (one equivalent survivor). Backlog findings (pre-existing, both
  reproduce on the pre-CD4 gate/parse; not CD4's): F-1 tier 1 — the
  dashboard applies the judge-identity check (`duplicate judge family`)
  where the gate reads neither judge files nor unnamed checker files, so an
  unnamed FAIL + same-family judges blocks on the dashboard while the gate
  accepts (dashboard errs safe); F-2 tiers 2/3, no FAIL — duplicate-family
  judge files make the gate refuse while the dashboard accepts. Plus: verdict
  -header parsing (CD-h class), the trailing-comma checks split,
  `codex-check.sh` "only after task CD4", `start.sh` "no second vendor", a
  per-case mktemp leak in `newswarm`. First attempt: failed.
- **CD-z — the Codex trial's first counted run: CD4 attempt 2 → Codex FAIL,
  a CODEX-ONLY catch (mechanism: codex), verified by the lead.** Run in the
  copy `.swarm-codex-trial/` (ledger CD4 → `tests,second,codex`; exclude
  `docs/runs/`, `*.png`; criteria = the Claude checkers' criteria, trimmed
  to what is checkable in the copy, no census) with `gpt-6-sol`,
  `codex-cli 0.159.0`; auth file unchanged; no Docker leftovers. Codex
  PASSed (b), (c), (d.1–9), (f) with executed evidence and FAILed (i): a
  mutation that removes `readVerdictEntry`'s pre-open `statSync().isFile()`
  guard but keeps the O_NONBLOCK open + fstat check opens a FIFO verdict
  entry (brief item 2b: "must never open a non-regular entry"), yet the
  shipped dashboard suite stays 126/126. Lead repro on a full-tree copy:
  126/126 pass; an fs.openSync counter shows the mutant opens the FIFO once,
  the shipped code zero times; both still classify it `blocked`. Verdict
  of the lead: the claim is TRUE; it is a TEST gap (the "never opens"
  property is unpinned — the tests pin only no-throw/no-hang), the code is
  correct, and the behavioural impact of the mutant is nil apart from
  opening a FIFO (which could wake a blocked writer). Neither Claude lane
  found it (checker-second's own mutation set missed this variant). The new
  gate on the trial copy: `FAIL: CD4: dispute needs >=3 judge verdicts, have
  0`; `gate.sh stats` there: `codex: ran 1/1, FAIL 1, same-verdict-as-second
  0, codex-only FAIL 1`. Codex's observation (`done` skips the live re-hash)
  is documented behaviour. Decision on CD4 put to the user (the real
  ledger's CD4 row does not name codex, by the CD-p design).
- **CD-aa — user reopens CD4 (2026-09-30): "Reopen CD4: add that test".**
  The trial rule is honoured: the codex-only FAIL (CD-z) is treated as
  counting. Attempt-3 scope, explicit: ONE dashboard test proving `parse()`
  never opens a non-regular `*.verdict` entry, so Codex's mutant dies;
  plus oracle checks; nothing else (brief `.swarm/briefs/CD4.3.md`). Only
  `dashboard/test/parse.test.mjs` may change. Same worker resumed; fresh
  checkers; then the Codex check re-runs in a fresh trial copy at attempt 3.
- **CD-ab — CD4 attempt-3 brief and oracle reconciled with surface census
  CD4.3 (mechanism: census, pre-dispatch).** Upheld: (1) `parseCodexSkip`
  has the identical pre-open guard and the identical untested gap (removing
  it keeps the suite 126/126) — it is CD4's own surface (rule 3 "never
  opened"), so the one test also covers the skip record; `readPyLines`
  (CD3's globs reader, same gap) → backlog. (2) Kinds: a guard narrowed to
  `isFIFO()||isDirectory()` passes all five draft kinds but opens a symlink
  to `/dev/null` → kinds are now seven (+ symlink→directory, symlink→device;
  never a mode-000 regular file, which is opened by design). (3) An ESM child
  that imports `fs` before patching misses named-import openers → the test's
  child is pinned to a CommonJS `node -e` that patches, calls
  `syncBuiltinESMExports()`, then imports. (4) N0 only hashed the 11
  CD4.2 paths → it now covers a 42-file snapshot of the whole territory
  (`a2-territory.sha256`) plus a no-new-files check. Oracle: `never-open.mjs`
  probes 7 kinds × {verdict, skip}; N2/N3/N4 each apply one mutation (m1 guard
  removed, m2 guard narrowed, m3 skip guard removed) and require a failing
  `never opens` test. Not pinned (unreachable with static fixtures): a
  stat→open swap, and dropping O_NONBLOCK or the fstat re-check.
- **CD4 attempt-3 oracle validated at both ends (2026-09-30).** Attempt-2
  tree: ORACLE FAIL, exactly N2/N3/N4 (each mutant leaves the suite at
  fail=0 — the gap Codex found); N0/N1 pass (`calibration-a3-fail.log`).
  Throwaway prototype (one 7-kind × {verdict, skip} `never opens` test in a
  CJS child): ORACLE PASS (`calibration-a3-pass.log`); discarded.
- **CD-ac — CD4 ACCEPTED at attempt 3 (2026-09-30), both lanes PASS, both
  gates.** Tree gate and master gate (12f6413): `OK: CD4 accepted at tier 3
  (attempt 3)`. Both lanes: oracle 59/59; 141 dashboard tests, 622
  smoketests; the change is a pure insertion into `parse.test.mjs`
  (deleting the block reproduces attempt 2's hash); m1/m2/m3 each fail
  exactly the intended `never opens` tests (7 / 1 / 7); the control test is
  what guards against a vacuous counter. ~46 own mutants across both lanes,
  all killed except (backlog, LEAD share — the brief's counting rule): a
  mutant that resolves a symlink and opens the TARGET evades a counter that
  matches the entry's own path (both lanes found it; fix: count by the type
  of each file `openSync` returns); a guard covering FIFO/dir/char-device
  only (sockets, block devices are not among the seven kinds); an
  `lstat`-for-`stat` guard refuses a symlink to a regular verdict that the
  gate accepts (no test pins it); the control test's name lacks `never
  opens`; `readPyLines` (CD3) has the same gap. CD4's attempts: 3 (attempt 1
  failed in both Claude lanes; attempt 2 passed both Claude lanes and failed
  the Codex lane — the run's one codex-only catch; attempt 3 accepted).
- **CD-ad — Codex trial, second counted run: CD4 attempt 3 → Codex PASS
  (gpt-6-sol, codex-cli 0.159.0).** Fresh trial copy (`.swarm-codex-trial/`,
  attempt-2 Codex verdict carried over for the stats); auth file
  unchanged; no Docker leftovers. Codex PASSed every criterion including the
  new (j) with its own scratch mutations (verdict guard removed → 7 fails,
  narrowed → 3, skip guard removed → 7). New gate on the trial copy:
  `OK: CD4 accepted at tier 3 (attempt 3)`. Trial measurement, verbatim:
  `codex: ran 2/2, FAIL 1, same-verdict-as-second 1, codex-only FAIL 1`.
  Codex observations: copy artefacts (`.claude/agents`, `.env.example` are
  excluded by design, so `agents_test`/`verify_layout` cannot pass inside
  the copy); mode-000 fixtures are moot as root inside the container.
  Trial read-out for the decision rule: in its two counted runs Codex found
  one real gap both Claude lanes missed (a test gap, low impact) and
  agreed with them once; no false FAIL.
