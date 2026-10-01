#!/usr/bin/env bash
# CD1 oracle — swarm/codex-check.sh (attempt 3: .swarm/briefs/CD1.3.md;
# SPEC.md §8 CD-b…CD-n).
# Usage: accept.sh [TREE]   TREE = the agents2 tree holding the harness.
# Drives the REAL container with a STUB Codex and a FAKE auth file against
# throwaway fixture repos; never the real Codex, never the real auth.json.
# Prints "ORACLE PASS" as its last line only when every check passes.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
TREE="$(cd "${1:-$HERE/../../..}" && pwd)"
SCRIPT="$TREE/swarm/codex-check.sh"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/cd1-oracle.XXXXXX")"
SECRET=tok_FAKE_SECRET_0123456789abcdefXYZ
# the stub stands in for Codex; a fake code-mode host sits beside it, as the
# real one sits beside the bundled CLI (SPEC ruling CD-f)
mkdir -p "$WORK/bin"; cp "$HERE/stub-codex" "$WORK/bin/codex"; chmod +x "$WORK/bin/codex"
printf '#!/bin/sh\nexit 0\n' > "$WORK/bin/codex-code-mode-host"; chmod +x "$WORK/bin/codex-code-mode-host"
STUB="$WORK/bin/codex"
FAKE_AUTH="$WORK/fake-auth.json"; printf '{"tokens":{"access_token":"%s"},"short":"abc"}\n' "$SECRET" > "$FAKE_AUTH"
FAKE_SHA=$(sha256sum < "$FAKE_AUTH" | cut -d' ' -f1)
REAL_AUTH="$HOME/.codex/auth.json"
REAL_SHA0=$( [[ -f "$REAL_AUTH" ]] && sha256sum < "$REAL_AUTH" | cut -d' ' -f1 || echo none)
# an oracle-owned listener on the docker host: the positive control for "the
# container cannot reach host services"
HP=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1])')
mkdir -p "$WORK/www"; echo hostprobe > "$WORK/www/index.html"
python3 -m http.server "$HP" --bind 0.0.0.0 --directory "$WORK/www" >/dev/null 2>&1 & HPID=$!
trap 'kill $HPID 2>/dev/null; rm -rf "$WORK"' EXIT
NFAIL=0
ok()  { echo "ok   - $*"; }
bad() { echo "FAIL - $*"; NFAIL=$((NFAIL+1)); }
chk() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
echo "# CD1 oracle: TREE=$TREE"
[[ -f "$SCRIPT" ]] || { bad "no harness at $SCRIPT"; echo "ORACLE FAIL: $NFAIL check(s) failed"; exit 1; }
imgs() { docker images --format '{{.Repository}}:{{.Tag}}' | grep -v '^agents2-codex-' | LC_ALL=C sort; }
I0=$(imgs); C0=$(docker ps -aq | wc -l); N0=$(docker network ls -q | wc -l)
sleep 1; chk "H positive control: the oracle's host listener answers on 172.17.0.1:$HP" 'curl -s -m 5 "http://172.17.0.1:$HP/" | grep -q hostprobe'
HOSTIPS=$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | tr '\n' ' ')
HIP1=$(awk '{print $1}' <<<"$HOSTIPS")
chk "H positive control: the host listener answers on the host's own address $HIP1" 'curl -s -m 5 --noproxy "*" "http://$HIP1:$HP/" | grep -q hostprobe'

# --- fixture ---------------------------------------------------------------------
mkfx() {                                   # dir scenario [go]
  local d="$1" scen="$2" go="${3:-}"
  mkdir -p "$d/tree" "$d/swarm/verdicts" "$d/swarm/manifests" "$d/swarm/codex"
  ( cd "$d/tree" && git init -q && git config user.email o@o && git config user.name o
    printf '*.log\n' > .gitignore; echo readme > README.md
    mkdir -p src docs sub data pkg/data config .codex .claude .swarm-foo private .agents/skills data3 datasets "sp ace"
    echo app > src/app.txt; echo notes > docs/notes.md; echo "ünï" > "sp ace/ünï.txt"
    echo agents > AGENTS.md; echo sa > sub/AGENTS.md; echo so > sub/AGENTS.override.md; echo keep > sub/keep.txt
    echo live > data/live.csv; echo 'package data' > pkg/data/x.go; echo f > docs/data
    echo k3 > data3/keep.txt; echo ks > datasets/keep.txt
    echo SECRET=1 > .env; echo X=1 > config/.env.local; echo E=1 > .env.example; echo R=1 > .envrc
    echo pem > key.pem; echo key > secret.key; echo s > .agents/skills/s.md
    echo c > .codex/x.toml; echo c > .claude/y.md; echo z > .swarm-foo/z.txt
    echo household > PLANNING_LOG.md; echo p > private/notes.txt
    printf '#!/bin/sh\necho hi\n' > exe.sh; chmod 755 exe.sh; ln -s src/app.txt link-in; echo gone > gone.txt
    if [[ -n "$go" ]]; then printf 'module example.com/fx\n\ngo 1.26\n' > go.mod; printf 'package main\n\nfunc main() {}\n' > main.go; fi
    git add -A && git commit -qm fx && git rm -q gone.txt && git commit -qm rm
    echo new > new.txt; echo log > build.log
    printf 'src/app.txt\nPLANNING_LOG.md\ngone.txt\nsp ace/ünï.txt\n' > "$d/swarm/manifests/T.1.files"
    { sha256sum src/app.txt PLANNING_LOG.md; echo "deleted  gone.txt"; sha256sum "sp ace/ünï.txt"; } > "$d/swarm/manifests/T.1.sha256" )
  printf '# personal files\nPLANNING_LOG.md\nprivate/\n' > "$d/swarm/codex.exclude"
  printf 'Criteria for task T attempt 1.\n(a) the thing works.\nSTUB-SCENARIO: %s\nHOSTPROBE-PORT: %s\nHOSTIPS: %s\n' "$scen" "$HP" "$HOSTIPS" > "$d/swarm/codex/T.1.criteria.md"
}
run() {                                     # dir [extra env...] -> RC
  local d="$1"; shift
  mkdir -p "$d/htmp"
  ( cd "$TREE" && env TMPDIR="$d/htmp" SWARM_DIR="$d/swarm" SWARM_TREE="$d/tree" CODEX_BIN="$STUB" CODEX_AUTH="$FAKE_AUTH" \
      CODEX_MODEL=gpt-6-astra CODEX_TIMEOUT="${CT:-300}" "$@" bash "$SCRIPT" T 1 ) > "$d/run.log" 2>&1
  RC=$?
}
V() { echo "$1/swarm/verdicts/T.1.checker-codex.verdict"; }
K() { echo "$1/swarm/verdicts/T.1.checker-codex.skip"; }
A() { echo "$1/swarm/codex/T.1"; }
field() { grep -m1 "^$2:" "$1" 2>/dev/null | sed "s/^$2:[[:space:]]*//"; }
stubdir() { echo "$(A "$1")/out"; }            # the stub records flat files stub-* there
netok() { grep -q " rc=0" "$1"; }

