#!/usr/bin/env bash
# swarm/codex-check.sh <task> <attempt> — the Codex check harness (run CD, task CD1).
#
# Runs Codex as an alongside adversarial checker on a DATA-FREE COPY of the
# tree, inside a container whose only route out is an allowlisting proxy, and
# turns its answer into exactly ONE of
#     $SWARM_DIR/verdicts/<task>.<attempt>.checker-codex.verdict
#     $SWARM_DIR/verdicts/<task>.<attempt>.checker-codex.skip
# The lead never writes either. Contract: .swarm/briefs/CD1.3.md as amended by
# CD1.4.md (attempt 4); design: SPEC.md §1-§3a and rulings CD-b..CD-s.
#
#   SWARM_DIR     default .swarm        the run's evidence dir
#   SWARM_TREE    default .             the tree under verification (a git work tree)
#   CODEX_BIN     default /usr/lib/chatgpt/resources/codex
#   CODEX_MODEL   default gpt-6-astra
#   CODEX_TIMEOUT default 1800          seconds; bounds the Codex container run only
#   CODEX_AUTH    default $HOME/.codex/auth.json
#
# Exit 0 = handled (one output file written, or an existing verdict found and
# left alone: a verdict is never replaced or removed — a re-check needs a new
# attempt, so a FAIL is never laundered by re-running; a skip record IS
# replaced by the new outcome). Exit 1 = no outcome could be recorded
# (verdicts/ cannot be created, or the skip record cannot be written).
# Exit 2 = usage error only, nothing written.
#
# Nothing Codex writes is ever scrubbed (SPEC ruling CD-n). Everything it
# produces — /out, its stdout, the proxy log — lands in a PRIVATE temp dir.
# After the container is stopped, only flat, small, regular, secret-free files
# (and clean event and proxy logs) are COPIED into the audit dir; anything that
# holds an auth secret, in any recognised form, is dropped, never redacted.
# The auth secrets live only in memory, in the environment of the one python
# process that needs them, and in pipes — no file, and NEVER in any program's
# argv (a bash prefix assignment, not `env VAR=... cmd`; never exported).
# Skip DETAILs are fixed sentences: never Codex's words, never a host path;
# at most one plain tree-relative path (no leading slash, no . or .. segment).
# Teardown's docker calls run under `setsid -w`: a signal sent to the whole
# process group (Ctrl-C, kill -- -PGID) cannot kill them mid-teardown.
# "No last.json" means no directory entry of that name; an unsearchable
# private /out cannot establish that, so last.json then counts as present.
#
# FAMILY: crossvendor and .skip records are recognised by the gate only after
# task CD4; until then do not point this at a live run's .swarm.
set -u
set -o pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CODEX_DIR="$HERE/codex"                       # compose files, images, brief, schema, tools.py
SECRETS_JSON=""                               # the auth secrets: memory only; never exported, never an argument
py()  { env PYTHONUTF8=1 python3 "$CODEX_DIR/tools.py" "$@"; }
# A bash prefix assignment reaches ONLY the python process's environment. `env CD_SECRETS=... python3`
# would put the secrets in /usr/bin/env's argv (world-readable /proc/<pid>/cmdline).
pys() { CD_SECRETS="$SECRETS_JSON" PYTHONUTF8=1 python3 "$CODEX_DIR/tools.py" "$@"; }

