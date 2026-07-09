#!/usr/bin/env bash
set -u
SWARM_SCRIPTS="$(cd "$(dirname "$0")/../../swarm" && pwd)"
FAILN=0
ok(){ echo "ok   - $1"; }; bad(){ echo "FAIL - $1"; FAILN=$((FAILN+1)); }

# Build a throwaway git repo to host the worktrees.
repo=$(mktemp -d); cd "$repo"
git init -q; git config user.email t@t; git config user.name t
echo hello > app.txt; git add app.txt; git commit -qm init
export SWARM_DIR="$repo/.swarm"; mkdir -p "$SWARM_DIR/tier3/tX"

# setup creates two worktrees
bash "$SWARM_SCRIPTS/tier3-setup.sh" tX >/dev/null 2>&1
n=$(git worktree list | grep -c "tier3/tX")
[[ "$n" == 2 ]] && ok "setup creates 2 worktrees" || bad "setup worktrees ($n)"

# an oracle that just prints the file contents; both worktrees identical here
cat > "$SWARM_DIR/tier3/tX/accept.sh" <<'EOF'
#!/usr/bin/env bash
echo "check-1: $(cat app.txt)"
EOF
chmod +x "$SWARM_DIR/tier3/tX/accept.sh"

bash "$SWARM_SCRIPTS/tier3-compare.sh" tX >/dev/null 2>&1
rep="$SWARM_DIR/tier3/tX/report.md"
[[ -f "$rep" ]] && ok "compare writes report" || bad "no report"
grep -q 'check-1' "$rep" && ok "report has oracle output" || bad "report missing output"
grep -q '^RESOLUTION:' "$rep" && bad "report should NOT pre-fill RESOLUTION" || ok "no premature RESOLUTION"

git worktree remove --force "$repo/.swarm/tier3/tX/wt-glm"   2>/dev/null
git worktree remove --force "$repo/.swarm/tier3/tX/wt-local" 2>/dev/null
(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