# --- S: a stale image under the proxy's fixed name must be replaced -----------
# (SPEC CD-g) tag an image WITHOUT tinyproxy as agents2-codex-proxy:local; a
# harness that only builds when the tag is missing would run it, and every
# network check below would fail.
docker tag debian:bookworm-slim agents2-codex-proxy:local 2>/dev/null

# --- B: brief.md content -----------------------------------------------------------
B="$TREE/swarm/codex/brief.md"
chk "B brief.md names the data-free copy at /work" 'grep -q "/work" $B && grep -qi "data-free" $B'
chk "B brief.md asks for evidence per criterion" 'grep -qi evidence $B && grep -qi command $B'
chk "B brief.md never mentions a census, .swarm/verdicts or re-hashing" '! grep -qiE "census|\.swarm/verdicts|sha256sum -c" $B'

# --- P: the main PASS run (non-Go tree) --------------------------------------------
d="$WORK/pass"; mkfx "$d" pass; run "$d"
chk "P exit 0" '[[ $RC == 0 ]]'
chk "P wrote a verdict and no skip record" '[[ -f $(V $d) && ! -e $(K $d) ]]'
f=$(V "$d"); side_sha=$(sha256sum < "$d/swarm/manifests/T.1.sha256" | cut -d' ' -f1)
chk "P VERDICT: PASS"                 '[[ "$(field $f VERDICT)" == PASS ]]'
chk "P CHECKER: checker-codex"        '[[ "$(field $f CHECKER)" == checker-codex ]]'
chk "P FAMILY: crossvendor"           '[[ "$(field $f FAMILY)" == crossvendor ]]'
chk "P TASK/ATTEMPT"                  '[[ "$(field $f TASK)" == T && "$(field $f ATTEMPT)" == 1 ]]'
chk "P MANIFEST_SHA256 = sha256 of the sidecar" '[[ "$(field $f MANIFEST_SHA256)" == "$side_sha" ]]'
chk "P CODEX_MODEL: gpt-6-astra"      '[[ "$(field $f CODEX_MODEL)" == gpt-6-astra ]]'
chk "P CODEX_VERSION from the binary" '[[ "$(field $f CODEX_VERSION)" == "codex-cli stub-9.9.9" ]]'
chk "P '---' separator"               'grep -qx -- --- $f'
chk "P evidence: every criterion id with its result marker" 'grep -E "crit-a" $f | grep -q PASS && grep -E "crit-b" $f | grep -q PASS'
chk "P evidence: attack, command, result, observations" 'grep -q "tried Y" $f && grep -q "stub-cmd-a" $f && grep -q "stub-res-b" $f && grep -q "stub-obs-1" $f'
sd=$(stubdir "$d")
chk "P the stub's flat records and last.json are kept in out/" '[[ -f $sd/stub-argv && -f $(A $d)/out/last.json ]]'
exp_work=$'.gitignore\nREADME.md\ndata3/keep.txt\ndatasets/keep.txt\ndocs/notes.md\nexe.sh\nlink-in\nnew.txt\nsp ace/ünï.txt\nsrc/app.txt\nsub/keep.txt'
exp_excl=$'.agents/skills/s.md\n.claude/y.md\n.codex/x.toml\n.env\n.env.example\n.envrc\n.swarm-foo/z.txt\nAGENTS.md\nPLANNING_LOG.md\nconfig/.env.local\ndata/live.csv\ndocs/data\nkey.pem\npkg/data/x.go\nprivate/notes.txt\nsecret.key\nsub/AGENTS.md\nsub/AGENTS.override.md'
chk "P /work holds exactly the data-free copy" '[[ "$(cat $sd/stub-work-files)" == "$exp_work" ]]'
[[ "$(cat "$sd/stub-work-files" 2>/dev/null)" == "$exp_work" ]] || echo "#     /work: $(tr '\n' '|' < "$sd/stub-work-files" 2>/dev/null)"
chk "P files.txt == the copy, byte-order sorted" '[[ "$(cat $(A $d)/files.txt 2>/dev/null)" == "$exp_work" ]]'
chk "P excluded.txt == every excluded path, byte-order sorted" '[[ "$(cat $(A $d)/excluded.txt 2>/dev/null)" == "$exp_excl" ]]'
[[ "$(cat "$(A "$d")/excluded.txt" 2>/dev/null)" == "$exp_excl" ]] || echo "#     excluded: $(tr '\n' '|' < "$(A "$d")/excluded.txt" 2>/dev/null)"
chk "P the code-mode host beside CODEX_BIN is mounted, read-only, and /opt/codex holds only the two" '[[ "$(cat $sd/stub-codexdir)" == $'"'"'host:x\nhost:ro\ncodex codex-code-mode-host '"'"' ]]'
chk "P exec bit and symlink preserved" '[[ "$(cat $sd/stub-modes)" == $'"'"'exe:x\nlink:L'"'"' ]]'
argv=$(cat "$sd/stub-argv" 2>/dev/null)
for a in exec --dangerously-bypass-approvals-and-sandbox --ephemeral --ignore-rules --skip-git-repo-check --json; do
  chk "P codex flag $a" 'grep -qx -- "$a" <<<"$argv"'
