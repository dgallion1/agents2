# Shared helpers for gate.sh tests. Source, don't execute.
GATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../swarm" && pwd)/gate.sh"
FAILN=0
assert_rc()     { if [[ "$2" == "$3" ]]; then echo "ok   - $1"; else echo "FAIL - $1 (want rc $2 got $3)"; FAILN=$((FAILN+1)); fi; }
assert_file()   { if [[ -e "$2" ]];   then echo "ok   - $1"; else echo "FAIL - $1 (missing $2)"; FAILN=$((FAILN+1)); fi; }
assert_nofile() { if [[ ! -e "$2" ]]; then echo "ok   - $1"; else echo "FAIL - $1 (unexpected $2)"; FAILN=$((FAILN+1)); fi; }
newswarm()  { local d; d=$(mktemp -d); mkdir -p "$d/verdicts" "$d/manifests" "$d/flags" "$d/tier3"; echo "$d"; }
mkledger()  { printf '%b' "$2" > "$1/ledger.tsv"; }         # $1=swarmdir  $2=body with \t \n
mkverdict() { printf 'VERDICT: %s\nCHECKER: %s\nFAMILY: %s\nTASK: %s\nATTEMPT: %s\n---\nevidence\n' \
                 "$5" "$4" "$6" "$2" "$3" > "$1/verdicts/$2.$3.$4.verdict"; } # sd task attempt name verdict family
run_gate()  { local sd="$1"; shift; SWARM_DIR="$sd" bash "$GATE" "$@" >/dev/null 2>&1; return $?; }
finish()    { (( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }; }