# --- step 0: usage, and an existing verdict ------------------------------------------
if [[ $# -ne 2 ]]; then echo "usage: $0 <task> <attempt>" >&2; exit 2; fi
T="$1"; A="$2"
[[ "$A" =~ ^[0-9]+$ ]] || { echo "codex-check: attempt must be a non-negative integer, got '$A'" >&2; exit 2; }
[[ "$T" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "codex-check: bad task id '$T'" >&2; exit 2; }

SWARM_DIR="${SWARM_DIR:-.swarm}"
SWARM_TREE="${SWARM_TREE:-.}"
CODEX_BIN="${CODEX_BIN:-/usr/lib/chatgpt/resources/codex}"
CODEX_MODEL="${CODEX_MODEL:-gpt-6-astra}"
CODEX_TIMEOUT="${CODEX_TIMEOUT:-1800}"
CODEX_AUTH="${CODEX_AUTH:-${HOME:-}/.codex/auth.json}"

VDIR="$SWARM_DIR/verdicts"
VERDICT="$VDIR/$T.$A.checker-codex.verdict"
SKIPF="$VDIR/$T.$A.checker-codex.skip"
if [[ -e "$VERDICT" || -L "$VERDICT" ]]; then
  echo "codex-check: $VERDICT already exists — left untouched, nothing run (a re-check needs a new attempt)" >&2
  exit 0
fi
if [[ ! "$CODEX_TIMEOUT" =~ ^[0-9]+$ || "$CODEX_TIMEOUT" -lt 1 ]]; then
  echo "codex-check: CODEX_TIMEOUT '$CODEX_TIMEOUT' is not a positive integer — using 1800" >&2
  CODEX_TIMEOUT=1800
fi

# From here on the script owes ONE output file. Exit 2 stays reserved for usage
# errors: if not even the verdicts dir can be made or entered there is nowhere to
# record an outcome at all, and that is exit 1.
if ! { mkdir -p "$VDIR" 2>/dev/null && SWARM_DIR="$(cd "$SWARM_DIR" && pwd)"; }; then
  echo "codex-check: cannot create or enter $VDIR — nowhere to record an outcome" >&2
  exit 1
fi
VDIR="$SWARM_DIR/verdicts"
VERDICT="$VDIR/$T.$A.checker-codex.verdict"
SKIPF="$VDIR/$T.$A.checker-codex.skip"
AUD="$SWARM_DIR/codex/$T.$A"                  # audit dir

# --- the fixed DETAIL table (SPEC ruling CD-n): a code -> ONE sentence ----------------
# A DETAIL never carries text from Codex or from a tool, a host path, a symlink
# target or a sidecar line; at most one tree-relative path the harness derived
# (validated in tools.py) follows the sentence for unsafe-tree / fingerprint-mismatch.
declare -A DETAILS=(
  [pre-exclude]="the run's exclusion policy file (codex.exclude) is missing"
  [pre-criteria]="the criteria file for this task and attempt is missing"
  [pre-evidence]="the manifest or its fingerprint sidecar for this attempt is missing"
  [pre-codex]="the Codex binary is missing or not an executable file"
  [pre-docker]="docker or docker compose is not reachable"
  [unreadable]="the Codex login file is missing or unreadable"
  [nosecret]="the Codex login file holds no usable credentials"
  [stale]="Codex login needs a refresh: open Codex on this machine once, then re-run"
  [auth-rejected]="Codex reported that its login was rejected or is no longer valid"
  [notgit]="the tree is not a git work tree"
  [gitfail]="git could not list the tree"
  [newline]="a path in the tree has a line break in its name"
  [linkedparent]="a path in the tree is reached through a symlink or a non-directory"
  [cannotcopy]="a file in the tree could not be copied"
  [symlink]="a symlink in the tree cannot be copied safely"
  [sidecar]="the fingerprint sidecar has a line that is not in sha256sum format"
  [noline]="a manifest path has no fingerprint line in the sidecar"
  [badpath]="a manifest path is not a path inside the tree"
  [deletedexists]="a path fingerprinted as deleted exists in the copy"
  [missing]="a fingerprinted file is missing from the copy"
  [drift]="a fingerprinted file in the copy does not match its fingerprint"
  [quota]="Codex reported a usage or rate limit"
  [timeout]="Codex did not finish within the time limit and was stopped"
  [codex-fail]="Codex exited with an error or without an answer"
  [tools]="tool execution unavailable: Codex reported that it could not run commands"
  [lastfile]="Codex's answer file is not a regular file, or is unreadable, or is larger than 4 MiB"
  [json]="Codex's answer is not valid JSON"
  [schema]="Codex's answer does not match the verdict schema"
  [inconsistent]="Codex's verdict disagrees with its own criteria"
  [evidence]="a PASS with a criterion that has no command or no result"
  [answer]="an auth secret appeared in Codex's answer; the answer was withheld"
  [rendered]="an auth secret appeared in the rendered verdict; it was withheld"
  [ce-tmp]="the private temp dir could not be created"
  [ce-audit]="the audit dir could not be created, or its out/ is a link"
  [ce-copy]="the tree copy step failed"
  [ce-nogo]="the tree has a go.mod but go is not available for the module subset"
  [ce-nocache]="the host Go module cache was not found"
  [ce-gomod]="the Go module subset could not be built"
  [ce-build]="the container images could not be built"
  [ce-proxy]="the egress proxy did not start"
  [ce-nostart]="the Codex container did not start"
  [ce-internal]="an internal harness step failed"
  [ce-interrupted]="the harness was interrupted before an outcome was recorded"
  [ce-crashed]="the harness failed before producing a result"
)

# --- output, teardown, keep-or-drop — on every exit path -------------------------------
TMP=""; PROJECT=""; PROXY_UP=0; CONTAINER_RAN=0; WROTE=0; INTERRUPTED=""; VTMP=""; RUNPID=""; WATCHDOG=""; CNAME=""
COMPOSE_FILES=()

skip() {                                      # skip <reason> <detail>: the one output, unless a verdict exists
  local reason="$1" detail="$2" tmp
  detail="$(printf '%s' "$detail" | tr '\r\n\t' '   ')"
  detail="${detail:0:300}"
  [[ -n "${detail//[[:space:]]/}" ]] || detail="$reason"
  [[ -e "$VERDICT" || -L "$VERDICT" ]] && return 0
  tmp="$VDIR/.$T.$A.checker-codex.skip.$$"
  if printf 'REASON: %s\nDETAIL: %s\nTASK: %s\nATTEMPT: %s\n' "$reason" "$detail" "$T" "$A" > "$tmp" 2>/dev/null \
     && mv -f "$tmp" "$SKIPF" 2>/dev/null; then
    WROTE=1
  else
    rm -f "$tmp"
    echo "codex-check: cannot write $SKIPF" >&2
    return 1
  fi
  echo "codex-check: skip ($reason): $detail" >&2
}
fail() {                                      # fail <reason> <code> [tree-relative path]
  local d="${DETAILS[$2]:-${DETAILS[ce-internal]}}"
  [[ -n "${3:-}" ]] && d="$d: $3"
  skip "$1" "$d"
}
stop_fail() { fail "$@"; exit 0; }            # skip and finish: the first failure stops the run

compose() { docker compose --env-file /dev/null -p "$PROJECT" "${COMPOSE_FILES[@]}" "$@"; }

# Group-signal shield. `trap '' INT TERM HUP` does not protect the docker CLI (Go re-arms INT and
# TERM), so a signal sent to the harness's whole process group would kill a `docker rm` or
# `compose down` mid-teardown and leave a network behind. Every docker call the teardown makes runs
# in its OWN session (util-linux `setsid -w`: waits, relays the exit status), where a group signal
# cannot reach it. It must wrap the docker BINARY: a bash function cannot be setsid'd. Without
# setsid the call runs directly — a teardown step is never skipped.
SHIELD=""
shield() {
  if [[ -z "$SHIELD" ]]; then
    if command -v setsid >/dev/null 2>&1 && setsid -w true >/dev/null 2>&1; then SHIELD=1; else SHIELD=0; fi
  fi
  if [[ "$SHIELD" == 1 ]]; then setsid -w "$@"; else "$@"; fi
}
compose_shielded() { shield docker compose --env-file /dev/null -p "$PROJECT" "${COMPOSE_FILES[@]}" "$@"; }

stop_container() {                            # no Codex process may be alive while files are read
  [[ -z "$CNAME" ]] || shield docker rm -f -v "$CNAME" >/dev/null 2>&1
  return 0
}

teardown() {
  local ids
  if [[ "$PROXY_UP" == 1 && -n "$TMP" ]]; then
    compose_shielded logs --no-color --no-log-prefix proxy > "$TMP/proxy.log" 2>/dev/null
  fi
  compose_shielded down --volumes --remove-orphans --timeout 5 >/dev/null 2>&1
  ids="$(shield docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null)"
  [[ -z "$ids" ]] || shield docker rm -f -v $ids >/dev/null 2>&1
  ids="$(shield docker network ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null)"
  [[ -z "$ids" ]] || shield docker network rm $ids >/dev/null 2>&1
  ids="$(shield docker volume ls -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null)"
  [[ -z "$ids" ]] || shield docker volume rm -f $ids >/dev/null 2>&1
}

# Keep-or-drop (step 7): copy what is clean out of the private dir into the audit
# dir. Nothing is redacted; a crash here leaves only files that were already
# checked (each is written after its own check).
keep_or_drop() {
  local res
  [[ -n "$TMP" && -d "$AUD" ]] || return 0
  if ! res="$(pys keep "$TMP/out" "$TMP/events.jsonl" "$TMP/proxy.log" "$AUD" --auth "$CODEX_AUTH" 2>/dev/null)" || [[ "$res" != ok* ]]; then
    echo "codex-check: keep-or-drop failed; nothing further was copied into $AUD" >&2
  fi
  [[ -e "$AUD/dropped.txt" ]] || : > "$AUD/dropped.txt"
}

cleanup() {
  local rc=$?
  trap '' INT TERM HUP                        # once cleanup starts it ignores further signals
  trap - EXIT
  [[ -z "$RUNPID" ]] || kill "$RUNPID" 2>/dev/null
  [[ -z "$WATCHDOG" ]] || kill "$WATCHDOG" 2>/dev/null
  if [[ "$WROTE" == 0 && ! -e "$VERDICT" && ! -L "$VERDICT" ]]; then
    fail container-error "${INTERRUPTED:-ce-crashed}"
  fi
  # order: stop the container -> capture the proxy log -> tear the project down -> keep-or-drop -> delete the private dir
  stop_container
  [[ -z "$PROJECT" ]] || teardown
  (( CONTAINER_RAN )) && keep_or_drop
  [[ -z "$VTMP" ]] || rm -f "$VTMP"
  if [[ -n "$TMP" ]]; then
    chmod -R u+rwX "$TMP" 2>/dev/null
    rm -rf "$TMP"
  fi
  # nothing recorded and no verdict standing: not handled
  [[ "$WROTE" == 1 || -e "$VERDICT" ]] || (( rc != 0 )) || rc=1
  exit "$rc"
}
trap cleanup EXIT
trap 'trap "" INT TERM HUP; INTERRUPTED=ce-interrupted; exit 130' INT
trap 'trap "" INT TERM HUP; INTERRUPTED=ce-interrupted; exit 143' TERM
trap 'trap "" INT TERM HUP; INTERRUPTED=ce-interrupted; exit 129' HUP

# the audit dir is emptied at the start of every handled run — everything in it
if [[ -L "$AUD" ]] || ! mkdir -p "$SWARM_DIR/codex" 2>/dev/null; then stop_fail container-error ce-audit; fi
if [[ -e "$AUD" ]]; then chmod -R u+rwX "$AUD" 2>/dev/null; rm -rf -- "$AUD" 2>/dev/null; fi
mkdir "$AUD" 2>/dev/null && mkdir "$AUD/out" 2>/dev/null || stop_fail container-error ce-audit
: > "$AUD/dropped.txt"

# --- step 1: preconditions -------------------------------------------------------------
EXCLUDE="$SWARM_DIR/codex.exclude"
CRITERIA="$SWARM_DIR/codex/$T.$A.criteria.md"
MAN="$SWARM_DIR/manifests/$T.$A.files"
SIDE="$SWARM_DIR/manifests/$T.$A.sha256"
[[ -f "$EXCLUDE" ]]  || stop_fail no-exclude-policy pre-exclude
[[ -f "$CRITERIA" ]] || stop_fail no-criteria pre-criteria
[[ -f "$MAN" && -f "$SIDE" ]] || stop_fail no-evidence pre-evidence
[[ -f "$CODEX_BIN" && -x "$CODEX_BIN" ]] || stop_fail no-codex pre-codex
[[ -f "$CODEX_AUTH" && -r "$CODEX_AUTH" ]] || stop_fail auth unreadable
timeout 60 docker info >/dev/null 2>&1 && timeout 60 docker compose version >/dev/null 2>&1 \
  || stop_fail docker-unavailable pre-docker

# --- step 1b: login freshness gate, before any container starts -------------------------
# A read-only auth.json cannot stop Codex from spending the refresh token inside the
# container, which could leave the user's own login stale. A login near refresh is a
# skip, so the user refreshes it once on this machine. The same call reads the auth
# secrets: they go to memory (stdout of a pipe) and never to a file.
res="$(py auth "$CODEX_AUTH" "$CODEX_TIMEOUT" 2>/dev/null)" || stop_fail container-error ce-internal
IFS=$'\t' read -r kind r1 r2 <<< "$res"
case "$kind" in
  ok)   SECRETS_JSON="$r1" ;;
  skip) stop_fail "$r1" "$r2" ;;
  *)    stop_fail container-error ce-internal ;;