done
chk "P -m gpt-6-astra"  'grep -A1 -x -- -m <<<"$argv" | tail -1 | grep -qx gpt-6-astra'
chk "P -C /work"        'grep -A1 -x -- -C <<<"$argv" | tail -1 | grep -qx /work'
chk "P --output-schema /schema/verdict.schema.json" 'grep -A1 -x -- --output-schema <<<"$argv" | tail -1 | grep -qx /schema/verdict.schema.json'
chk "P -o /out/last.json" 'grep -A1 -x -- -o <<<"$argv" | tail -1 | grep -qx /out/last.json'
chk "P no codex sandbox flag — the container is the sandbox" '! grep -qxE -- "-s|--sandbox" <<<"$argv"'
envf=$(cat "$sd/stub-env" 2>/dev/null)
chk "P runs as 1000:1000" 'grep -qx UID=1000 <<<"$envf" && grep -qx GID=1000 <<<"$envf"'
chk "P CODEX_HOME=/codex-home, HOME=/tmp/home" 'grep -qx CODEX_HOME=/codex-home <<<"$envf" && grep -qx HOME=/tmp/home <<<"$envf"'
chk "P HTTPS_PROXY=http://proxy:8888" 'grep -qx HTTPS_PROXY=http://proxy:8888 <<<"$envf"'
chk "P no module cache for a non-Go tree" 'grep -qx GOMODCACHE= <<<"$envf" && [[ "$(head -1 $sd/stub-gomodcache)" == absent ]]'
chk "P CODEX_HOME holds exactly auth.json + config.toml" '[[ "$(cat $sd/stub-codex-home-ls)" == $'"'"'auth.json\nconfig.toml'"'"' ]]'
chk "P config.toml is empty" '[[ "$(tr -d " " < $sd/stub-config-bytes)" == 0 ]]'
chk "P auth.json is the given CODEX_AUTH" '[[ "$(cat $sd/stub-auth-sha)" == "$FAKE_SHA" ]]'
chk "P auth.json is mounted read-only (ruling CD-j)" '[[ "$(cat $sd/stub-auth-mode)" == ro ]]'
chk "P no host path visible in the container" '[[ ! -s $sd/stub-host-paths ]]'
chk "P prompt carries the criteria" 'grep -q "STUB-SCENARIO: pass" $sd/stub-prompt'
chk "P prompt carries brief.md" 'grep -qF "$(grep -m1 . $B)" $sd/stub-prompt'
chk "P prompt lists the excluded paths (About this copy)" 'grep -qF PLANNING_LOG.md $sd/stub-prompt && grep -qF "sub/AGENTS.override.md" $sd/stub-prompt'
chk "P prompt never mentions a census" '! grep -qi census $sd/stub-prompt'
chk "P a host service on the docker host is unreachable" '! netok $sd/stub-net-host'
chk "P NO host address (gateway, LAN, tailnet, bridges) reachable on the listener port or 8080 (ruling CD-l)" '[[ -s $sd/stub-net-hostips ]] && ! grep -q " reachable$" $sd/stub-net-hostips'
grep -q " reachable$" "$sd/stub-net-hostips" 2>/dev/null && echo "#     reachable: $(grep " reachable$" "$sd/stub-net-hostips" | tr '\n' ' ')"
chk "P non-allowlisted host refused" '! netok $sd/stub-net-denied'
chk "P chatgpt.com reachable through the proxy" 'netok $sd/stub-net-allowed'
chk "P auth.openai.com reachable through the proxy" 'netok $sd/stub-net-auth'
chk "P api.openai.com reachable through the proxy" 'netok $sd/stub-net-api'
chk "P lookalike chatgpt.com.evil.invalid refused" '! netok $sd/stub-net-look1'
chk "P the suffix lookalike is refused BY THE FILTER (proxy.log), not just unresolvable" 'grep -i "chatgpt\.com\.evil\.invalid" $(A $d)/proxy.log | grep -qiE "refus|filter|denied|forbidden|403"'
chk "P lookalike evilchatgpt.com refused" '! netok $sd/stub-net-look2'
chk "P CONNECT through the proxy to port 80 of an allowed host refused" '! netok $sd/stub-net-port80'
chk "P plain-HTTP request through the proxy to a non-allowlisted host refused" '! grep -q "code=200" $sd/stub-net-plainhttp'
chk "P no direct egress bypassing the proxy" '! netok $sd/stub-net-direct'
chk "P proxy.log records the allowed host" 'grep -q "chatgpt\.com" $(A $d)/proxy.log'
chk "P proxy.log records the denied host as refused" 'grep -i "example\.com" $(A $d)/proxy.log | grep -qiE "refus|denied|filter|forbidden|403"'
chk "P events.jsonl captured" 'grep -q thread.started $(A $d)/events.jsonl'
chk "P no secret in any audit file" '! grep -rqF "$SECRET" $(A $d) $(V $d)'

