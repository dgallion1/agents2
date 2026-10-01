CENSUS: CD1
ATTEMPT: 4
---
Audited: brief .swarm/briefs/CD1.4.md (amends CD1.3.md), harness swarm/codex-check.sh + swarm/codex/** (attempt-3 code on disk),
worker tests smoketest/codex/**, draft oracle .swarm/tier3/CD1/accept.sh + stub-codex. NOTE: accept.sh was edited while I worked
(md5 effebace... -> 1a13f60bfa9e2d308640ad274a805f07, 436 lines, mtime 13:37:36, current gsig_case design = barrage fired when the run's own
`compose ... down` process appears). I audit the CURRENT file. calibration-a4-fail.log (13:29) and calibration-a4-pass.log (13:34)
were produced by the PREVIOUS revision (barrage fired at the plant); neither covers the current gsig cases. I ran no harness, no docker, no project binary; the only execution was a scratch probe (bash + setsid + python3 signal dispositions).
Label key: OK / CONTRADICTED / UNLISTED / ORACLE-GAP.

## Consumers

### Item 1 - secrets in argv
swarm/codex-check.sh:43 — pys(): `env CD_SECRETS="$SECRETS_JSON" PYTHONUTF8=1 python3 tools.py` = the defect; /usr/bin/env argv carries the JSON list — read — in-scope
swarm/codex-check.sh:188, :258, :384 — the only three callers of pys (keep_or_drop in cleanup, copy, verdict); ONE function, so every path (pass, skip, signal, cleanup) goes through :43 — read+grep — in-scope
swarm/codex-check.sh:42 — py(): `env PYTHONUTF8=1 python3` carries no secret; its callers :245 (`auth`: secrets are PRINTED on stdout into $(...), a pipe), :365 classify, :374 tools — read — in-scope (no action; `env` here is harmless)
swarm/codex-check.sh:246 — `IFS=$'\t' read -r kind r1 r2 <<< "$res"` where $res = "ok<TAB><secrets JSON>": builtin, no exec, not argv. Bash 5.2.21 here: here-string is a pipe up to pipe capacity, a temp file in $TMPDIR above it (bash <5.1: always a temp file). Step 7 says "never written to a file" (CD1.3.md:191). CD-q already logged the >64 KiB spill as backlog — read — out-of-scope (not argv; brief item 1 is argv only)
swarm/codex-check.sh:260, :387 — other here-strings; carry reason/code/path, not secrets — read — out-of-scope
swarm/codex-check.sh:139-141 — skip(): `printf | tr` builtin + pipe; detail never holds secrets — read — out-of-scope
swarm/codex-check.sh:290-296 — `export CD_WORK CD_CODEX_BIN CD_CODEX_HOME CD_AUTH(path) CD_OUT CD_SCHEMA CD_GOMOD CD_CODEX_HOST`: paths only, env of docker compose. A GLOBAL `export CD_SECRETS` (one of the ways a worker could "fix" item 1) would hand the secrets to every later child: docker/compose (:306-:338), `go mod download` (:277), and the HOST Codex binary at :381 `timeout 20 "$CODEX_BIN" --version`. Brief allows only "the environment of the process that needs it" — UNLISTED risk — read — in-scope
swarm/codex/tools.py:145-150 — load_secret_set(): reads os.environ['CD_SECRETS'] (JSON); a failure to deliver it is SILENT (json error -> empty set -> nothing is ever judged a secret, unit_tests.py "with no secret set nothing is judged secret") — read — in-scope (the A3 leak/forms/rotate/proxyleak oracle checks are the regression guard)
swarm/codex/tools.py:245-249 — git_env() pops CD_SECRETS from git's environment; tools.py's only subprocess calls are git (:296, :302), argv = tree path — read — in-scope (must stay)
swarm/codex/compose.yaml:41-45 — checker `environment:` is four literal keys; no pass-through of host env; compose argv at :334-338 carries CODEX_MODEL only — read — in-scope (no secret path)
smoketest/codex/stub-codex (worker) and .swarm/tier3/CD1/stub-codex:87-96 — stub runs `python3 -c ... "$S"` with the FAKE secret in argv INSIDE the container (visible in host /proc, not a child of the traced harness) — read — out-of-scope (fake secret, container side)
.swarm/tier3/CD1/accept.sh:312-318 — strace -f -qq -e trace=execve -s 1000000 run (scenario pass: covers pys copy, verdict, keep) — read — oracle
smoketest/codex/run_tests.sh, unit_tests.py — no test looks at argv or at CD_SECRETS (grep: none) — grep — worker adds one test

### Item 2 - DETAIL paths
swarm/codex/tools.py:45 — SAFE_PATH = [A-Za-z0-9._/-]{1,200} (admits leading '/', '..', '.', '//', trailing '/') — read — in-scope
swarm/codex/tools.py:174-178 — safe_path(): the ONLY validator; called from exactly one place, skip() :184 — read+grep — in-scope
swarm/codex/tools.py:181-187 — skip(): appends the path field only if safe_path() returns it, else prints 3 fields -> bash gets an empty r3 -> sentence alone — read — in-scope
swarm/codex/tools.py:290-291 — cmd_copy.fail() wrapper, the only route from copy to skip() — read — in-scope
Python callers of fail/skip WITH a path (all in cmd_copy): :325 linkedparent p | :359 cannotcopy p | :363 symlink p | :377 symlink p | :383 symlink p  (p = `git ls-files -z` output: relative, no '.'/'..' segments, so old and new rule agree on them)
   :404 noline mpath | :414 deletedexists mpath | :417 missing mpath | :419 drift mpath  (mpath = RAW manifest line, worker-written)
   — UNLISTED: :414/:417/:419 run AFTER the abs/'..' check at :405-407 but echo the UN-normalised mpath, so `src/../src/x.txt`, `./src/x.txt`, `src//x` WITH a sidecar line reach the DETAIL today (norm passes, raw mpath is echoed). The brief frames the defect as `noline` only; the pinned rule at safe_path covers them only if it is applied to the path as written — read — in-scope
Python callers without a path: :299, :301, :305, :316, :397, :407 (`badpath` passes no path), cmd_auth :470-490, cmd_verdict :637-669 — read — in-scope (nothing to do)
swarm/codex-check.sh:154-158 — fail(): the COMPOSER: `[[ -n "${3:-}" ]] && d="$d: $3"`, no validation of its own. Only one call site passes a 3rd argument: :263 (`stop_fail "$r1" "$r2" "$r3"`, r3 from tools.py). :249, :390 pass 2 args. So safe_path() is the single validator of every DETAIL path TODAY; any future bash caller passing a path would bypass it — read+grep — in-scope (OK for this attempt)
swarm/codex-check.sh:137-153 — skip(): tr '\r\n\t' -> space, cut to 300 chars; longest fixed sentence (66) + ": " + 200 < 300 — read — in-scope
swarm/codex-check.sh:152 — the same DETAIL is echoed to stderr — read — out-of-scope (not the record)
swarm/codex-check.sh:82-131 — DETAILS table (fixed sentences); none contains '..', '/etc/', '/tmp/' — read — in-scope
swarm/codex/tools.py:397, :407 (sidecar, badpath) — already path-free — read — OK
.audit files excluded.txt/files.txt/dropped.txt — carry tree-relative paths BY DESIGN (excluded.txt also gets the normalised manifest path `norm`, :408-409, :421); they are not DETAILs — read — out-of-scope
smoketest/codex/run_tests.sh:126, :159, :163, :336-343 — existing DETAIL-path tests (`link`, `src/nope.txt`, `two.txt`, `link-abs`, `src/app.txt`) all satisfy the new rule; :340 label still quotes the old character class — read — in-scope (no regression expected)
swarm/gate.sh — does not parse DETAIL (grep: no hit); CD4 will — foreign
SPEC.md:451 — quotes the old regex (history) — out-of-scope

### Item 3 - teardown under group signals
swarm/codex-check.sh:161 — compose(): a bash FUNCTION used by BOTH the main flow (:306 build, :308 up, :334 run) and teardown (:171 logs, :173 down). `setsid -w compose ...` cannot work (setsid execs a binary; it would fail with 127 and, because every teardown call is `>/dev/null 2>&1`, silently tear down nothing). Wrapping compose() itself would also move build/up/run out of the group (changes Ctrl-C behaviour in the main flow = out of scope) — UNLISTED pitfall — read — in-scope
swarm/codex-check.sh:163-166 — stop_container(): `docker rm -f -v "$CNAME"`; called from cleanup :204 AND from the main flow :352 — read — in-scope
swarm/codex-check.sh:168-180 — teardown(): docker calls after cleanup starts: :171 `compose logs ... proxy > $TMP/proxy.log` | :173 `compose down --volumes --remove-orphans --timeout 5` | :174 `docker ps -aq --filter` | :175 `docker rm -f -v $ids` | :176 `docker network ls -q --filter` | :177 `docker network rm` | :178 `docker volume ls -q --filter` | :179 `docker volume rm -f` — 9 invocations + :164 — read — in-scope
swarm/codex-check.sh:194-215 — cleanup(): :196 `trap '' INT TERM HUP` (children inherit SIG_IGN); :198-199 builtin kill; :201 fail() (printf/tr/mv, non-Go, inherit ignore); :204 stop_container; :205 teardown; :206 keep_or_drop (python, see below); :209 chmod -R/rm -rf (coreutils, no handlers); :214 `exit "$rc"` — read — in-scope
swarm/codex-check.sh:216-219 — the INT/TERM/HUP traps: each first does `trap "" INT TERM HUP` then exit 130/143/129 — read — in-scope
swarm/codex-check.sh:188 via :206 — keep_or_drop runs `python3 tools.py keep` AFTER teardown, with SIG_IGN inherited. CPython keeps an inherited-ignored SIGINT and SIGTERM ignored (probed: getsignal -> SIG_IGN for both, also through `setsid -w`), so it survives group signals; bash builtins/coreutils do not re-arm. No NON-docker child in cleanup re-arms signals — read — OK
swarm/codex-check.sh:340-345 — watchdog subshell: `timeout` (coreutils; installs TERM/INT/HUP handlers and puts itself in its OWN process group, so a group signal to the harness does not reach it) + `docker kill "$CNAME"` at :342 (background, only on timeout, killed by :199) — main flow / background, not teardown — read — out-of-scope
swarm/codex-check.sh:334-338 — `compose run` client (RUNPID): after the first group signal it reacts on its own (Go, Notify INT/TERM) and makes docker API calls; not shielded, not teardown — read — out-of-scope
swarm/codex-check.sh:237, :306, :308, :334, :342, :350-351 — other docker calls; all BEFORE cleanup (or background); brief scope is "once cleanup starts" — read — out-of-scope
No retries exist anywhere (grep) — OK
Host dependency: `setsid` (util-linux, `-w` >= 2.24; here 2.39.3) is new; step 1 (:237) checks docker/compose only; with setsid absent every teardown call fails silently — UNLISTED — read — in-scope
setsid semantics: cleanup's children are not process-group leaders (harness bash is non-interactive, no job control), so util-linux setsid calls setsid(2) in place and execs docker: no fork, cmdline stays `docker compose ... down ...`, `-w` is moot but harmless — OK
smoketest/codex/run_tests.sh:481-488 — worker's existing single-PID signal tests use `pgrep -f "docker compose .*agents2-codex-.* down"`; still matches after setsid exec-in-place — read — in-scope
smoketest/codex/run_tests.sh:472-473 mine_left() — counts ALL containers of this TREE (not per project): not isolated from a concurrent run — read — in-scope
Signal facts (CD1.3.checker-second.verdict F1, measured with `docker events` under `trap "" TERM INT HUP`: /proc SigIgn shows HUP only): INT and TERM are re-armed by the Go docker CLI, HUP is NOT. Leak needs >= 2 group signals inside the ~1-2 s `compose down` window; ONE group INT/TERM on compose down did not leak; barrages that "landed on other steps" did not leak — CONFIRMED

### Item 4 - unreadable /out
swarm/codex-check.sh:254-257 — TMP=mktemp -d (chmod 700), POUT=$TMP/out made by `mkdir` — harness-created — read — in-scope
swarm/codex/compose.yaml:66-67 (CD_OUT -> /out), :48 (CD_WORK -> /work), :57 (CD_CODEX_HOME), CD_GOMOD in compose.go.yaml: the container mounts $TMP/out, $TMP/work, $TMP/codex-home, $TMP/gomodcache — never $TMP itself. /out is a mount point inside the container: it cannot be renamed, removed or replaced with a symlink from inside (EBUSY), and $TMP is unreachable. So `chmod u+rwx "$POUT"` cannot follow a container-planted symlink — read — OK
swarm/codex-check.sh:352 — stop_container (container dead) — read — in-scope
swarm/codex-check.sh:353-355 — ce-nostart check (before the place where the restore belongs; /out untouched then) — read — in-scope
swarm/codex-check.sh:357-358 — `LAST=$POUT/last.json; [[ -e "$LAST" || -L "$LAST" ]]` = WHERE "step 6 looks for last.json". It sits ABOVE the `# --- step 6` banner at :360. Mode 000 on $POUT -> stat EACCES -> have_last=0 -> :364 classify -> skip codex-error/codex-fail. The restore must land between :352 and :358, not after the banner — read — in-scope
swarm/codex-check.sh:361-363 — timeout flag check, after :358 — read — in-scope
swarm/codex-check.sh:365, :374 — classify / tools read $TMP/events.jsonl and $TMP/codex.stderr (in $TMP, not in $POUT) — unaffected by a locked /out — read — OK
swarm/codex-check.sh:384-386 + tools.py:630-637, :606-627 — verdict: read_regular(lstat+open of $POUT/last.json); on a locked dir lstat -> EACCES -> (None,'unreadable') -> skip schema-invalid/lastfile. Reached only if have_last is 1 — read — in-scope
swarm/codex-check.sh:185-192 + tools.py:683-704 — keep_or_drop: `os.listdir(priv)` needs r on the dir; on a locked dir -> names=[] and dropped.txt gets `out<TAB>the private output dir could not be listed`; out/ stays EMPTY (last.json and the stub's flat records are lost) even when the verdict is written. So `x`-only restore would make the verdict work but keep nothing — read — in-scope
swarm/codex-check.sh:204-206 — cleanup paths reached BEFORE :352 (a signal, or a crash, while the container runs) call keep_or_drop with whatever mode Codex left: locked dir -> out/ dropped wholesale (secret-safe, records lost). The brief restores only on the main-flow path — UNLISTED — read — out-of-scope by brief wording ("before step 6")
swarm/codex-check.sh:209 — cleanup already does `chmod -R u+rwX "$TMP"` before rm -rf; chmod -R does not follow symlinks met in recursion — read — OK (existing)
tools.py:701-744 — keep rules for ENTRIES (mode-000 FILE is dropped as unreadable, CD1.3.md:208-209). A RECURSIVE restore would make mode-000 files readable and change that A3 rule — read — out-of-scope (brief says not recursive)
Host uid: `id -u` = 1000 = container user (compose.yaml user 1000:1000), so the container can chmod /out here; on a host with another uid the stub's `chmod 000 /out` would fail (EPERM) and the lockout scenario would pass on A3 code too — read — OK on this host
.swarm/tier3/CD1/stub-codex:101 — `lockout) J "$PASSJ"; chmod 000 /out` — read — oracle

## Brief claims
CD1.4.md:14-16 / codex-check.sh:43 "pys() runs env CD_SECRETS=... so the secrets are arguments of /usr/bin/env" — CONFIRMED — codex-check.sh:43; CD1.3.checker-tests.verdict:20-31 (strace + /proc poller caught it 1/6)
CD1.4.md:14 "step 7, only via environment or pipes" — CONFIRMED — CD1.3.md:191-192
CD1.4.md:22-23 "Oracle: strace -f -e trace=execve shows no auth secret in any argv" — CONFIRMED and calibrated — accept.sh:312-318; calibration-a4-fail.log:155-157 (A3: the argv check FAILs, trace check ok)
CD1.4.md:26-28 "noline DETAIL echoes the manifest path before the absolute/'..' check" — CONFIRMED — tools.py:403-407
CD1.4.md:28-29 "CD1.3 regex admits a leading '/' and '..'" — CONFIRMED — CD1.3.md:245-246, tools.py:45
CD1.4.md:33 "enforce it at the one place every DETAIL path passes through (today safe_path())" — CONFIRMED with caveat — tools.py:174-187 is the only validator (single call site :184); bash fail() at codex-check.sh:154-158 is the composer and validates nothing, but its only path-bearing caller is :263 (fed by tools.py)
CD1.4.md:25-34 (item framed around `noline`) — PARTIAL — the same raw echo exists in deletedexists/missing/drift (tools.py:414/417/419) after the normalisation check; the pinned rule only covers them if safe_path sees the raw mpath (it does today)
CD1.4.md:39-43 "Go re-arms INT and TERM; `trap '' INT TERM HUP` does not protect the docker CLI" — CONFIRMED (measured, not re-run by me) — CD1.3.checker-second.verdict F1 (docker events SigIgn=HUP only). Corollary: HUP is not lethal to a Go docker CLI
CD1.4.md:44-47 "every docker call it makes (stop the container, capture the proxy log, compose down, the label sweeps)" — CONFIRMED — codex-check.sh:164, :171, :173, :174-179
CD1.4.md:47-48 "second checker verified setsid -w removes the leak" — CONFIRMED — CD1.3.checker-second.verdict F1 remedy (q1-q4, six invocations under setsid -w); SPEC.md:456-458
CD1.4.md:48-49 "harness still exits with its own code" — CONFIRMED — codex-check.sh:195, :214
CD1.4.md:50-54 (item 3 Oracle: "after the planted secret appears, 3xTERM (and separately INT, TERM, HUP) are sent to the GROUP 0.4 s apart") — CONTRADICTED by the current draft oracle — accept.sh:377-402: case 1 = slow-leak left to reach its natural end, TERM x3 fired when the run's own `compose ... down` process appears; case 2 = INT at the plant, then TERM x3 during compose down. No HUP group signal, no "0.4 s from the plant" sequence. (The first design, at the plant, PASSED against attempt-3 code: calibration-a4-fail.log:170-173 — non-discriminating; the lead has since redesigned.) Brief or oracle must be brought in line.
CD1.4.md:8, 56 "these four items ... (user reopen, 2026-09-30)" — CONTRADICTED on provenance — SPEC.md:469-472 quotes the user as "Reopen: these 3 only" and lists "F1, F2, G1 and the F3 label fix": item 4 is F3, which CD-q (SPEC.md:459-463) and the checker (CD1.3.checker-tests.verdict F3) describe as a reason-LABEL defect whose suggested outcome is step 7 -> schema-invalid ("treating last.json as present"). Brief item 4 instead restores the mode and yields a normal verdict (PASS or FAIL, keep-or-drop as usual): a different, larger observable outcome (a locked-/out Codex FAIL now counts in the gate where attempt 3 produced a skip). Needs a ruling that this is the intended reading of "label fix".
CD1.4.md:56-59 "If Codex writes a valid last.json and then sets /out to mode 000, the harness today cannot see the entry and skips codex-error" — CONFIRMED — codex-check.sh:358 (-e on an unsearchable dir -> false), :364-369; calibration-a4-fail.log:158 (the lockout check FAILs on A3 code)
CD1.4.md:60-62 "the harness's own directory, created by it — never a path read from inside the container" — CONFIRMED — codex-check.sh:256-257; not replaceable: compose.yaml:66-67 bind-mounts exactly $TMP/out at /out, $TMP itself is 0700 (:254-255) and not mounted
CD1.4.md:58 "BEFORE step 6 looks for last.json" — CONFIRMED but easy to misplace — the look is :357-358, above the step-6 banner :360
CD1.4.md:66-69 "Unchanged: freshness gate, keep-or-drop, fixed image names, territory" — CONFIRMED (nothing in the four fixes needs them)
CD1.4.md:76 `CODEX_TESTS=unit bash smoketest/codex/run_tests.sh` — CONFIRMED — run_tests.sh:17-19 (ONLY=${CODEX_TESTS:-all})
accept.sh glaunch (:365-369) "launches the harness as its own process-group leader" — CONFIRMED by reasoning — `( cd && exec setsid env ... bash ) &` : the background subshell of a non-interactive bash is not a group leader, so setsid(2) runs in place; $! = harness bash = SID = PGID; accept.sh checks `lead == PID` (:396; glaunch :365-369) so a fork (leader case, e.g. job control on) would fail loudly, not vacuously
Additions the attempt-3 oracle check at accept.sh:287 (`/etc/|\.\./`) — not a brief claim; it widens an A3 check; right reason (calibration-a4-fail.log:146-147) and no legitimate DETAIL contains either

## Oracle gaps (Tier 3 only)
Fail-end status against attempt-3 code (calibration-a4-fail.log, previous accept.sh revision): items 1, 2, 4 fail for the RIGHT reason (argv secret, path in DETAIL, have_last masked by lockout). Current gsig cases: NOT calibrated at A3 in any log I can see (lead's scratch gsig-only.sh was running, flock held, while I read). Pass-end for the current revision: not in any log either.

ITEM 1
- ORACLE-GAP: only argv is asserted. strace without -v abbreviates envp (`/* N vars */`), so a GLOBAL `export CD_SECRETS` (secrets in the env of docker, compose, go, and the host Codex binary at :381) passes; the brief says "environment of the process that needs it".
- ORACLE-GAP (minor): -e trace=execve does not cover execveat; children of dockerd/containerd are not traced (not harness children).
- OK: -s 1000000 works (A3 fail end FAILs), -f follows children, one scenario suffices because every python call goes through pys; check 2 (tools.py in the trace) guards against an empty trace; a missing strace/ptrace denial fails check 1 instead of passing.

ITEM 2
- ORACLE-GAP: only the `noline` code is exercised (accept.sh:194-202: four manifest lines with NO sidecar line). The brief requires the rule for "every reason and code"; `deletedexists`/`missing`/`drift` (tools.py:414/417/419) echo the raw mpath and are reachable with `src/../src/x.txt` or `./src/x.txt` WITH a sidecar line (norm passes). A mutant applying the rule only in the noline branch passes the oracle.
- ORACLE-GAP: pinned-rule parts never tried: a `.` segment (`./src/app.txt`), an empty segment (`src//x`), a trailing slash, the 200/201-byte boundary, a secret inside a manifest path (the only secret-in-path test is a TREE symlink name, run_tests.sh:337-338, not in accept.sh), non-ASCII/space in a manifest path. Mutants dropping any of them survive.
- ORACLE-GAP (minor): `grep -qF "$d/"` + `^DETAIL:.*: /` would not see an implementation that strips the leading '/' and echoes `tmp/cd1-oracle.../docs/notes.md`; the accept.sh:287 sweeper has `/tmp/` with slashes both sides, also blind to it.
- OK: the four A4 cases and the widened sweeper do fail on A3 code for the right reason and pass for the prototype rule (lead's cd1a4-proto).

ITEM 3
- ORACLE-GAP: the barrage is fired only while `compose down` runs (accept.sh:385-392). No group signal ever lands on `stop_container` (:164), the proxy-log capture (:171) or the label sweeps (:174-179), so a fix that shields ONLY `compose down` passes — the brief lists all of them. Per-call shielding is unasserted; so is proxy.log surviving.
- ORACLE-GAP: `indown` is echoed, never asserted (accept.sh:395). If `compose down` is not seen (harness died, or the 60 s poll budget, 1200 x 0.05 s, runs out) the barrage goes to a finished/other-step harness and BOTH checks can pass vacuously on any code. Timing margin, case 1: slow-leak plants first, runs all probes, then `sleep 30` (stub-codex:14-17, :100); the natural end is probes + 30 s + harness tail after the plant; the poll budget is 60 s from the plant, i.e. roughly 20 s of slack if probes take ~10 s (the stub's curl -m values alone add up to 105 s worst case, hostips loop up to 4 s x ~28 tries if packets are dropped rather than rejected).
- ORACLE-GAP: the brief's "INT, TERM, HUP" group sequence has no HUP (HUP is non-lethal to Go docker CLIs anyway); the harness's own rc (130/143) and skip record after a group signal are not asserted (`wait $PID 2>/dev/null` discards rc; the worker's single-PID tests do check them).
- ORACLE-GAP: `mine()` returns any RUNNING checker container whose config_files label contains "$TREE/swarm/codex/"; gsig_case takes `head -1`. A concurrent run in the same tree (the worker's suite, another oracle, the lead's calibration) makes `pj` someone else's project: proj_left then reports that run's live resources (false FAIL) and proj_sweep REMOVES them. proj_left itself is keyed by project label/name and cannot see another project if `pj` is right. The flock in the brief is the only protection.
- ORACLE-GAP (vacuous parts): case 1/2 "no secret in the audit dir" is meaningful only because the scenario is slow-leak (secret planted); the private-dir check needs the harness to finish.
- Right-reason expectation at A3: case 1 and case 2 both put >= 3 group TERMs inside the compose-down window at 0.4 s spacing = the checker's 7/7 leak reproduction (CD1.3.checker-second.verdict F1); expected to leave one `<project>_isolated` network. Not yet observed. Correct-fix false-failure risks: `mine`/`head -1` above; `pgrep -f "$pj.* down( |$)"` couples to the compose-down cmdline (still matches under setsid exec-in-place and under `bash -c`/wrapper forms); a fix that shields with `setsid` WITHOUT waiting lets the harness delete $TMP and exit while compose down still runs (oracle sleeps 2 s).
- H counts (accept.sh:360-363) are taken BEFORE the gsig cases, so a gsig leak is caught only by the gsig check itself (then swept).

ITEM 4
- ORACLE-GAP: asserts only `verdict exists && VERDICT==PASS && no skip` (accept.sh:321). Not asserted: out/last.json and the stub's stub-* records are KEPT in the audit dir; dropped.txt has no `out<TAB>the private output dir could not be listed` line. A `chmod u+x` -only restore (lstat/open need only x) passes; so does any restore that leaves keep_or_drop unable to list.
- ORACLE-GAP: "not recursive" is unassertable with the A3 fixtures (leak-ro's mode-000 file/dir hold a secret, so a recursive restore still ends with nothing kept); no CLEAN mode-000 file in /out scenario.
- ORACLE-GAP: lockout is tested with a PASS answer only (no FAIL verdict, no non-zero exit, no signal-while-locked path).
- OK: fails on A3 (calibration-a4-fail.log:158), expected to pass for a correct restore between :352 and :358; requires container uid 1000 == host uid (true here).

## Anything that would change attempt-3 behaviour outside scope
- Item 1: a global export (see above); removing `env` from py() is harmless; a stdin/pipe design must not change what `keep`/`copy` read (no tools.py command reads stdin today).
- Item 2: tree-derived DETAIL paths unchanged (git never emits '.', '..', '//', leading or trailing '/'); manifest-derived ones shrink to the bare sentence for any `./x`, `x//y`, `x/`, `..`, abs, >200 B or secret path — including honest manifests written by `sha256sum ./file` (drift/missing DETAILs lose their path). Stale text: tools.py:45 SAFE_PATH (dead), tools.py:175 docstring, tools.py:1-23 and codex-check.sh:9 "attempt 3/CD1.3", run_tests.sh:340 label.
- Item 3: new host dependency `setsid` with a silent total-teardown failure mode; wrapping compose() (shared with build/up/run) or the whole script would change main-flow signal behaviour (and re-exec under setsid would stop the harness seeing group signals at all); stop_container is shared with the main flow (:352) — shielding it there is harmless; the function-vs-binary trap (`setsid -w compose ...`).
- Item 4: an outcome change by design (skip codex-error -> verdict); restore before stop_container would let Codex re-lock; recursive restore changes the mode-000-file keep rule; restore only on the main-flow path leaves the cleanup-before-:352 path dropping a locked /out wholesale.
