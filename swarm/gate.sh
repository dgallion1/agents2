#!/usr/bin/env bash
# gate.sh — mechanical acceptance gate for the tiered-verification swarm.
# No LLM calls. Reads the evidence ledger + verdict/manifest/flag files and
# decides whether tasks may be accepted. Exit 0 = ok, 1 = not acceptable,
# 2 = usage or ledger corruption.
set -u

SWARM_DIR="${SWARM_DIR:-.swarm}"
LEDGER="$SWARM_DIR/ledger.tsv"
VERDICTS="$SWARM_DIR/verdicts"
MANIFESTS="$SWARM_DIR/manifests"
FLAGS="$SWARM_DIR/flags"
GLOBS="$SWARM_DIR/critical.globs"

die()  { echo "gate: $*" >&2; exit 2; }
fail() { echo "FAIL: $*"; exit 1; }

# --- ledger helpers ---------------------------------------------------------
validate_ledger() {
  [[ -f "$LEDGER" ]] || die "no ledger at $LEDGER"
  local n=0 line ntab tier attempt
  while IFS= read -r line || [[ -n "$line" ]]; do
    n=$((n+1))
    [[ -z "$line" || "$line" == \#* ]] && continue
    ntab=$(awk -F'\t' '{print NF}' <<<"$line")
    [[ "$ntab" == 7 ]]           || die "ledger line $n: expected 7 fields, got $ntab"
    tier=$(cut -f2 <<<"$line"); attempt=$(cut -f5 <<<"$line")
    [[ "$tier" =~ ^[123]$ ]]     || die "ledger line $n: bad tier '$tier'"
    [[ "$attempt" =~ ^[0-9]+$ ]] || die "ledger line $n: bad attempt '$attempt'"
  done < "$LEDGER"
}
row_for()  { awk -F'\t' -v t="$1" '$1==t{print; exit}' "$LEDGER"; }
col()      { cut -f"$2" <<<"$1"; }                                   # col "<row>" N
field_of() { grep -m1 "^$2:" "$1" 2>/dev/null | sed "s/^$2:[[:space:]]*//"; }
verdict_files() {                                                    # task attempt
  # Print nothing when the glob matches nothing: printf on an empty array
  # still emits one empty line, which the caller would mapfile into a
  # phantom entry and then report as "invalid verdict: missing file"
  # instead of the accurate "no verdicts for attempt N".
  shopt -s nullglob; local f=("$VERDICTS/$1.$2."*.verdict)
  (( ${#f[@]} )) || return 0
  printf '%s\n' "${f[@]}"
}

# --- verdict schema ---------------------------------------------------------
# SPEC.md §2a: KEY: value headers (VERDICT, CHECKER, FAMILY, TASK, ATTEMPT),
# then a `---` separator, then evidence. Filename must agree with headers.
# VERDICT ∈ {PASS,FAIL,UPHOLD,OVERRULE}; FAMILY ∈ {anthropic,adversarial,impact,
# glm,local}. FAMILY names an INDEPENDENCE LANE, not a vendor: two verdicts in
# the same lane are treated as correlated and do not satisfy the Tier-2 quorum.
# glm and local are retained only so verdicts written before 2026-08-19 still
# validate; no current agent writes them.
#
# On success sets: _vv _vc _vf _vt _va  and returns 0.
# On failure sets: _verr and returns 1. Never use command-substitution around
# this function — globals must land in the caller's shell.
load_verdict() {                                                     # file [expected_task] [expected_attempt]
  local f="$1" exp_task="${2:-}" exp_attempt="${3:-}"
  local base prefix checker_from_name
  local verdict checker family task attempt

  _verr=""; _vv=""; _vc=""; _vf=""; _vt=""; _va=""

  [[ -f "$f" ]] || { _verr="missing file $f"; return 1; }
  base=$(basename "$f")

  if [[ -n "$exp_task" && -n "$exp_attempt" ]]; then
    prefix="${exp_task}.${exp_attempt}."
    case "$base" in
      "$prefix"*.verdict) ;;
      *) _verr="$base: filename does not match task=$exp_task attempt=$exp_attempt"; return 1 ;;
    esac
    checker_from_name="${base#"$prefix"}"
    checker_from_name="${checker_from_name%.verdict}"
    [[ -n "$checker_from_name" ]] || { _verr="$base: empty checker in filename"; return 1; }
  else
    # Best-effort parse: <task>.<attempt>.<checker>.verdict (task may contain dots).
    if [[ ! "$base" =~ ^(.+)\.([0-9]+)\.(.+)\.verdict$ ]]; then
      _verr="$base: unparseable verdict filename"; return 1
    fi
    exp_task="${BASH_REMATCH[1]}"
    exp_attempt="${BASH_REMATCH[2]}"
    checker_from_name="${BASH_REMATCH[3]}"
  fi

  # Require the separator line (exact ---).
  grep -qx -- '---' "$f" || { _verr="$base: missing '---' separator"; return 1; }

  verdict=$(field_of "$f" VERDICT)
  checker=$(field_of "$f" CHECKER)
  family=$(field_of "$f" FAMILY)
  task=$(field_of "$f" TASK)
  attempt=$(field_of "$f" ATTEMPT)

  [[ -n "$verdict" ]]  || { _verr="$base: missing VERDICT"; return 1; }
  [[ -n "$checker" ]]  || { _verr="$base: missing CHECKER"; return 1; }
  [[ -n "$family" ]]   || { _verr="$base: missing FAMILY"; return 1; }
  [[ -n "$task" ]]     || { _verr="$base: missing TASK"; return 1; }
  [[ -n "$attempt" ]]  || { _verr="$base: missing ATTEMPT"; return 1; }

  case "$verdict" in
    PASS|FAIL|UPHOLD|OVERRULE) ;;
    *) _verr="$base: invalid VERDICT '$verdict'"; return 1 ;;
  esac
  case "$family" in
    anthropic|adversarial|impact|glm|local) ;;
    *) _verr="$base: invalid FAMILY '$family'"; return 1 ;;
  esac
  [[ "$attempt" =~ ^[0-9]+$ ]] || { _verr="$base: invalid ATTEMPT '$attempt'"; return 1; }

  # Filename ↔ header agreement (checker authorization + identity).
  [[ "$checker" == "$checker_from_name" ]] || {
    _verr="$base: CHECKER '$checker' != filename checker '$checker_from_name'"; return 1
  }
  [[ "$task" == "$exp_task" ]] || {
    _verr="$base: TASK '$task' != filename/ledger task '$exp_task'"; return 1
  }
  [[ "$attempt" == "$exp_attempt" ]] || {
    _verr="$base: ATTEMPT '$attempt' != filename/ledger attempt '$exp_attempt'"; return 1
  }

  _vv=$verdict; _vc=$checker; _vf=$family; _vt=$task; _va=$attempt
  return 0
}