# --- G: a Go tree — per-run module subset, read-only; toolchain works; FAIL ------
d="$WORK/go"; mkfx "$d" fail go; run "$d"; sd=$(stubdir "$d")
chk "G wrote a FAIL verdict" '[[ -f $(V $d) && "$(field $(V $d) VERDICT)" == FAIL && ! -e $(K $d) ]]'
chk "G GOMODCACHE=/gomodcache, GOPROXY=off" 'grep -qx GOMODCACHE=/gomodcache $sd/stub-env && grep -qx GOPROXY=off $sd/stub-env'
chk "G module cache mounted read-only" '[[ "$(head -1 $sd/stub-gomodcache)" == readonly ]]'
chk "G the module cache is a subset — none of the user's own modules" '[[ ! -s $sd/stub-gomodcache-private ]]'
chk "G the subset is small (a zero-dependency module needs ~nothing)" '[[ $(cat $sd/stub-gomodcache-count) -lt 50 ]]'
chk "G go build works offline in the container" 'grep -qx rc=0 $sd/stub-gobuild'
chk "G go.mod and main.go are in the copy" 'grep -qx go.mod $sd/stub-work-files && grep -qx main.go $sd/stub-work-files'

# --- K: every skip reason (exactly one output; exit 0) -----------------------------
skip_case() {                              # label reason dir
  local f; f=$(K "$3")
  if [[ $RC == 0 && -f "$f" && ! -e $(V "$3") && "$(field "$f" REASON)" == "$2" && "$(field "$f" TASK)" == T \
        && "$(field "$f" ATTEMPT)" == 1 && -n "$(field "$f" DETAIL)" ]]; then ok "K $1 → skip $2"
  else bad "K $1 → want skip $2, got rc=$RC skip='$(field "$f" REASON)' verdict=$([[ -e $(V "$3") ]] && echo yes || echo no) :: $(tail -2 "$3/run.log" | tr '\n' ' ')"; fi
}
n=0; nx() { n=$((n+1)); d="$WORK/k$n"; mkfx "$d" "$1" ${2:-}; }
nx pass; rm "$d/swarm/codex.exclude"; run "$d"; skip_case "no exclude policy" no-exclude-policy "$d"
nx pass; rm "$d/swarm/codex/T.1.criteria.md"; run "$d"; skip_case "no criteria" no-criteria "$d"
nx pass; rm "$d/swarm/manifests/T.1.sha256"; run "$d"; skip_case "no sidecar" no-evidence "$d"
nx pass; run "$d" CODEX_BIN=/nonexistent/codex; skip_case "no Codex binary" no-codex "$d"
nx pass; run "$d" CODEX_AUTH=/nonexistent/auth.json; skip_case "no auth file" auth "$d"
nx pass; run "$d" DOCKER_HOST=unix:///nonexistent/docker.sock; skip_case "docker unreachable" docker-unavailable "$d"
nx pass; ln -s /etc/hostname "$d/tree/link-abs"; run "$d"; skip_case "absolute symlink" unsafe-tree "$d"
nx pass; ln -s ../../outside.txt "$d/tree/sub/link-up"; run "$d"; skip_case "symlink escaping upward" unsafe-tree "$d"
nx pass; ln -s data/live.csv "$d/tree/link-data"; run "$d"; skip_case "symlink into an excluded path" unsafe-tree "$d"
nx pass; ln -s nothere.txt "$d/tree/link-dang"; run "$d"; skip_case "dangling symlink" unsafe-tree "$d"
nx pass; ln -s src "$d/tree/link-dir"; run "$d"; skip_case "directory symlink" unsafe-tree "$d"
nx pass; rm -rf "$d/tree/.git"; run "$d"; skip_case "tree is not a git work tree" unsafe-tree "$d"
nx pass; echo tampered >> "$d/tree/src/app.txt"; run "$d"; skip_case "content drift" fingerprint-mismatch "$d"
nx pass; echo back > "$d/tree/gone.txt"; run "$d"; skip_case "fingerprinted-deleted path present" fingerprint-mismatch "$d"
nx pass; echo src/missing.txt >> "$d/swarm/manifests/T.1.files"; echo "$(printf 'a%.0s' {1..64})  src/missing.txt" >> "$d/swarm/manifests/T.1.sha256"; run "$d"; skip_case "manifest path missing from the copy" fingerprint-mismatch "$d"
nx pass; echo "garbage line" >> "$d/swarm/manifests/T.1.sha256"; run "$d"; skip_case "unparseable sidecar line" fingerprint-mismatch "$d"
nx pass; echo docs/notes.md >> "$d/swarm/manifests/T.1.files"; run "$d"; skip_case "manifest path with no sidecar line" fingerprint-mismatch "$d"
nx quota; run "$d"; skip_case "usage limit (error event)" quota "$d"
nx quota-stderr; run "$d"; skip_case "usage limit on stderr only" quota "$d"
nx quota-auth; run "$d"; skip_case "quota outranks auth" quota "$d"
nx auth; run "$d"; skip_case "expired login" auth "$d"
nx crash; run "$d"; skip_case "codex crash" codex-error "$d"
nx incidental; run "$d"; skip_case "'quota'/'429' in an ordinary event is not quota" codex-error "$d"
nx noout; run "$d"; skip_case "exit 0 without last.json" codex-error "$d"
nx hang; CT=10 run "$d"; skip_case "timeout" timeout "$d"
nx invalid; run "$d"; skip_case "schema: bad verdict, empty criteria" schema-invalid "$d"
nx invalid-noobs; run "$d"; skip_case "schema: missing observations" schema-invalid "$d"
nx invalid-extra; run "$d"; skip_case "schema: extra key" schema-invalid "$d"
nx notools; run "$d"; skip_case "Codex could not run commands (a FAIL that must not count)" codex-error "$d"
nx tools-words; run "$d"
chk "K the same words in an ordinary event do not void a verdict" '[[ -f $(V $d) && ! -e $(K $d) ]]'
nx pass-inconsistent; run "$d"; skip_case "PASS with a failed criterion (ruling CD-j)" schema-invalid "$d"
nx fail-inconsistent; run "$d"; skip_case "FAIL with every criterion passing (ruling CD-j)" schema-invalid "$d"
nx trunc-auth; run "$d"; skip_case "a container that tries to rewrite auth.json still cannot hide a leak" secret-leak "$d"
chk "K trunc-auth: the container could not write auth.json, and the host file is unchanged" '[[ "$(cat $(stubdir $d)/stub-trunc)" == refused && "$(sha256sum < $FAKE_AUTH | cut -d" " -f1)" == "$FAKE_SHA" ]]'
chk "K trunc-auth: no secret anywhere in the audit dir or the skip record" '! grep -rqF "$SECRET" $(A $d) $(K $d)'
# restore the shared fake auth file, so a harness that let the container truncate
# it cannot turn every later scenario into a secret-free run (clean attribution)
printf '{"tokens":{"access_token":"%s"},"short":"abc"}\n' "$SECRET" > "$FAKE_AUTH"
nx leak-ro; run "$d"
chk "K a secret in a read-only file or a mode-000 folder in /out ends up nowhere" '[[ -f $(V $d) ]] && ! grep -rqF "$SECRET" $(A $d) $(V $d)'
nx evidence-free; run "$d"; skip_case "PASS without a command" evidence-free-pass "$d"
nx leak; run "$d"; skip_case "an auth secret in last.json" secret-leak "$d"
chk "K secret-leak: no secret anywhere in the audit dir or the skip record" '! grep -rqF "$SECRET" $(A $d) $(K $d)'

