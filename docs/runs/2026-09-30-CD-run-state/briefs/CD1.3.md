# CD1 attempt 3 — the Codex check harness (Tier 3: a data-disclosure boundary)

**This brief supersedes CD1.1.md for attempt 3** (user reopen 2026-09-30,
SPEC ruling CD-n: "stop scrubbing"; reconciled with surface census CD1.3,
ruling CD-o). Changed from attempt 2: the Interface exit codes, the Audit
dir paragraph, a new step 1b, the `/out` and `/schema` mounts in step 4,
steps 5–8 where they touch outputs, a new step 7 (keep or drop — nothing
is redacted), the DETAIL rule, and "What must change in the code" below.
This brief supersedes SPEC §3a wherever they differ.

## What must change in the code (census CD1.3)
The whole secrets/redaction machinery (`tools.py` `secrets clean|scrub|text`,
`sweep`, `fix_perms`, `remove_path`, `clean_dir`, `scrub_audit`) is REPLACED
by step 7's keep-or-drop; the on-disk `auth.snapshot` goes; every DETAIL
producer in `codex-check.sh` and `tools.py` follows the DETAIL rule;
`teardown()` writes the proxy log into the private temp dir; the header
comments follow the new contract; and `smoketest/codex/` is rewritten to
the new contract (its stub writes flat `/out/<name>` records — the keep-list
drops subdirectories — and every redaction/`[REDACTED]`/scrub test becomes
a keep-or-drop test).

Run CD, agents2 worktree `/home/darrell/work/agents2/.claude/worktrees/unifi-camera-streaming-7be695`,
branch `claude/codex-checker-lane`, base 12f6413. SPEC.md §1 (decisions D1–D6),
§2 (probe findings), §3a (superseded where it differs), §8 rulings CD-a…CD-o.

## Territory (a concurrent task shares this tree)
CD1 creates/changes ONLY: `swarm/codex-check.sh`, `swarm/codex/**`,
`smoketest/codex/**`. Foreign (task CD2 and later tasks): `swarm/gate.sh`,
`dashboard/**`, `smoketest/gate/**`, everything else. `SPEC.md` is the lead's.
Do not add CD1's tests to `smoketest/gate/run_tests.sh` (offline, Docker-free).
Create test fixtures at test time — agents2's `.gitignore` ignores `.env*`,
so committed fixtures with such names would silently vanish.

## Interface
```
swarm/codex-check.sh <task> <attempt>          attempt: a non-negative integer
  SWARM_DIR     default .swarm        (the run's evidence dir)
  SWARM_TREE    default .             (the tree under verification; must be a git work tree)
  CODEX_BIN     default /usr/lib/chatgpt/resources/codex
  CODEX_MODEL   default gpt-6-astra
  CODEX_TIMEOUT default 1800          (seconds; bounds the Codex container run only)
  CODEX_AUTH    default $HOME/.codex/auth.json
exit 0 = handled (wrote one output file, or found an existing verdict — see below);
exit 1 = no outcome could be recorded (`verdicts/` cannot be created, or the skip
         record cannot be written);
exit 2 = usage error only (wrong arg count, non-integer attempt, task id not
         matching `^[A-Za-z0-9][A-Za-z0-9._-]*$`), writing nothing.
```
Output: exactly ONE of `$SWARM_DIR/verdicts/<t>.<a>.checker-codex.verdict` or
`…checker-codex.skip`. **An existing verdict for (t, a) is never replaced or
removed**: the script then writes nothing, says so on stderr, and exits 0 (a
re-check needs a new attempt — a FAIL is never laundered by re-running). An
existing skip record IS replaced by the new outcome.
**Nothing Codex-written reaches the audit dir unchecked.** Every run first
works in a PRIVATE temp dir (mode 0700, under `$TMPDIR` or `/tmp`): the
tree copy, the container's `/out`, the captured Codex stdout and the proxy
log all live there. The audit dir `$SWARM_DIR/codex/<t>.<a>/` (emptied at
the start of every handled run — everything in it; an existing verdict
leaves it untouched) holds exactly: HARNESS-written files — `files.txt` and
`excluded.txt` (relative paths from the tree copy, byte order, `LC_ALL=C`)
and `dropped.txt` (always written, possibly empty; one line per entry not
kept: `<name>\t<reason>`, where `<name>` is replaced by `<unprintable name>`
whenever it fails the keep-list name rule or contains a secret) — and
CHECKED copies: `events.jsonl` and `proxy.log` (copied only if they pass
step 7) and `out/` (the kept files, step 7). The private temp dir is deleted
on every exit path the harness controls. A SIGKILL (untrappable) can leave
behind the private temp dir and the run's compose project (containers,
networks) — never an unchecked file in the audit dir.