esac

# --- step 2: the data-free copy (steps 2 and 3 run in tools.py: copy) -------------------
TMP="$(mktemp -d "${TMPDIR:-/tmp}/codex-check.XXXXXX")" || stop_fail container-error ce-tmp
chmod 700 "$TMP"
WORK="$TMP/work"; CHOME="$TMP/codex-home"; GOMOD="$TMP/gomodcache"; POUT="$TMP/out"
mkdir "$POUT" || stop_fail container-error ce-tmp                 # the PRIVATE /out: never the audit dir
res="$(pys copy "$SWARM_TREE" "$WORK" "$EXCLUDE" "$MAN" "$SIDE" "$AUD/files.txt" "$AUD/excluded.txt" 2>/dev/null)" \
  || stop_fail container-error ce-copy
IFS=$'\t' read -r kind r1 r2 r3 <<< "$res"
case "$kind" in
  ok)   MANIFEST_SHA256="$r1" ;;
  skip) stop_fail "$r1" "$r2" "$r3" ;;
  *)    stop_fail container-error ce-copy ;;
esac

# --- step 4a: a per-run module-cache SUBSET, only for a Go target -----------------------
USE_GO=0
if [[ -f "$WORK/go.mod" ]]; then
  USE_GO=1
  command -v go >/dev/null 2>&1 || stop_fail container-error ce-nogo
  hostcache="$(cd / && GOTOOLCHAIN=local go env GOMODCACHE 2>/dev/null)"
  [[ -n "$hostcache" && -d "$hostcache/cache/download" ]] || stop_fail container-error ce-nocache
  mkdir -p "$GOMOD"
  cp -p "$WORK/go.mod" "$TMP/go.mod.orig"
  if [[ -e "$WORK/go.sum" ]]; then cp -p "$WORK/go.sum" "$TMP/go.sum.orig"; fi
  ( cd "$WORK" && env GOMODCACHE="$GOMOD" GOPROXY="file://$hostcache/cache/download" GOSUMDB=off \
      GOFLAGS=-mod=mod GOTOOLCHAIN=local go mod download ) > "$TMP/gomod.log" 2>&1
  gorc=$?
  cp -p "$TMP/go.mod.orig" "$WORK/go.mod"     # the copy stays exactly what the fingerprints verified
  if [[ -e "$TMP/go.sum.orig" ]]; then cp -p "$TMP/go.sum.orig" "$WORK/go.sum"; else rm -f "$WORK/go.sum"; fi
  (( gorc == 0 )) || stop_fail container-error ce-gomod