# --- R: re-runs, stale state, sidecar form, excluded symlink ------------------------
nx echo-secret; run "$d"
chk "R an event carrying a secret: events.jsonl is DROPPED (never redacted), listed in dropped.txt; the verdict is still written" '[[ -f $(V $d) && ! -e $(A $d)/events.jsonl ]] && grep -q events.jsonl $(A $d)/dropped.txt && ! grep -rqF "$SECRET" $(A $d) $(V $d)'
nx pass; printf 'REASON: quota\nDETAIL: old\nTASK: T\nATTEMPT: 1\n' > "$(K "$d")"; run "$d"
chk "R a verdict replaces a stale skip record" '[[ -f $(V $d) && ! -e $(K $d) ]]'
nx pass; printf 'VERDICT: FAIL\nCHECKER: checker-codex\nFAMILY: crossvendor\nTASK: T\nATTEMPT: 1\n---\nearlier real FAIL\n' > "$(V "$d")"; vsha=$(sha256sum < "$(V "$d")"); run "$d"
chk "R an existing verdict is never replaced (no run, nothing written)" '[[ $RC == 0 && "$(sha256sum < $(V $d))" == "$vsha" && ! -e $(K $d) && ! -e $(stubdir $d)/stub-argv ]]'
nx crash; mkdir -p "$(A "$d")/out"; printf '{"verdict":"PASS","criteria":[{"id":"a","attack":"x","command":"c","result":"r","pass":true}],"observations":[]}\n' > "$(A "$d")/out/last.json"; run "$d"
skip_case "a stale out/last.json is never reused" codex-error "$d"
nx pass; sed -i 's#^\([0-9a-f]\{64\}\)  src/app.txt$#\1 *src/app.txt#' "$d/swarm/manifests/T.1.sha256"; run "$d"
chk "R the sidecar's 'hash *path' form is accepted" '[[ -f $(V $d) && "$(field $(V $d) MANIFEST_SHA256)" == "$(sha256sum < $d/swarm/manifests/T.1.sha256 | cut -d" " -f1)" ]]'
nx pass; ln -s /etc "$d/tree/sub/data"; run "$d"
chk "R a symlink named 'data' is excluded, never followed, not unsafe" '[[ -f $(V $d) ]] && grep -qx sub/data $(A $d)/excluded.txt'
( cd "$TREE" && bash "$SCRIPT" ) > /dev/null 2>&1; u1=$?
d="$WORK/usage"; mkfx "$d" pass; ( cd "$TREE" && SWARM_DIR="$d/swarm" SWARM_TREE="$d/tree" bash "$SCRIPT" T x ) > /dev/null 2>&1; u2=$?
chk "R no arguments → exit 2" '[[ $u1 == 2 ]]'
chk "R non-integer attempt → exit 2, nothing written" '[[ $u2 == 2 && -z "$(ls $d/swarm/verdicts)" ]]'