## Steps, in order — the FIRST failure writes the skip record and stops
0. Usage checks (exit 2). Existing verdict → exit 0 as above.
1. **Preconditions.** `$SWARM_DIR/codex.exclude` exists (may be empty) else
   `no-exclude-policy`; `$SWARM_DIR/codex/<t>.<a>.criteria.md` exists else
   `no-criteria`; `$SWARM_DIR/manifests/<t>.<a>.files` and `.sha256` exist
   else `no-evidence`; `$CODEX_BIN` is an executable file else `no-codex`;
   `$CODEX_AUTH` is a readable file else `auth`; `docker info` succeeds else
   `docker-unavailable`.
1b. **Login freshness gate** (before any container starts). If `$CODEX_AUTH`
   has a `last_refresh` timestamp (ISO-8601) older than 7 days, or a
   `tokens.access_token` that is a JWT whose `exp` is earlier than now +
   `CODEX_TIMEOUT` + 600 s → skip `auth` with the fixed DETAIL `Codex login
   needs a refresh: open Codex on this machine once, then re-run`. Missing or
   unparseable fields → no gating. The timestamp may end in `Z` (parse it on
   any Python ≥ 3.8). If `$CODEX_AUTH` yields NO secret (unparseable JSON, or
   no string value of length ≥ 20) → skip `auth` too (a login without
   secrets cannot work, and step 7 would have nothing to check against).
   Reason: a read-only `auth.json` cannot
   stop Codex from spending the refresh token inside the container, which
   could leave the user's own login stale (both attempt-2 checkers).