fi

# --- step 4b: the container — compose project, images rebuilt every run -----------------
mkdir -p "$CHOME"
: > "$CHOME/config.toml"                      # an EMPTY config: no MCP, plugins, hooks or user instructions
: > "$CHOME/auth.json"                        # the mount point for $CODEX_AUTH (so docker creates nothing)
chmod 700 "$CHOME"
export CD_WORK="$WORK" CD_CODEX_BIN="$(realpath "$CODEX_BIN")" CD_CODEX_HOME="$CHOME" CD_AUTH="$(realpath "$CODEX_AUTH")" \
       CD_OUT="$POUT" CD_SCHEMA="$CODEX_DIR/verdict.schema.json" CD_GOMOD="$GOMOD"
unset COMPOSE_FILE COMPOSE_PROFILES COMPOSE_PROJECT_NAME COMPOSE_ENV_FILES COMPOSE_PATH_SEPARATOR
COMPOSE_FILES=(-f "$CODEX_DIR/compose.yaml")
for HOSTBIN in "$(dirname "$CODEX_BIN")/codex-code-mode-host" "$(dirname "$CD_CODEX_BIN")/codex-code-mode-host"; do
  if [[ -f "$HOSTBIN" && -x "$HOSTBIN" ]]; then
    export CD_CODEX_HOST="$(realpath "$HOSTBIN")"
    COMPOSE_FILES+=(-f "$CODEX_DIR/compose.host.yaml")
    break
  fi
