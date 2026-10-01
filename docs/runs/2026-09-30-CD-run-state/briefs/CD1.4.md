# CD1 attempt 4 — four fixes to the attempt-3 harness (Tier 3)

Run CD, agents2 worktree `/home/darrell/work/agents2/.claude/worktrees/unifi-camera-streaming-7be695`,
branch `claude/codex-checker-lane`. This AMENDS `.swarm/briefs/CD1.3.md`;
everything there still holds except where an item below tightens it.
SPEC.md rulings CD-q (the attempt-3 findings) and CD-r (the user's reopen).

## Scope — these four items, nothing else (user reopen, 2026-09-30)
Attempt 3 held under heavy attack in both checker lanes. Fix exactly these
four defects. Do not refactor, rename, re-order or "improve" anything else;
the attempt-3 behaviour that is not named here must stay byte-for-byte
the same in effect (the attempt-3 oracle checks still run).

1. **No secret in any process's argv (step 7, "only via environment or
   pipes").** Today `pys()` runs `env CD_SECRETS="$SECRETS_JSON" …`, so the
   secrets are arguments of `/usr/bin/env` (world-readable
   `/proc/<pid>/cmdline`). The secret set may reach Python ONLY through the
   environment of the process that needs it (e.g. a bash prefix assignment
   `CD_SECRETS="$SECRETS_JSON" python3 …`, or an export inside a subshell)
   or a pipe. No program — `env`, `python3`, `docker`, anything — may ever
   receive a secret, or the JSON list of secrets, as an argument. Never
   `export` it into the harness's own environment either: docker, compose,
   `go mod download` and the Codex binary would all inherit it.
   Oracle: a run traced with `strace -f -v -e trace=execve,execveat` — no
   argv carries a secret, and every exec whose environment carries one is a
   `tools.py` Python process.

2. **DETAIL never carries a host absolute path or an escaping path.** Today
   the `noline` fingerprint-mismatch DETAIL echoes the worker-written
   manifest path before the absolute/`..` check (e.g. `/etc/shadow`,
   `../../x`). The CD1.3 regex was the lead's error: it admits a leading
   `/` and `..`. The pinned rule now: a path is appended to a DETAIL only if
   it matches `^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`, is at most 200 bytes,
   has NO segment equal to `.` or `..`, and contains no secret; otherwise the
   fixed sentence stands alone. Enforce it at the one place every DETAIL
   path passes through (today `safe_path()`, `tools.py`; its only caller is
   `skip()`), so it holds for every reason and code — `noline`, and also
   `deletedexists`, `missing` and `drift`, which echo the RAW manifest path
   (e.g. `./src/app.txt`, `src/../src/x.txt`) after normalisation passed.
   Oracle: absolute, `/etc/…`, `../..`, inner-`..`, `./`, empty-segment,
   trailing-slash, 201-byte and secret-bearing manifest paths, via `noline`,
   `missing` and `drift` → skip `fingerprint-mismatch` whose DETAIL carries
   none of them.

3. **Teardown survives process-group signals (step 4 "torn down on every
   exit path", step 7 "once cleanup starts it ignores them", reopen item 4).**
   `trap '' INT TERM HUP` does not protect the docker CLI: Go re-arms INT
   and TERM, so a signal delivered to the whole process group (Ctrl-C,
   `kill -- -PGID`) kills `docker rm` / `compose down` mid-teardown and
   leaves a `<project>_isolated` network. Once cleanup starts, every docker
   call it makes (stop the container, capture the proxy log, compose down,
   the label sweeps) must run where group signals cannot reach it — e.g.
   under `setsid -w` (the second checker verified this removes the leak),
   or an equivalent that also keeps waiting for completion. Mind the traps
   the census found: `compose()` is a bash FUNCTION, so `setsid -w compose …`
   runs nothing — shield the docker binary (`setsid -w docker compose …`),
   and do not move the main-flow `compose run` out of the process group;
   `stop_container` is also called from the main flow (shielding it there is
   harmless); if `setsid` is not installed, run the call directly — never
   skip a teardown step. The harness still exits with its own code.
   Oracle: the harness launched as its own process-group leader, its
   project identified by label (exactly one), and three barrages sent to
   the GROUP: (i) natural end, TERM×3 0.4 s apart while this project's
   `compose … down` runs; (ii) INT once the planted secret appears, then
   TERM×3 while `compose … down` runs; (iii) INT once planted, then TERM×3
   0.1 s apart at once. Each → no container, network or volume of the
   project remains, the private temp dir is gone, no secret in the audit
   dir, verdicts or skip record, and the run's own outcome stands ((i) a
   verdict and exit 0; (ii)/(iii) skip `container-error`, exit 130).

4. **The chmod-000 label fix (step 6, ruling CD-s).** If Codex writes a
   valid `last.json` and then sets `/out` to mode 000, the harness cannot
   search the dir, concludes "no last.json", and skips `codex-error`. Step 6
   defines "no last.json" as NO directory entry of that name; a harness
   that cannot search the dir cannot establish that. So: when the private
   output dir cannot be searched, `last.json` counts as PRESENT — the run
   continues to step 7, where an answer that cannot be read is
   `schema-invalid` (as for any unreadable answer today). Do NOT change the
   dir's mode (no chmod of `/out`, recursive or not); keep-or-drop stays as
   it is (an unlistable `out/` is dropped whole, as today).
   Oracle: stub scenario `lockout` (valid `last.json`, then `/out` mode 000)
   → skip `schema-invalid`, no verdict, no secret anywhere.

Comments, labels and docstrings that describe these four behaviours (e.g.
`tools.py`'s `SAFE_PATH` comment and header, `codex-check.sh`'s header,
test labels) are updated to match; that is part of the fix, not scope creep.

## Unchanged
Every CD1.3 rule, the Interface, exit codes, DETAIL table sentences, the
freshness gate, keep-or-drop, the fixed image names, the territory
(`swarm/codex-check.sh`, `swarm/codex/**`, `smoketest/codex/**`). Your own
tests in `smoketest/codex/` gain one test per item above (names mention the
item), run Docker-free where the item allows it.

## Acceptance
(a) `.swarm/tier3/CD1/accept.sh` ends `ORACLE PASS` (attempt-3 checks plus
    the A4 checks).
(b) `CODEX_TESTS=unit bash smoketest/codex/run_tests.sh` → ALL PASS, and the
    full suite (Docker) → ALL PASS.
(c) Only CD1-territory files change; nothing outside the four items changes
    behaviour.

Throttle: run the oracle and Docker suites under `nice -n 10`, one at a
time, holding the shared lock
`/tmp/claude-1000/-home-darrell-work-agents2--claude-worktrees-unifi-camera-streaming-7be695/480338d9-8e6c-42d1-8681-c9e4d1acdcaf/scratchpad/cd1-docker.lock`
(`flock <lock> <cmd>`). Never run the real Codex, never read or mount the
real `~/.codex/auth.json` — fake auth files and the stub only.

## Evidence
`.swarm/manifests/CD1.4.files` and `.swarm/manifests/CD1.4.sha256` (every
CD1-territory file present, one `sha256sum` line each, written after your
last edit).
