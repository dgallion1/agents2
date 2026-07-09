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
  shopt -s nullglob; local f=("$VERDICTS/$1.$2."*.verdict); printf '%s\n' "${f[@]}"
}

# --- per-tier acceptance ----------------------------------------------------
check_tier1() {                                                      # task attempt checks
  local task="$1" attempt="$2" checks="$3" c f v
  [[ "$checks" == "-" || -z "$checks" ]] && return 0
  IFS=',' read -ra req <<<"$checks"
  for c in "${req[@]}"; do
    f="$VERDICTS/$task.$attempt.checker-$c.verdict"
    [[ -f "$f" ]] || fail "$task: missing verdict from checker-$c (attempt $attempt)"
    v=$(field_of "$f" VERDICT); [[ "$v" == PASS ]] || fail "$task: checker-$c returned ${v:-none}"
  done
}
check_tier2() {                                                      # task attempt
  local task="$1" attempt="$2" f v fam has_fail=0 up=0 ov=0
  local files; mapfile -t files < <(verdict_files "$task" "$attempt")
  (( ${#files[@]} )) || fail "$task: no verdicts for attempt $attempt"
  declare -A passfam=()
  for f in "${files[@]}"; do
    v=$(field_of "$f" VERDICT); fam=$(field_of "$f" FAMILY)
    case "$v" in
      PASS)     [[ -n "$fam" ]] && passfam[$fam]=1 ;;
      FAIL)     has_fail=1 ;;
      UPHOLD)   up=$((up+1)) ;;
      OVERRULE) ov=$((ov+1)) ;;
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

# --- subcommands ------------------------------------------------------------
cmd_check() {
  local task="${1:-}"; [[ -n "$task" ]] || die "usage: gate.sh check <task-id>"
  validate_ledger
  local row; row=$(row_for "$task"); [[ -n "$row" ]] || fail "$task: not in ledger"
  local tier checks attempt; tier=$(col "$row" 2); checks=$(col "$row" 3); attempt=$(col "$row" 5)
  if [[ -f "$FLAGS/$task.flag" ]]; then
    local target; target=$(field_of "$FLAGS/$task.flag" TARGET_TIER)
    (( tier < target )) && fail "$task: escalation pending — bump tier to $target then re-verify"
  fi
  case "$tier" in
    1) check_tier1 "$task" "$attempt" "$checks" ;;
    2) check_tier2 "$task" "$attempt" ;;
    3) check_tier3 "$task" "$attempt" ;;
  esac
  echo "OK: $task accepted at tier $tier (attempt $attempt)"
}

main() {
  local cmd="${1:-}"; shift || true
  case "$cmd" in
    check) cmd_check "$@" ;;
    *)     die "usage: gate.sh {check|escalate-scan|done} ..." ;;
  esac
}
main "$@"
