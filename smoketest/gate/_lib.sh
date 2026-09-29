# Shared helpers for gate.sh tests. Source, don't execute.
GATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../swarm" && pwd)/gate.sh"
FAILN=0
assert_rc()     { if [[ "$2" == "$3" ]]; then echo "ok   - $1"; else echo "FAIL - $1 (want rc $2 got $3)"; FAILN=$((FAILN+1)); fi; }
assert_file()   { if [[ -e "$2" ]];   then echo "ok   - $1"; else echo "FAIL - $1 (missing $2)"; FAILN=$((FAILN+1)); fi; }
assert_nofile() { if [[ ! -e "$2" ]]; then echo "ok   - $1"; else echo "FAIL - $1 (unexpected $2)"; FAILN=$((FAILN+1)); fi; }
assert_grep()   { if grep -q -- "$3" <<<"$2"; then echo "ok   - $1"; else echo "FAIL - $1 (no match for '$3')"; FAILN=$((FAILN+1)); fi; }
# A swarm dir plus a sibling `tree/` that stands in for the target repo —
# gate.sh re-hashes manifest paths against SWARM_TREE, which run_gate points
# at it.
newswarm()  { local d; d=$(mktemp -d); mkdir -p "$d/verdicts" "$d/manifests" "$d/flags" "$d/tier3" "$d/tree"; echo "$d"; }
mkledger()  { printf '%b' "$2" > "$1/ledger.tsv"; }         # $1=swarmdir  $2=body with \t \n
# mkmanifest sd task attempt [paths...] — creates each path in tree/ (unless
# it already exists), writes the .files manifest and the .sha256 fingerprint
# sidecar exactly as the worker contract does (sha256sum format).
mkmanifest() {
  local sd="$1" task="$2" attempt="$3"; shift 3
  local -a paths=("$@"); (( ${#paths[@]} )) || paths=("src/$task.txt")
  local p
  : > "$sd/manifests/$task.$attempt.files"
  : > "$sd/manifests/$task.$attempt.sha256"
  for p in "${paths[@]}"; do
    mkdir -p "$sd/tree/$(dirname "$p")"
    [[ -e "$sd/tree/$p" ]] || echo "content of $p" > "$sd/tree/$p"
    echo "$p" >> "$sd/manifests/$task.$attempt.files"
    (cd "$sd/tree" && sha256sum "$p") >> "$sd/manifests/$task.$attempt.sha256"
  done
}
fingerprint() { sha256sum "$1/manifests/$2.$3.sha256" | cut -d' ' -f1; }   # sd task attempt
# mkverdict sd task attempt name verdict family — writes a schema-valid
# verdict. Creates a default manifest+fingerprint for (task, attempt) when
# none exists yet, and stamps MANIFEST_SHA256 with the sidecar's hash, so a
# test that is not ABOUT fingerprints gets a consistent evidence set for free.
mkverdict() {
  local sd="$1" task="$2" attempt="$3" name="$4" verdict="$5" fam="$6"
  [[ -f "$sd/manifests/$task.$attempt.sha256" ]] || mkmanifest "$sd" "$task" "$attempt"
  printf 'VERDICT: %s\nCHECKER: %s\nFAMILY: %s\nTASK: %s\nATTEMPT: %s\nMANIFEST_SHA256: %s\n---\nevidence\n' \
    "$verdict" "$name" "$fam" "$task" "$attempt" "$(fingerprint "$sd" "$task" "$attempt")" \
    > "$sd/verdicts/$task.$attempt.$name.verdict"
}
# mkverdict_nofp — same, but WITHOUT the MANIFEST_SHA256 header (pre-2026-09-18 shape).
mkverdict_nofp() {
  printf 'VERDICT: %s\nCHECKER: %s\nFAMILY: %s\nTASK: %s\nATTEMPT: %s\n---\nevidence\n' \
    "$5" "$4" "$6" "$2" "$3" > "$1/verdicts/$2.$3.$4.verdict"
}
run_gate()  { local sd="$1"; shift; SWARM_DIR="$sd" SWARM_TREE="$sd/tree" bash "$GATE" "$@" >/dev/null 2>&1; return $?; }
gate_out()  { local sd="$1"; shift; SWARM_DIR="$sd" SWARM_TREE="$sd/tree" bash "$GATE" "$@" 2>&1; }
finish()    { (( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }; }