done
(( USE_GO )) && COMPOSE_FILES+=(-f "$CODEX_DIR/compose.go.yaml")
PROJECT="agents2-codex-$$-$RANDOM$RANDOM"

# the fixed-name images are REBUILT (layer-cached) at the start of EVERY run: a stale or foreign
# image under either tag must never decide the isolation (SPEC ruling CD-g)
compose build > "$TMP/build.log" 2>&1 || stop_fail container-error ce-build
PROXY_UP=1
compose up -d --no-build --wait --wait-timeout 90 proxy > "$TMP/up.log" 2>&1 || stop_fail container-error ce-proxy

# --- step 5: Codex ------------------------------------------------------------------------
{
  cat "$CODEX_DIR/brief.md"
  printf '\n\n## About this copy\n\n'
  cat <<'ABOUT'
/work is a data-free copy of the repository, made for this check by a script. The script never reads or copies, and so /work does not contain:

- any path with a segment named exactly `data` (a directory or a file);
- any file whose name starts with `.env` or ends in `.pem` or `.key`;
- anything under a `.codex`, `.claude` or `.agents` directory, or under a directory whose name starts with `.swarm`;
- any `AGENTS.md` or `AGENTS.override.md`, at any depth;
- `.git` (the copy has no version-control history);
- every path the team listed as personal or private for this run.

ABOUT
  printf 'Omitted paths (%s):\n' "$(wc -l < "$AUD/excluded.txt")"
  if [[ -s "$AUD/excluded.txt" ]]; then sed 's/^/- /' "$AUD/excluded.txt"; else echo '- (none)'; fi
  printf '\nA check that fails only because one of these omitted files is missing is an artefact of the copy, not a defect in the work: do not count it as a failure; mention it under observations.\n\n'
  cat "$CRITERIA"
} > "$TMP/prompt.md"