2. **Data-free copy** into a private temp dir. `SWARM_TREE` not a git work
   tree → `unsafe-tree`. Candidates: `git -C "$SWARM_TREE" ls-files -z
   --cached --others --exclude-standard` (NUL-separated — paths may contain
   spaces or non-ASCII; a tracked path missing on disk is skipped). Never
   `.git`. EXCLUDED (never read, never followed; listed in `excluded.txt`):
   - any path with a segment exactly `data` (a directory or a file);
   - basename starting `.env` (covers `.env`, `.env.*`, `.envrc`);
     basename ending `.pem` or `.key`;
   - any segment `.codex`, `.claude` or `.agents`, or a segment starting `.swarm`;
   - basename `AGENTS.md` or `AGENTS.override.md`, at any depth;
   - every line of `codex.exclude` (blank and `#` lines ignored): a pattern
     matched against the whole relative path with Python `fnmatch` semantics
     (`*` also crosses `/`); a line ending in `/` excludes everything under it.
   A non-excluded symlink is copied as a symlink only if its target is
   RELATIVE and resolves (from the link's own directory) to a regular FILE
   inside the tree that is itself copied. Any other non-excluded symlink —
   absolute, dangling, to a directory, escaping, or to an excluded path —
   → `unsafe-tree` (DETAIL names it). Files keep their mode.
3. **Fingerprints, re-checked in the copy.** Sidecar lines use the gate's
   grammar exactly: `^([0-9a-f]{64}|deleted) [ *](.+)$`. For each manifest
   path: excluded → listed, skipped; sidecar `deleted` → must be absent from
   the copy; otherwise the copy's file must exist and hash to the sidecar's
   value. An unparseable sidecar line, a manifest path with no sidecar line,
   or any mismatch → `fingerprint-mismatch` (DETAIL names the first path).
   `MANIFEST_SHA256` = sha256 of the sidecar file.
4. **Container** — `swarm/codex/compose.yaml`, a unique compose project per
   run, torn down on every exit path (containers, networks, volumes).
   Images have FIXED names and are reused across runs, never one per run:
   `agents2-codex-check:local` and `agents2-codex-proxy:local`, REBUILT
   (with the layer cache) at the start of EVERY run from this tree's
   `swarm/codex/` — never reused just because the tag exists: a stale or
   foreign image under that name must not decide the isolation (SPEC CD-g). Image build or proxy start failure → `container-error`.
   - `checker`: `swarm/codex/Dockerfile` (`FROM golang:1.26-bookworm`; apt
     `nodejs python3 git rsync curl ca-certificates`); runs as `1000:1000`;
     ONLY on an `internal: true` network shared with the proxy, created with
     `driver_opts: {com.docker.network.bridge.inhibit_ipv4: "true"}` and
     no IPv6, so the HOST HAS NO ADDRESS on it (attempt 2, ruling CD-l: a
     plain internal network still gives the host its gateway address, and
     every host service on `*:<port>` — budget2 on :8080 — was reachable).
     No host address (that gateway, the host's LAN, tailnet or other bridge
     addresses) may be reachable from the checker on any port; env
     `HTTPS_PROXY=http://proxy:8888`, `HTTP_PROXY=http://proxy:8888`,
     `CODEX_HOME=/codex-home`, `HOME=/tmp/home`. Mounts — these and no
     others: the copy at `/work` (rw); `$CODEX_BIN` at `/opt/codex/codex`
     (ro); if an executable `codex-code-mode-host` sits beside `$CODEX_BIN`,
     it at `/opt/codex/codex-code-mode-host` (ro) — the bundled CLI runs
     every shell command through it (SPEC ruling CD-f); a fresh private host dir at `/codex-home` holding an EMPTY
     `config.toml`, with `$CODEX_AUTH` bind-mounted as
     `/codex-home/auth.json` **READ-ONLY** (attempt 2, ruling CD-j: nothing
     in the container, and nothing in the harness, may ever change the
     user's real login file; a stale token simply yields skip `auth`); a PRIVATE output dir inside the run's temp dir at `/out`
     (rw) — never the audit dir; ONLY `swarm/codex/verdict.schema.json` at
     `/schema/verdict.schema.json` (ro) — Codex has no need to read the harness; and, only when the tree has a
     root `go.mod`, a PER-RUN module cache SUBSET at `/gomodcache` (ro) with
     env `GOMODCACHE=/gomodcache GOPROXY=off GOFLAGS=-mod=mod
     GOCACHE=/tmp/gocache`. The subset is built on the host by `go mod
     download` run in the copy with `GOMODCACHE=<private temp dir>
     GOPROXY=file://$(go env GOMODCACHE)/cache/download GOSUMDB=off
     GOFLAGS=-mod=mod` — it holds only the target's own dependencies. The
     host's whole module cache is NEVER mounted. Subset failure →
     `container-error`.
   - `proxy`: `swarm/codex/proxy/` (`FROM debian:bookworm-slim` +
     `tinyproxy`), on the internal network AND a normal egress network; port
     8888; default-deny; allowlist exactly `chatgpt.com`, `auth.openai.com`,
     `api.openai.com` (anchored whole-host match — no suffix or lookalike);
     CONNECT only to port 443; every request logged with its host;
     `proxy.log` is its log.
5. **Codex.** Inside `checker`:
   `/opt/codex/codex exec --dangerously-bypass-approvals-and-sandbox --ephemeral
   --ignore-rules --skip-git-repo-check -m "$CODEX_MODEL" -C /work --json
   --output-schema /schema/verdict.schema.json -o /out/last.json -`
   Prompt on stdin, in this order: `swarm/codex/brief.md`; a generated
   "About this copy" section listing the built-in exclusion classes and every
   path in `excluded.txt`, stating that failures caused only by an omitted
   file are artefacts of the copy, not defects; then the criteria file.
   Stdout → a file in the private temp dir (never straight into the audit
   dir). `CODEX_TIMEOUT` bounds this run.
6. **Failure classification** (Codex exit ≠ 0, or no `last.json` — meaning
   NO directory entry of that name at all; an entry that is a symlink,
   directory or oversize file is present and goes to step 7's
   `schema-invalid`), first
   match wins, case-insensitive, over ONLY stderr and the message text of
   JSONL events whose `type` is `error` or `turn.failed` (never ordinary
   events — repo text may contain these words): the timeout fired →
   `timeout`; `429|usage limit|rate limit|quota` → `quota`;
   `401|unauthori[sz]ed|not logged in|log in|refresh token` → `auth`;
   otherwise → `codex-error`. "Message text" means the value of a `message`
   key (at any depth) of such an event.
6b. **Tools unavailable.** If any event whose `type` is `error`, or whose
   `item.type` is `error`, has a message matching `failed to spawn|code mode
   is unavailable` (case-insensitive), the run is `codex-error` (DETAIL: tool
   execution unavailable) EVEN IF `last.json` exists: a Codex that could not
   run commands cannot produce evidence, and under D2 its FAIL would count.
   The same words in ordinary events do not trigger this.
7. **Keep or drop — nothing is ever redacted** (attempt 3, rulings CD-n, CD-o).
   - Order in cleanup (and at the normal end): stop the checker container
     → capture the proxy log into the private temp dir → tear the compose
     project down → keep-or-drop → delete the private temp dir. No Codex
     process is alive while files are scanned.
   - The secret set: every JSON string value of length ≥ 20 in `$CODEX_AUTH`,
     read BEFORE the container starts and passed between processes only via
     environment or pipes — never written to a file — then unioned after the
     run with the values of the live file (in case it changed).
   - A byte string CONTAINS a secret if any secret appears in it as raw
     UTF-8; as UTF-16LE or UTF-16BE; or in its text after decoding JSON
     escapes (`\uXXXX`, `\/`, `\\`, `\"`, `\n`, …) wherever they occur —
     keys, values or plain text — repeated until nothing changes (at most 3
     passes). Base64 and other encodings are out of scope. Names are byte
     strings too.
   - `last.json`: read from the private `/out` with `O_NOFOLLOW`. Not a
     regular file, a symlink, or over 4 MiB → skip `schema-invalid`. If it
     CONTAINS a secret → skip `secret-leak`.
   - The audit dir's `out/` receives, in this order — `last.json` first,
     then the rest in byte order of name — at most 64 entries of the private
     `/out` that are ALL of: at depth 1; a regular file by `lstat` (never a
     symlink, directory, FIFO, socket or device); named
     `^[A-Za-z0-9_-][A-Za-z0-9._-]{0,63}$` (no leading dot: nothing like
     `.git` or `.gitignore` ever reaches an archive); a name that does not
     contain a secret; ≤ 1 MiB (1 048 576 bytes is kept, one more is not);
     readable (a mode-000 file is not); and content that does not contain a
     secret. Everything else is not copied and is listed in `dropped.txt`.
   - `events.jsonl` and `proxy.log`: copied only if ≤ 16 MiB and not
     containing a secret; else listed in `dropped.txt`.
   - This keep-or-drop runs on EVERY exit path once the container has run —
     verdict or skip alike (a `secret-leak` skip still keeps the clean files).
     A verdict is still written when only `events.jsonl`, `proxy.log` or
     other `/out` files held a secret (they are simply dropped).
   - The verdict and skip files never contain a secret: the verdict body is
     built from a `last.json` already checked, and DETAILs follow the rule
     below.
   - Signals: INT, TERM and HUP each lead into cleanup; once cleanup starts
     it ignores them.
8. **Output.** `last.json` must match `swarm/codex/verdict.schema.json`
   exactly: `{"verdict": "PASS"|"FAIL", "criteria": [ {"id","attack","command","result": string, "pass": boolean}, …≥1 ], "observations": [string]}`,
   no other keys at either level, and consistent: `"PASS"` requires every
   criterion's `pass` to be `true`, `"FAIL"` requires at least one `false`
   (attempt 2, ruling CD-j) — else `schema-invalid`. A PASS in which any
   criterion's `command` or `result` is empty/whitespace →
   `evidence-free-pass`. Otherwise write:
   ```
   VERDICT: <PASS|FAIL>
   CHECKER: checker-codex
   FAMILY: crossvendor
   TASK: <t>
   ATTEMPT: <a>
   MANIFEST_SHA256: <sha256 of the sidecar>
   CODEX_MODEL: <$CODEX_MODEL>
   CODEX_VERSION: <first line of "$CODEX_BIN --version">
   ---
   <per criterion: its id and PASS/FAIL, then attack, command, result; then observations>
   ```
   Skip record — DETAIL rule (census CD1.3): DETAIL is one fixed sentence
   from a table the harness defines (several sentences per reason are fine,
   e.g. one per container-error cause), optionally followed by ONE
   tree-relative path the harness derived (only for `unsafe-tree` and
   `fingerprint-mismatch`, only if it matches `^[A-Za-z0-9._/-]{1,200}$`
   and contains no secret). A DETAIL NEVER contains: text from Codex's
   answer, events or stderr (incl. error messages, schema key names, enum
   values, criterion ids); docker, go or tool stderr; host absolute paths
   (`$CODEX_AUTH`, `$CODEX_BIN`, the policy/criteria/manifest paths, temp
   dirs); symlink targets; sidecar lines. The freshness gate's sentence is
   exactly `Codex login needs a refresh: open Codex on this machine once,
   then re-run`; other `auth` causes use other fixed sentences.
   ```
   REASON: <no-exclude-policy|no-criteria|no-evidence|no-codex|docker-unavailable|unsafe-tree|fingerprint-mismatch|container-error|auth|quota|timeout|schema-invalid|evidence-free-pass|secret-leak|codex-error>
   DETAIL: <one line>
   TASK: <t>
   ATTEMPT: <a>
   ```
9. **`swarm/codex/brief.md`** — the adversarial checker role, adapted from
   `.claude/agents/checker-second.md` minus everything that does not exist
   in the copy (no `.git`, no `.swarm/`, no manifest re-hash — the harness
   did that — and it never writes a verdict file; it answers only in the
   schema): scored on evidence per criterion (attack, exact command,
   observed result); a refuted attack is a legitimate PASS; default FAIL on
   genuine ambiguity; it works only in `/work`, a data-free copy, and has
   no access to anything else. It never mentions or receives a surface census.

Note: `FAMILY: crossvendor` and `.skip` records are recognised by the gate
only after task CD4; until then the script must not be pointed at a live
run's `.swarm`.

## Tests
`smoketest/codex/` — your own Docker-backed tests with a STUB Codex binary
(never the real one, never the real `auth.json`); a single entry script.

## Acceptance criteria
(a) `.swarm/tier3/CD1/accept.sh` ends `ORACLE PASS` (the real container, a
    stub Codex, a fake auth file).
(b) Every step above holds as written — checkers verify each.
(c) Only CD1-territory files change.

## Evidence
`.swarm/manifests/CD1.3.files` (every CD1-territory path) and
`.swarm/manifests/CD1.3.sha256`, written after your last edit.