# --- A3: attempt-3 keep-or-drop, names, forms, limits, DETAILs, freshness ----------
nx deep; run "$d"
chk "A3 the deep-path attack really planted a secret (relative walk past PATH_MAX)" '[[ "$(cat $(stubdir $d)/stub-deep-planted 2>/dev/null)" == planted ]]'
chk "A3 ...and it is never kept; the verdict is written" '[[ -f $(V $d) ]] && ! grep -rqF "$SECRET" $(A $d) $(V $d)'
chk "A3 the audit out/ holds only flat regular files" '[[ -z "$(find $(A $d)/out -mindepth 1 ! -type f 2>/dev/null)" && -z "$(find $(A $d)/out -mindepth 2 2>/dev/null)" ]]'
nx linkout; run "$d"
chk "A3 symlinks and sub-folders planted in /out are not kept" '[[ -f $(V $d) && ! -e $(A $d)/out/auth-link && ! -L $(A $d)/out/auth-link && ! -e $(A $d)/out/pw-link && ! -L $(A $d)/out/pw-link && ! -e $(A $d)/out/sub ]]'
chk "A3 dropped.txt names each not-kept entry" 'grep -qP "^auth-link\t" $(A $d)/dropped.txt && grep -qP "^pw-link\t" $(A $d)/dropped.txt && grep -qP "^sub\t" $(A $d)/dropped.txt'
nx secretname; run "$d"
chk "A3 an entry NAMED with a secret is not kept, and its name never appears anywhere" '[[ -f $(V $d) && -z "$(find $(A $d) -name "*$SECRET*" 2>/dev/null)" ]] && ! grep -rqF "$SECRET" $(A $d) $(V $d)'
nx esckey; run "$d"
chk "A3 a secret spelled as a \\u-escaped JSON key → that file dropped" '[[ -f $(V $d) && ! -e $(A $d)/out/esckey.json ]] && grep -qP "^esckey.json\t" $(A $d)/dropped.txt'
nx utf16; run "$d"
chk "A3 a UTF-16LE secret → that file dropped" '[[ -f $(V $d) && ! -e $(A $d)/out/u16.bin ]]'
nx forms; run "$d"
chk "A3 UTF-16BE, a partially escaped secret, and an escaped secret in an event → all dropped" '[[ -f $(V $d) && ! -e $(A $d)/out/u16be.bin && ! -e $(A $d)/out/partial.txt && ! -e $(A $d)/events.jsonl ]] && grep -qP "^events.jsonl\t" $(A $d)/dropped.txt'
nx proxyleak; run "$d"
chk "A3 a secret smuggled into the proxy log (as a hostname) → proxy.log dropped" '[[ -f $(V $d) ]] && ! grep -rqF "$SECRET" $(A $d) && [[ ! -e $(A $d)/proxy.log ]] && grep -qP "^proxy.log\t" $(A $d)/dropped.txt'
nx many; run "$d"
chk "A3 exactly 64 files kept when more are offered" '[[ -f $(V $d) && $(find $(A $d)/out -maxdepth 1 -type f | wc -l) -eq 64 ]]'
nx big; run "$d"
chk "A3 1 048 576 bytes is kept, 1 048 577 is not" '[[ -f $(V $d) && -f $(A $d)/out/exact.bin && ! -e $(A $d)/out/over.bin ]]'
nx lastlink; run "$d"; skip_case "last.json is a symlink (never followed)" schema-invalid "$d"
nx lastbig; run "$d"; skip_case "last.json over 4 MiB" schema-invalid "$d"
nx longerr; run "$d"
chk "A3 a secret inside a long error message never reaches the skip DETAIL" '[[ "$(field $(K $d) REASON)" == quota ]] && ! grep -qF "tok_FAKE" $(K $d) && ! grep -rqF "$SECRET" $(A $d)'
nx quota; run "$d"
chk "A3 keep-or-drop runs on skip paths too (the stub's clean records are kept)" '[[ "$(field $(K $d) REASON)" == quota && -f $(A $d)/out/stub-argv ]]'
nx pass; run "$d"
chk "A3 /out is mounted from the run's PRIVATE temp dir, never the audit dir" 'grep " /out " $(stubdir $d)/stub-mounts | grep -q "/htmp/" && ! grep " /out " $(stubdir $d)/stub-mounts | grep -q "/swarm/codex/"'
chk "A3 /schema holds only verdict.schema.json" '[[ "$(cat $(stubdir $d)/stub-schema-ls)" == "verdict.schema.json " ]]'
chk "A3 dropped.txt is written (possibly empty) on a clean run" '[[ -f $(A $d)/dropped.txt ]]'
# every skip record's DETAIL is fixed text: no Codex words, no host paths
det_bad=""
for f in $WORK/k*/swarm/verdicts/T.1.checker-codex.skip; do
  [[ -f "$f" ]] || continue
  dl=$(field "$f" DETAIL)
  grep -qiE "Too Many Requests|refresh token has expired|stub internal failure|usage limit reached|req_4291|MAYBE|/home/|/tmp/|$HOME" <<<"$dl" && det_bad+="$f: $dl | "
