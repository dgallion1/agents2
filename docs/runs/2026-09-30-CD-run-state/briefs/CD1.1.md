# CD1 — the Codex check harness (Tier 3: a data-disclosure boundary)

Run CD, agents2 worktree `/home/darrell/work/agents2/.claude/worktrees/unifi-camera-streaming-7be695`,
branch `claude/codex-checker-lane`, base 12f6413. SPEC.md §1 (decisions D1–D6),
§2 (probe findings), §3a (this design), §8 rulings CD-a…CD-e (this brief's
reconciliation with surface census CD1.1).

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
exit 2 = usage error only (wrong arg count, non-integer attempt), writing nothing.
```
Output: exactly ONE of `$SWARM_DIR/verdicts/<t>.<a>.checker-codex.verdict` or
`…checker-codex.skip`. **An existing verdict for (t, a) is never replaced or
removed**: the script then writes nothing, says so on stderr, and exits 0 (a
re-check needs a new attempt — a FAIL is never laundered by re-running). An
existing skip record IS replaced by the new outcome.
Audit dir `$SWARM_DIR/codex/<t>.<a>/`: `events.jsonl` (Codex's `--json`
stream), `proxy.log` (one line per request, allowed and denied, with host),
`files.txt` and `excluded.txt` (relative paths, sorted in byte order —
`LC_ALL=C`), and `out/` (the container's `/out`, emptied before each run; it
keeps `last.json`). The copy itself is deleted after the run.

## Steps, in order — the FIRST failure writes the skip record and stops
0. Usage checks (exit 2). Existing verdict → exit 0 as above.
1. **Preconditions.** `$SWARM_DIR/codex.exclude` exists (may be empty) else
   `no-exclude-policy`; `$SWARM_DIR/codex/<t>.<a>.criteria.md` exists else
   `no-criteria`; `$SWARM_DIR/manifests/<t>.<a>.files` and `.sha256` exist
   else `no-evidence`; `$CODEX_BIN` is an executable file else `no-codex`;
   `$CODEX_AUTH` is a readable file else `auth`; `docker info` succeeds else
   `docker-unavailable`.
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
     user's real login file; a stale token simply yields skip `auth`); `$SWARM_DIR/codex/<t>.<a>/out/` at `/out`
     (rw); `swarm/codex/` at `/schema` (ro); and, only when the tree has a
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
   Stdout → `events.jsonl`. `CODEX_TIMEOUT` bounds this run.
6. **Failure classification** (Codex exit ≠ 0, or no `last.json`), first
   match wins, case-insensitive, over ONLY stderr and the message text of
   JSONL events whose `type` is `error` or `turn.failed` (never ordinary
   events — repo text may contain these words): the timeout fired →
   `timeout`; `429|usage limit|rate limit|quota` → `quota`;
   `401|unauthori[sz]ed|not logged in|log in|refresh token` → `auth`;
   otherwise → `codex-error`.
6b. **Tools unavailable.** If any event whose `type` is `error`, or whose
   `item.type` is `error`, has a message matching `failed to spawn|code mode
   is unavailable` (case-insensitive), the run is `codex-error` (DETAIL: tool
   execution unavailable) EVEN IF `last.json` exists: a Codex that could not
   run commands cannot produce evidence, and under D2 its FAIL would count.
   The same words in ordinary events do not trigger this.
7. **Secret hygiene** (attempt 2, ruling CD-j). The secret set is taken
   from `$CODEX_AUTH` BEFORE the container starts: every JSON string value
   of length ≥ 20 (compare raw, JSON-escaped and decoded forms). Any secret
   appearing in `last.json` → skip `secret-leak`. Before the script exits,
   on every path: first make everything under the audit dir owner-writable
   and -searchable (`chmod -R u+rwX`), then replace every occurrence in
   `events.jsonl`, `proxy.log` and every file under `out/` with
   `[REDACTED]`, then re-scan; a file that still contains a secret or
   cannot be read/rewritten is DELETED (and its path logged to stderr). No
   secret may remain anywhere under the audit dir or in the verdict/skip
   file.
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
   Skip record:
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
`.swarm/manifests/CD1.1.files` (every path you created/changed) and
`.swarm/manifests/CD1.1.sha256`, written after your last edit.