# --- per-tier acceptance ----------------------------------------------------
check_tier1() {                                                      # task attempt checks
  local task="$1" attempt="$2" checks="$3" c f
  [[ "$checks" == "-" || -z "$checks" ]] && return 0
  IFS=',' read -ra req <<<"$checks"
  for c in "${req[@]}"; do
    f="$VERDICTS/$task.$attempt.checker-$c.verdict"
    [[ -f "$f" ]] || fail "$task: missing verdict from checker-$c (attempt $attempt)"
    load_verdict "$f" "$task" "$attempt" || fail "$task: invalid verdict checker-$c: $_verr"
    [[ "$_vv" == PASS ]] || fail "$task: checker-$c returned ${_vv:-none}"
  done
}
check_tier2() {                                                      # task attempt
  local task="$1" attempt="$2" f has_fail=0
  local files; mapfile -t files < <(verdict_files "$task" "$attempt")
  (( ${#files[@]} )) || fail "$task: no verdicts for attempt $attempt"

  declare -A passfam=()       # family -> 1
  declare -A passchecker=()   # checker -> family|fail
  declare -A judgefam=()      # family -> UPHOLD|OVERRULE
  declare -A judgechecker=()  # checker -> UPHOLD|OVERRULE
  local up=0 ov=0

  for f in "${files[@]}"; do
    load_verdict "$f" "$task" "$attempt" || fail "$task: invalid verdict $(basename "$f"): $_verr"
    case "$_vv" in
      PASS)
        if [[ -n "${passchecker[$_vc]:-}" ]]; then
          fail "$task: duplicate PASS checker '$_vc'"
        fi
        passchecker[$_vc]=$_vf
        passfam[$_vf]=1
        ;;
      FAIL)
        has_fail=1
        if [[ -n "${passchecker[$_vc]:-}" && "${passchecker[$_vc]}" != fail ]]; then
          fail "$task: checker '$_vc' has both PASS and FAIL"
        fi
        passchecker[$_vc]=fail
        ;;
      UPHOLD|OVERRULE)
        if [[ -n "${judgechecker[$_vc]:-}" ]]; then
          fail "$task: duplicate judge identity '$_vc'"
        fi
        if [[ -n "${judgefam[$_vf]:-}" ]]; then
          fail "$task: duplicate judge family '$_vf' (need unique judge identities)"
        fi
        judgechecker[$_vc]=$_vv
        judgefam[$_vf]=$_vv
        if [[ "$_vv" == UPHOLD ]]; then up=$((up+1)); else ov=$((ov+1)); fi
        ;;
    esac
  done

  if (( has_fail == 0 )); then
    (( ${#passfam[@]} >= 2 )) || fail "$task: need PASS from 2 families, have ${#passfam[@]}"
    return 0
  fi
  (( up + ov >= 3 )) || fail "$task: dispute needs >=3 judge verdicts, have $((up+ov))"
  (( ov > up ))      || fail "$task: judges upheld the FAIL ($ov overrule / $up uphold)"
}
check_tier3() {                                                     # task attempt
  local task="$1" attempt="$2" rep="$SWARM_DIR/tier3/$1/report.md"
  [[ -f "$rep" ]]                 || fail "$task: no divergence report at $rep"
  grep -q '^RESOLUTION:' "$rep"   || fail "$task: report has no RESOLUTION line"
  check_tier2 "$task" "$attempt"                                    # merged result still needs dual-family PASS
}

# --- escalation helpers -----------------------------------------------------
has_fail_at() {                                                    # task attempt
  local f
  for f in "$VERDICTS/$1.$2."*.verdict; do
    [[ -f "$f" ]] || continue
    load_verdict "$f" "$1" "$2" || continue
    [[ "$_vv" == FAIL ]] && return 0
  done
  return 1
}
overrule_exists() {                                                # task
  local f
  for f in "$VERDICTS/$1."*.verdict; do
    [[ -f "$f" ]] || continue
    # Boss overrule may sit at any attempt; validate full schema via filename parse.
    load_verdict "$f" || continue
    [[ "$_vv" == OVERRULE && "$_vc" == boss ]] && return 0
  done
  return 1
}
# judges_overruled_at — 0 when a judge panel set aside the FAIL(s) at this
# attempt. Uses the SAME quorum check_tier2 uses to accept a disputed attempt
# (>=3 judge verdicts, strict OVERRULE majority), so the two halves of this
# tool cannot disagree about whether an attempt failed.
judges_overruled_at() {                                            # task attempt
  local f up=0 ov=0
  for f in "$VERDICTS/$1.$2."*.verdict; do
    [[ -f "$f" ]] || continue
    load_verdict "$f" "$1" "$2" || continue
    case "$_vv" in
      UPHOLD)   up=$((up+1)) ;;
      OVERRULE) ov=$((ov+1)) ;;
    esac
  done
  (( up + ov >= 3 && ov > up ))
}
# unresolved_fail_at — 0 when this attempt has a FAIL that no judge panel set
# aside. This is what "the task failed at attempt N" means for escalation.
unresolved_fail_at() {                                             # task attempt
  has_fail_at "$1" "$2" || return 1
  judges_overruled_at "$1" "$2" && return 1
  return 0
}
manifest_hits_glob() {                                             # task -> 0 if any path matches any glob
  [[ -f "$GLOBS" ]] || return 1
  local mans=() m
  for m in "$MANIFESTS/$1."*.files; do [[ -f "$m" ]] && mans+=("$m"); done
  (( ${#mans[@]} )) || return 1
  python3 - "$GLOBS" "${mans[@]}" <<'PY'
import sys, fnmatch
globs=[l.strip() for l in open(sys.argv[1]) if l.strip() and not l.startswith('#')]
paths=[]
for p in sys.argv[2:]:
    paths += [l.strip() for l in open(p) if l.strip()]
def matches(path, g):
    cands = {g}
    if g.startswith('**/'):
        cands.add(g[3:])                 # **/X also matches X at the root (zero leading dirs)
    if '/**' in g:
        cands.add(g.replace('/**', '/*'))
    return any(fnmatch.fnmatch(path, c) for c in cands)
for path in paths:
    for g in globs:
        if matches(path, g):
            sys.exit(0)
sys.exit(1)
PY
}

# --- no-change terminal status ----------------------------------------------
# no-change is terminal ONLY when the reason is audit-traceable (points at a
# written SPEC.md note or a dated ruling, matched as a hyphen-delimited TOKEN
# sequence, not a bare substring — "unsee-SPECIAL" must not count as
# "see-SPEC") AND no verdict was EVER written for this task, at ANY attempt
# (not just the attempt currently named in the ledger — bumping that column
# must not launder a real FAIL sitting on disk at an older attempt). A row
# that was actually checked (verdict files exist at any attempt) must not be
# closed as no-change — that would let a written FAIL be dodged by relabeling
# the row, so it fails loudly instead.
nochange_reason_ok() {                                              # reason -> 0/1
  local reason="$1" i n
  local -a tok
  IFS='-' read -ra tok <<<"$reason"
  n=${#tok[@]}
  for (( i=0; i+1<n; i++ )); do
    [[ "${tok[i]}" == see && "${tok[i+1]}" == SPEC ]] && return 0
  done
  for (( i=0; i+3<n; i++ )); do
    [[ "${tok[i]}" == ruling ]] || continue
    local yyyy="${tok[i+1]}" mm="${tok[i+2]}" ddsuf="${tok[i+3]}"
    [[ "$yyyy" =~ ^[0-9]{4}$ ]]                              || continue
    [[ "$mm" =~ ^(0[1-9]|1[0-2])$ ]]                         || continue
    [[ "$ddsuf" =~ ^(0[1-9]|[12][0-9]|3[01])[a-z]?$ ]]       || continue
    return 0
  done
  return 1
}
any_verdict_exists() {                                              # task -> 0/1
  # The "$1."* glob is a superset prefix match, not a task-id boundary: it
  # also catches files belonging to a sibling task where one task id is a
  # dot-prefix of the other (task "A" vs "A.1", in both directions). Confirm
  # ownership with load_verdict's own best-effort <task>.<attempt>.<checker>
  # parse (the same one filenameless calls like overrule_exists rely on)
  # rather than trusting the glob alone. A file the parser cannot make sense
  # of at all still blocks, conservatively, since we cannot rule it out.
  local f
  for f in "$VERDICTS/$1."*.verdict; do
    [[ -f "$f" ]] || continue
    if load_verdict "$f"; then
      [[ "$_vt" == "$1" ]] && return 0
    else
      return 0
    fi
  done
  return 1
}
check_no_change() {                                                  # task attempt reason
  local task="$1" reason="$3"
  any_verdict_exists "$task" && \
    fail "$task: status=no-change but a verdict file exists for this task (some attempt) — this row was checked, no-change is the wrong status"
  nochange_reason_ok "$reason" || \
    fail "$task: no-change reason '$reason' lacks audit-traceable justification (need see-SPEC or ruling-YYYY-MM-DD as tokens)"
  echo "no-change: $task ($reason)"
}

# --- subcommands ------------------------------------------------------------
# Core per-task validation used by both `check` and `done`.
check_task() {
  local task="${1:-}"; [[ -n "$task" ]] || die "usage: gate.sh check <task-id>"
  local row; row=$(row_for "$task"); [[ -n "$row" ]] || fail "$task: not in ledger"
  local tier checks status attempt reason
  tier=$(col "$row" 2); checks=$(col "$row" 3); status=$(col "$row" 4)
  attempt=$(col "$row" 5); reason=$(col "$row" 7)
  # The escalation flag is not a tier check — it applies to every status,
  # no-change included. Checking it first means a row already flagged for
  # mandatory re-verification (two-consecutive-fails / checker-overruled /
  # critical-glob) cannot be closed out from under the flag by relabeling it
  # no-change; the gate would otherwise report "no unresolved flags" while
  # one sits unread on disk.
  if [[ -f "$FLAGS/$task.flag" ]]; then
    local target; target=$(field_of "$FLAGS/$task.flag" TARGET_TIER)
    (( tier < target )) && fail "$task: escalation pending — bump tier to $target then re-verify"
  fi
  if [[ "$status" == no-change ]]; then
    # Terminal status: never runs through check_tier1/2/3, which demand
    # verdict files this row legitimately does not have.
    check_no_change "$task" "$attempt" "$reason"
    return 0
  fi
  case "$tier" in
    1) check_tier1 "$task" "$attempt" "$checks" ;;
    2) check_tier2 "$task" "$attempt" ;;
    3) check_tier3 "$task" "$attempt" ;;
  esac
  echo "OK: $task accepted at tier $tier (attempt $attempt)"
}

cmd_check() {
  validate_ledger
  check_task "$@"
}

cmd_escalate_scan() {
  validate_ledger
  mkdir -p "$FLAGS"
  local row task tier attempt reasons target flag ft
  while IFS= read -r row || [[ -n "$row" ]]; do
    [[ -z "$row" || "$row" == \#* ]] && continue
    task=$(col "$row" 1); tier=$(col "$row" 2); attempt=$(col "$row" 5)
    reasons=""
    if (( attempt >= 1 )) && unresolved_fail_at "$task" "$attempt" && unresolved_fail_at "$task" "$((attempt-1))"; then
      reasons+="two-consecutive-fails "
    fi
    overrule_exists "$task"    && reasons+="checker-overruled "
    manifest_hits_glob "$task" && reasons+="critical-glob "
    flag="$FLAGS/$task.flag"; target=$(( tier + 1 )); (( target > 3 )) && target=3
    if [[ -n "$reasons" ]]; then
      if [[ ! -f "$flag" ]] && (( tier < target )); then
        printf 'TARGET_TIER: %s\nREASON: %s\n' "$target" "${reasons% }" > "$flag"
        echo "flag: $task -> tier $target (${reasons% })"
      fi
    elif [[ -f "$flag" ]]; then
      ft=$(field_of "$flag" TARGET_TIER)
      (( tier >= ft )) && { rm -f "$flag"; echo "resolved: $task"; }
    fi
  done < "$LEDGER"
}

cmd_done() {
  validate_ledger
  local row task status missing=0 out rc
  while IFS= read -r row || [[ -n "$row" ]]; do
    [[ -z "$row" || "$row" == \#* ]] && continue
    task=$(col "$row" 1); status=$(col "$row" 4)
    if [[ "$status" != accepted && "$status" != no-change ]]; then
      echo "pending: $task (status=$status)"
      missing=1
      continue
    fi
    # Re-run the same per-task quorum/schema/flag/no-change validation as
    # `check`, so the two subcommands cannot disagree about a row's fate.
    # Subshell so fail()/exit does not abort the remaining ledger walk.
    out=$(check_task "$task" 2>&1)
    rc=$?
    if (( rc != 0 )); then
      echo "$out"
      missing=1
    elif [[ "$status" == no-change ]]; then
      # Never silent: a terminal no-change row must still be visible in the
      # `done` output even though it earned no verdict.
      echo "$out"
    fi
  done < "$LEDGER"
  (( missing == 0 )) || fail "run incomplete"
  echo "OK: all tasks accepted, evidence verified, no unresolved flags"
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    check)         cmd_check "$@" ;;
    escalate-scan) cmd_escalate_scan "$@" ;;
    done)          cmd_done "$@" ;;
    *)             die "usage: gate.sh {check|escalate-scan|done} ..." ;;
  esac
}
main "$@"