CNAME="$PROJECT-checker"
TFLAG="$TMP/timed-out"
CONTAINER_RAN=1                               # from here on keep-or-drop runs on every exit path
compose --progress quiet run -T --no-deps --name "$CNAME" checker \
    /opt/codex/codex exec --dangerously-bypass-approvals-and-sandbox --ephemeral --ignore-rules \
    --skip-git-repo-check -m "$CODEX_MODEL" -C /work --json \
    --output-schema /schema/verdict.schema.json -o /out/last.json - \
    < "$TMP/prompt.md" > "$TMP/events.jsonl" 2> "$TMP/codex.stderr" &
RUNPID=$!
( timeout "$CODEX_TIMEOUT" tail --pid="$RUNPID" -f /dev/null 2>/dev/null; wrc=$?
  if (( wrc == 124 )); then
    : > "$TFLAG"; docker kill "$CNAME" >/dev/null 2>&1
    timeout 20 tail --pid="$RUNPID" -f /dev/null 2>/dev/null || kill -9 "$RUNPID" 2>/dev/null
  fi ) &
WATCHDOG=$!
# Poll, don't sit in a bare `wait`: bash's wait builtin defers a SIGINT behind a simultaneously
# pending SIGTERM, so a group INT + TERM would exit 143 instead of 130. Between polls every pending
# trap runs in signal order (INT first). The `wait` below only collects the status of a dead child.
while kill -0 "$RUNPID" 2>/dev/null; do sleep 0.2; done
wait "$RUNPID"; runrc=$?
kill "$WATCHDOG" 2>/dev/null; wait "$WATCHDOG" 2>/dev/null
RUNPID=""; WATCHDOG=""