done
chk "A3 no skip DETAIL carries Codex's words or a host path (all K scenarios)" '[[ -z "$det_bad" ]]'
[[ -z "$det_bad" ]] || echo "#     $det_bad"
# freshness gate — boundaries, the Z form, an empty secret set; before any container
jwt() { python3 -c "import base64,json,sys,time; e=lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b'=').decode(); print(e({'alg':'none'})+'.'+e({'exp':int(time.time())+int(sys.argv[1])})+'.sig')" "$1"; }
agoZ() { python3 -c "import datetime,sys; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=float(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%S.%fZ'))" "$1"; }
mkauth() { printf '{"last_refresh":"%s","tokens":{"access_token":"%s","refresh_token":"%s"}}\n' "$(agoZ "$1")" "$(jwt "$2")" "$SECRET" > "$3"; }
mkauth 7.5 864000 "$WORK/a-stale.json"; mkauth 6.5 864000 "$WORK/a-ok.json"
mkauth 1 600 "$WORK/a-exp.json"; mkauth 1 1300 "$WORK/a-exp-ok.json"; echo '{}' > "$WORK/a-empty.json"
fresh_case() {                             # label auth-file expect(auth|verdict)
  nx pass; run "$d" CODEX_AUTH="$2" CODEX_TIMEOUT=300
  if [[ "$3" == auth ]]; then
    chk "A3 $1 → skip auth before any container" '[[ "$(field $(K $d) REASON)" == auth && ! -e $(stubdir $d)/stub-argv ]]'
  else chk "A3 $1 → proceeds" '[[ -f $(V $d) ]]'; fi
}
fresh_case "last_refresh 7.5 days ago (Z form)" "$WORK/a-stale.json" auth
chk "A3 the freshness DETAIL is the exact sentence" '[[ "$(field $(K $d) DETAIL)" == "Codex login needs a refresh: open Codex on this machine once, then re-run" ]]'
fresh_case "last_refresh 6.5 days ago" "$WORK/a-ok.json" verdict
fresh_case "access token expiring in 600 s (< timeout 300 + 600)" "$WORK/a-exp.json" auth
fresh_case "access token expiring in 1300 s (> timeout 300 + 600)" "$WORK/a-exp-ok.json" verdict
fresh_case "an auth file with no secret at all" "$WORK/a-empty.json" auth
# exit 1: no outcome can be recorded
nx pass; rmdir "$d/swarm/verdicts"; chmod 555 "$d/swarm"; run "$d"; chmod 755 "$d/swarm"
chk "A3 verdicts/ cannot be created → exit 1, nothing written" '[[ $RC == 1 && ! -e $d/swarm/verdicts/T.1.checker-codex.verdict && ! -e $d/swarm/verdicts/T.1.checker-codex.skip ]]' 2>/dev/null
# an existing verdict leaves the audit dir untouched
nx pass; mkdir -p "$(A "$d")"; echo marker > "$(A "$d")/marker.txt"
printf 'VERDICT: FAIL\nCHECKER: checker-codex\nFAMILY: crossvendor\nTASK: T\nATTEMPT: 1\n---\nx\n' > "$(V "$d")"; run "$d"
chk "A3 an existing verdict: nothing run, the audit dir untouched" '[[ $RC == 0 && -f $(A $d)/marker.txt && ! -e $(stubdir $d)/stub-argv ]]'

# --- A3 rotation, signals, SIGKILL (planted-then-signalled; this run's container found by label)
mine() { for id in $(docker ps -q --filter label=com.docker.compose.service=checker 2>/dev/null); do
           docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$id" 2>/dev/null | grep -qF "$TREE/swarm/codex/" && echo "$id"; done; }
launch() {                                 # dir auth -> PID (background harness)
  mkdir -p "$1/htmp"
  ( cd "$TREE" && env TMPDIR="$1/htmp" SWARM_DIR="$1/swarm" SWARM_TREE="$1/tree" CODEX_BIN="$STUB" CODEX_AUTH="$2" \
      CODEX_MODEL=gpt-6-astra CODEX_TIMEOUT=300 bash "$SCRIPT" T 1 ) > "$1/run.log" 2>&1 & PID=$!
}
waitfor() { local i; for i in $(seq 1 240); do eval "$1" && return 0; sleep 0.5; done; return 1; }
nx rotate-old; cp "$FAKE_AUTH" "$WORK/auth-rot.json"; launch "$d" "$WORK/auth-rot.json"
waitfor '[[ -n "$(mine)" ]]'; up=$?
chk "A3 rotation: the harness's own checker container came up" '[[ $up == 0 ]]'
chk "A3 DURING the run no file in the private temp dir holds an auth secret (no snapshot on disk)" '! grep -rqF "$SECRET" $d/htmp 2>/dev/null'
printf '{"tokens":{"access_token":"tok_ROTATED_SECRET_9876543210zyxwvUT"},"short":"abc"}\n' > "$WORK/auth-rot.json"
wait $PID; RC=$?
chk "A3 rotation: the OLD secret (read before the run) still yields secret-leak" '[[ "$(field $(K $d) REASON)" == secret-leak ]] && ! grep -rqF "$SECRET" $(A $d) $(K $d)'
nx rotate-new; cp "$FAKE_AUTH" "$WORK/auth-rot.json"; launch "$d" "$WORK/auth-rot.json"
waitfor '[[ -n "$(mine)" ]]'; printf '{"tokens":{"access_token":"tok_ROTATED_SECRET_9876543210zyxwvUT"},"short":"abc"}\n' > "$WORK/auth-rot.json"
wait $PID; RC=$?
chk "A3 rotation: a file holding the NEW secret is dropped (post-run union)" '[[ -f $(V $d) && ! -e $(A $d)/out/new.txt ]] && ! grep -rqF "tok_ROTATED_SECRET" $(A $d) $(V $d)'
planted() { compgen -G "$1/htmp/*/out/leak.txt" >/dev/null; }
sig_case() {                               # label signals...
  local label="$1"; shift
  nx slow-leak; launch "$d" "$FAKE_AUTH"
  waitfor 'planted "$d"'; local seen=$?
  for sg in "$@"; do kill -"$sg" $PID 2>/dev/null; sleep 0.3; done
  wait $PID
  chk "A3 $label after the secret was planted: planted=yes, no secret in the audit dir, verdicts or skip; private temp dir removed" '[[ $seen == 0 ]] && ! grep -rqF "$SECRET" $(A $d) $d/swarm/verdicts 2>/dev/null && [[ -z "$(ls -A $d/htmp 2>/dev/null)" ]]'
}
sig_case "TERM then TERM (the second lands in cleanup)" TERM TERM
sig_case "INT then HUP" INT HUP
sig_case "HUP" HUP
# snapshot the host state BEFORE the kill test, so its own sweep cannot mask earlier leaks
C1=$(docker ps -aq | wc -l); N1=$(docker network ls -q | wc -l); I1=$(imgs)
chk "H no containers left behind by any trappable run" '[[ $C1 == $C0 ]]'
chk "H no networks left behind by any trappable run" '[[ $N1 == $N0 ]]'
chk "H no per-run images left behind" '[[ "$I1" == "$I0" ]]'
nx slow-leak; launch "$d" "$FAKE_AUTH"; waitfor 'planted "$d"'; seen=$?
kill -KILL $PID 2>/dev/null; wait $PID 2>/dev/null
chk "A3 SIGKILL after the secret was planted: the audit dir holds no secret" '[[ $seen == 0 ]] && ! grep -rqF "$SECRET" $(A $d) $d/swarm/verdicts 2>/dev/null'
# the killed run's compose project (containers, networks) is the oracle's to remove:
# find its containers by the config-file label, remember their project names,
# then remove the containers and every network of those projects
kp=""
for id in $(docker ps -aq --filter label=com.docker.compose.project.config_files 2>/dev/null); do
  if docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$id" 2>/dev/null | grep -qF "$TREE/swarm/codex/"; then
    kp+=" $(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id")"; docker rm -f -v "$id" >/dev/null 2>&1
  fi
done
for pj in $(tr ' ' '\n' <<<"$kp" | sort -u); do
  for id in $(docker network ls -q --filter "label=com.docker.compose.project=$pj"); do docker network rm "$id" >/dev/null 2>&1; done
done
chmod -R u+rwX "$d/htmp" 2>/dev/null; rm -rf "$d/htmp"

# --- H: hygiene ----------------------------------------------------------------------
REAL_SHA1=$( [[ -f "$REAL_AUTH" ]] && sha256sum < "$REAL_AUTH" | cut -d' ' -f1 || echo none)
chk "H the real ~/.codex/auth.json is untouched" '[[ "$REAL_SHA0" == "$REAL_SHA1" ]]'
chk "H the fixed-name images exist" 'docker image inspect agents2-codex-check:local agents2-codex-proxy:local >/dev/null 2>&1'
leftover=$(for h in $WORK/*/htmp; do [[ -n "$(ls -A $h 2>/dev/null)" ]] && echo "$h"; done)
chk "H every run removed its private temp dir" '[[ -z "$leftover" ]]'
[[ -z "$leftover" ]] || echo "#     leftover: $leftover"
if git -C "$TREE" rev-parse -q --verify 12f6413 >/dev/null 2>&1; then
  out=$( { git -C "$TREE" diff --no-renames --name-only 12f6413; git -C "$TREE" ls-files --others --exclude-standard; } | sort -u \
    | grep -vxE 'SPEC\.md|swarm/codex-check\.sh|swarm/codex/.*|smoketest/codex/.*' \
    | grep -vxE 'swarm/gate\.sh|dashboard/.*|smoketest/gate/.*' || true)
  chk "H only CD1-territory files changed (CD2/CD3 territory and SPEC.md aside)" '[[ -z "$out" ]]'
  [[ -z "$out" ]] || echo "#     outside: $(tr '\n' ' ' <<<"$out")"
else echo "#   (no git base in TREE — territory check skipped; prototype run)"; fi

if (( NFAIL == 0 )); then echo "ORACLE PASS"; exit 0; fi
echo "ORACLE FAIL: $NFAIL check(s) failed"; exit 1