started="$(docker inspect -f '{{.State.StartedAt}}' "$CNAME" 2>/dev/null)"
exitc="$(docker inspect -f '{{.State.ExitCode}}' "$CNAME" 2>/dev/null)"
stop_container                                # the checker is dead before anything it wrote is read
if [[ -z "$started" || "$started" == 0001-* ]]; then
  stop_fail container-error ce-nostart
fi
[[ "$exitc" =~ ^[0-9]+$ ]] || exitc="$runrc"
LAST="$POUT/last.json"
# "No last.json" means NO directory entry of that name. If Codex left /out unsearchable (mode 000)
# the harness cannot establish that, so last.json counts as PRESENT and step 7 judges it (an answer
# that cannot be read is schema-invalid). The dir's mode is never changed.
have_last=0
if [[ -e "$LAST" || -L "$LAST" ]]; then have_last=1                # ANY directory entry of that name counts
elif [[ -d "$POUT" && ! -x "$POUT" ]]; then have_last=1; fi       # unsearchable: presence cannot be ruled out

# --- step 6: failure classification -------------------------------------------------------
if [[ -f "$TFLAG" ]]; then
  stop_fail timeout timeout
fi
if (( exitc != 0 || have_last == 0 )); then
  res="$(py classify "$TMP/events.jsonl" "$TMP/codex.stderr" 2>/dev/null)" || stop_fail container-error ce-internal
  case "$res" in
    $'ok\tquota') stop_fail quota quota ;;
    $'ok\tauth')  stop_fail auth auth-rejected ;;
    *)            stop_fail codex-error codex-fail ;;
  esac
fi

# --- step 6b: Codex could not run commands — a FAIL from it would be worthless -------------
res="$(py tools "$TMP/events.jsonl" 2>/dev/null)" || stop_fail container-error ce-internal
if [[ "$res" == $'ok\tunavailable' ]]; then
  stop_fail codex-error tools
fi

# --- steps 7 + 8: the answer (regular, <= 4 MiB, secret-free), the schema, the verdict -----
# The secret set is the pre-run one (environment) unioned with the live auth file.
version="$(timeout 20 "$CODEX_BIN" --version 2>/dev/null < /dev/null | head -n 1)"
[[ -n "$version" ]] || version=unknown
VTMP="$VDIR/.$T.$A.checker-codex.verdict.$$"
res="$(pys verdict "$LAST" "$CODEX_DIR/verdict.schema.json" "$T" "$A" "$MANIFEST_SHA256" \
        "$CODEX_MODEL" "$version" "$VTMP" --auth "$CODEX_AUTH" 2>/dev/null)" \
  || stop_fail container-error ce-internal
IFS=$'\t' read -r kind r1 r2 <<< "$res"
case "$kind" in
  ok)   ;;
  skip) stop_fail "$r1" "$r2" ;;
  *)    stop_fail container-error ce-internal ;;
esac
# ln, not mv: a verdict that appeared meanwhile is never replaced
if ln "$VTMP" "$VERDICT" 2>/dev/null; then
  rm -f "$SKIPF"; WROTE=1
  echo "codex-check: wrote $VERDICT" >&2
else
  echo "codex-check: $VERDICT appeared meanwhile — left untouched" >&2
fi
exit 0
