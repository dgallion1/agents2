#!/usr/bin/env bash
# smoketest/codex/run_tests.sh — CD1's own tests for swarm/codex-check.sh.
# The single entry point. Docker-backed (the real container, a real egress
# proxy) but NEVER the real Codex and NEVER the real ~/.codex/auth.json: the
# harness is pointed at a STUB Codex (smoketest/codex/stub-codex) and a FAKE
# auth file. Fixtures are built at test time (agents2's .gitignore would drop
# committed files named .env*). Needs docker + compose, python3, git, go, curl
# and outbound HTTPS (the proxy allowlist is probed through the real hosts).
#
#   bash smoketest/codex/run_tests.sh            everything (a few minutes)
#   CODEX_TESTS=unit bash ...                    Docker-free part only
#
# Last line: "ALL PASS" (exit 0) or "FAILED: n" (exit 1).
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TREE="$(cd "$HERE/../.." && pwd)"
SCRIPT="$TREE/swarm/codex-check.sh"
TOOLS="$TREE/swarm/codex/tools.py"
ONLY="${CODEX_TESTS:-all}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/codex-tests.XXXXXX")"
mkdir -p "$WORK/tmp"                                  # the harness's private temp dirs land here
SECRET=tok_FAKE_SECRET_0123456789abcdefXYZ
NFAIL=0

ok()  { echo "ok   - $*"; }
bad() { echo "FAIL - $*"; NFAIL=$((NFAIL+1)); }
chk() { if eval "$2"; then ok "$1"; else bad "$1"; fi; }
field() { grep -m1 "^$2:" "$1" 2>/dev/null | sed "s/^$2:[[:space:]]*//"; }

HPID=""
cleanup() { [[ -z "$HPID" ]] || kill "$HPID" 2>/dev/null; chmod -R u+rwX "$WORK" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

# --- fixtures -------------------------------------------------------------------------
# mkfx DIR SCENARIO [go]: DIR/tree (a git repo), DIR/swarm (the run's evidence dir)
mkfx() {
  local d="$1" scen="$2" go="${3:-}"
  mkdir -p "$d/tree" "$d/swarm/verdicts" "$d/swarm/manifests" "$d/swarm/codex"
  ( cd "$d/tree" && git init -q && git config user.email t@t && git config user.name t
    printf '*.log\n' > .gitignore; echo readme > README.md
    mkdir -p src lib docs/runs sub data pkg/data cfg .codex .claude .agents .swarm-x private deep a/b "sp ace" data3 datasets
    echo app > src/app.txt; echo keep > lib/keep.txt; echo "ünï" > "sp ace/ünï.txt"
    echo live > data/live.csv; echo f > sub/data; echo p > pkg/data/x.go; echo k > data3/keep.txt; echo k > datasets/keep.txt
    echo S=1 > .env; echo R=1 > .envrc; echo E=1 > .env.example; echo L=1 > cfg/.env.local
    echo pem > x.pem; echo key > y.key; echo ok > keyring.txt; echo ok > monkey.pem.txt
    echo c > .codex/c.toml; echo c > .claude/a.md; echo s > .agents/s.md; echo z > .swarm-x/z.txt
    echo a > AGENTS.md; echo a > deep/AGENTS.md; echo o > deep/AGENTS.override.md; echo b > deep/AGENTS.md.bak
    echo h > PLANNING_LOG.md; echo h > sub/PLANNING_LOG.md; echo p > private/n.txt; echo p > docs/runs/x.png; echo d > docs/keep.md
    echo t > a/b/c.tmp; echo q > qa.dat; echo q > qbb.dat; echo p > ab.txt; echo p > cb.txt
    printf '#!/bin/sh\necho hi\n' > exe.sh; chmod 755 exe.sh; echo ro > ro.txt; chmod 444 ro.txt
    ln -s src/app.txt link-ok; echo gone > gone.txt
    if [[ -n "$go" ]]; then printf 'module example.com/fx\n\ngo 1.26\n' > go.mod; printf 'package main\n\nfunc main() {}\n' > main.go; fi
    git add -A >/dev/null && git commit -qm fx && rm gone.txt
    echo new > new.txt; echo log > build.log; mkfifo fifo1
    mkdir nested && ( cd nested && git init -q && echo x > n.txt )
    printf 'src/app.txt\nPLANNING_LOG.md\ngone.txt\nsp ace/ünï.txt\n' > "$d/swarm/manifests/T.1.files"
    { sha256sum src/app.txt PLANNING_LOG.md; echo "deleted  gone.txt"; sha256sum "sp ace/ünï.txt"; } > "$d/swarm/manifests/T.1.sha256" )
  printf '# personal files\nPLANNING_LOG.md\nprivate/\ndocs/runs/\n*.tmp\nq?.dat\n[a]b.txt\n' > "$d/swarm/codex.exclude"
  printf 'Criteria for task T attempt 1.\nSTUB-SCENARIO: %s\nHOSTPROBE-PORT: %s\nHOSTIPS: %s\n' "$scen" "${HP:-1}" "${HOSTIPS:-}" > "$d/swarm/codex/T.1.criteria.md"
}
EXP_FILES=$(printf '%s\n' \
  .gitignore README.md cb.txt data3/keep.txt datasets/keep.txt deep/AGENTS.md.bak docs/keep.md exe.sh keyring.txt \
  lib/keep.txt link-ok monkey.pem.txt new.txt qbb.dat "sp ace/ünï.txt" src/app.txt sub/PLANNING_LOG.md ro.txt | LC_ALL=C sort)
EXP_EXCL=$(printf '%s\n' \
  .agents/s.md .claude/a.md .codex/c.toml .env .env.example .envrc .swarm-x/z.txt AGENTS.md PLANNING_LOG.md a/b/c.tmp ab.txt cfg/.env.local \
  data/live.csv deep/AGENTS.md deep/AGENTS.override.md docs/runs/x.png nested/ pkg/data/x.go private/n.txt qa.dat sub/data x.pem y.key | LC_ALL=C sort)

# copy_case DIR: run only the copy+fingerprint stage (Docker-free) -> DIR/copy.out, RC
copy_case() {
  local d="$1"
  rm -rf "$d/copy"; rm -f "$d/files.txt" "$d/excluded.txt"
  env PYTHONUTF8=1 python3 "$TOOLS" copy "$d/tree" "$d/copy" "$d/swarm/codex.exclude" "$d/swarm/manifests/T.1.files" \
      "$d/swarm/manifests/T.1.sha256" "$d/files.txt" "$d/excluded.txt" > "$d/copy.out" 2> "$d/copy.err"
  RC=$?
}
copy_is() {                                            # copy_is DIR "kind" [reason]
  local d="$1" want="$2" reason="${3:-}" k r
  IFS=$'\t' read -r k r _ < "$d/copy.out"
  [[ $RC == 0 && "$k" == "$want" && ( -z "$reason" || "$r" == "$reason" ) ]]
}
copy_detail() { cut -f4 "$1/copy.out"; }                 # the tree-relative path a DETAIL may carry
copy_code() { cut -f3 "$1/copy.out"; }
small() {                                              # small DIR: a minimal tree + evidence
  local d="$1"; mkdir -p "$d/tree/src" "$d/swarm/manifests"
  ( cd "$d/tree" && git init -q && git config user.email t@t && git config user.name t
    echo app > src/app.txt; echo two > two.txt; echo gone > gone.txt
    git add -A >/dev/null && git commit -qm s && rm gone.txt
    printf 'src/app.txt\ngone.txt\n' > "$d/swarm/manifests/T.1.files"
    { sha256sum src/app.txt; echo "deleted  gone.txt"; } > "$d/swarm/manifests/T.1.sha256" )
  : > "$d/swarm/codex.exclude"
}

echo "# codex-check tests: TREE=$TREE"
[[ -f "$SCRIPT" && -f "$TOOLS" ]] || { bad "no harness at $SCRIPT"; echo "FAILED: $NFAIL"; exit 1; }

# =========================== U. the copy (Docker-free) =====================================
d="$WORK/u-main"; HP=1; mkfx "$d" pass; copy_case "$d"
chk "U copy stage succeeds and stamps the sidecar's sha256" 'copy_is $d ok && [[ "$(cut -f2 $d/copy.out)" == "$(sha256sum < $d/swarm/manifests/T.1.sha256 | cut -d" " -f1)" ]]'
[[ "$(cat "$d/files.txt")" == "$EXP_FILES" ]] || diff <(cat "$d/files.txt") <(echo "$EXP_FILES") | sed 's/^/#   files diff: /'
[[ "$(cat "$d/excluded.txt")" == "$EXP_EXCL" ]] || diff <(cat "$d/excluded.txt") <(echo "$EXP_EXCL") | sed 's/^/#   excluded diff: /'
chk "U files.txt is exactly the copy, in byte order" '[[ "$(cat $d/files.txt)" == "$EXP_FILES" ]]'
chk "U excluded.txt is exactly the excluded paths, in byte order" '[[ "$(cat $d/excluded.txt)" == "$EXP_EXCL" ]]'
chk "U the copy on disk holds exactly files.txt" '[[ "$(cd $d/copy && find . -mindepth 1 \( -type f -o -type l \) -printf "%P\n" | LC_ALL=C sort)" == "$EXP_FILES" ]]'
chk "U no .git in the copy" '[[ -z "$(find $d/copy -name .git)" ]]'
chk "U modes kept (exec bit, read-only), link kept as a link" '[[ -x $d/copy/exe.sh && ! -w $d/copy/ro.txt && -L $d/copy/link-ok && "$(readlink $d/copy/link-ok)" == src/app.txt ]]'
chk "U a FIFO in the tree never reaches the copy (and nothing hangs on it)" '[[ ! -e $d/copy/fifo1 ]]'
chk "U basename rules: keyring.txt / monkey.pem.txt / data3 / datasets kept" 'grep -qx keyring.txt $d/files.txt && grep -qx monkey.pem.txt $d/files.txt && grep -qx data3/keep.txt $d/files.txt && grep -qx datasets/keep.txt $d/files.txt'
chk "U policy: a plain line matches the WHOLE path (sub/PLANNING_LOG.md kept)" 'grep -qx sub/PLANNING_LOG.md $d/files.txt'
chk "U policy: * crosses /, ? and [] work, dir/ excludes under it" 'grep -qx a/b/c.tmp $d/excluded.txt && grep -qx qa.dat $d/excluded.txt && grep -qx ab.txt $d/excluded.txt && grep -qx docs/runs/x.png $d/excluded.txt && ! grep -qx cb.txt $d/excluded.txt'

# policy edge forms: CRLF, no trailing newline, blank + comment lines, a leading slash
d="$WORK/u-pol"; small "$d"
printf '# c\r\n\r\ntwo.txt\r\n' > "$d/swarm/codex.exclude"; copy_case "$d"
chk "U policy: CRLF lines, blank and # lines" 'copy_is $d ok && grep -qx two.txt $d/excluded.txt'
printf 'two.txt' > "$d/swarm/codex.exclude"; copy_case "$d"
chk "U policy: no trailing newline" 'copy_is $d ok && grep -qx two.txt $d/excluded.txt'
printf '/two.txt\n' > "$d/swarm/codex.exclude"; copy_case "$d"
chk "U policy: a leading / does not silently match nothing" 'copy_is $d ok && grep -qx two.txt $d/excluded.txt'
: > "$d/swarm/codex.exclude"; copy_case "$d"
chk "U an empty policy is fine: nothing extra excluded" 'copy_is $d ok && ! grep -qx two.txt $d/excluded.txt && grep -qx two.txt $d/files.txt'

# symlinks
sl() {                                                   # sl NAME CMD... : a small tree with one extra symlink case
  local name="$1"; shift; d="$WORK/u-sl-$name"; small "$d"; ( cd "$d/tree" && "$@" ); copy_case "$d"
}
sl abs ln -s /etc/hostname link;                    chk "U symlink: absolute target -> unsafe-tree, DETAIL names it" 'copy_is $d skip unsafe-tree && copy_detail $d | grep -q "link"'
sl up ln -s ../../etc/hostname link;                chk "U symlink: escaping upward -> unsafe-tree" 'copy_is $d skip unsafe-tree'
sl back ln -s ../tree/src/app.txt link;             chk "U symlink: relative but landing back in the SOURCE tree from the copy -> unsafe-tree" 'copy_is $d skip unsafe-tree'
sl dir ln -s src link;                              chk "U symlink: to a directory -> unsafe-tree" 'copy_is $d skip unsafe-tree'
sl dang ln -s nothere link;                         chk "U symlink: dangling -> unsafe-tree" 'copy_is $d skip unsafe-tree'
sl loop ln -s link link;                            chk "U symlink: a loop -> unsafe-tree" 'copy_is $d skip unsafe-tree'
d="$WORK/u-sl-excl"; small "$d"; ( cd "$d/tree" && mkdir data && echo live > data/x.csv && ln -s data/x.csv link ); copy_case "$d"
chk "U symlink: into an excluded path -> unsafe-tree" 'copy_is $d skip unsafe-tree'
d="$WORK/u-sl-chain"; small "$d"; ( cd "$d/tree" && ln -s two.txt l1 && ln -s l1 l2 ); copy_case "$d"
chk "U symlink: a chain of in-tree links to a copied file is fine" 'copy_is $d ok && grep -qx l2 $d/files.txt'
d="$WORK/u-sl-chainx"; small "$d"; ( cd "$d/tree" && mkdir data && ln -s ../two.txt data/l1 && ln -s data/l1 l2 ); copy_case "$d"
chk "U symlink: a chain THROUGH an excluded link is unsafe" 'copy_is $d skip unsafe-tree'
d="$WORK/u-sl-datalink"; small "$d"; ( cd "$d/tree" && mkdir sub && ln -s /etc sub/data ); copy_case "$d"
chk "U a symlink named data is excluded by name, never followed, not unsafe" 'copy_is $d ok && grep -qx sub/data $d/excluded.txt'
d="$WORK/u-sl-parent"; small "$d"; ( cd "$d/tree" && mkdir realdir && echo x > realdir/f.txt && git add realdir >/dev/null && git commit -qm r && mv realdir moved && ln -s moved realdir ); copy_case "$d"
chk "U a tracked path reached through a symlinked directory -> unsafe-tree" 'copy_is $d skip unsafe-tree'
d="$WORK/u-nl"; small "$d"; ( cd "$d/tree" && echo x > $'bad\nname.txt' ); copy_case "$d"
chk "U a path with a line break -> unsafe-tree (lists could not carry it)" 'copy_is $d skip unsafe-tree'
d="$WORK/u-nogit"; small "$d"; rm -rf "$d/tree/.git"; copy_case "$d"
chk "U not a git work tree -> unsafe-tree" 'copy_is $d skip unsafe-tree'
d="$WORK/u-sub"; mkdir -p "$d/outer/pkg" "$d/swarm/manifests"
( cd "$d/outer" && git init -q && git config user.email t@t && git config user.name t && echo a > pkg/a.txt && echo top > top.txt && git add -A >/dev/null && git commit -qm s \
  && echo a.txt > "$d/swarm/manifests/T.1.files" && ( cd pkg && sha256sum a.txt ) > "$d/swarm/manifests/T.1.sha256" ); : > "$d/swarm/codex.exclude"
env PYTHONUTF8=1 python3 "$TOOLS" copy "$d/outer/pkg" "$d/copy" "$d/swarm/codex.exclude" "$d/swarm/manifests/T.1.files" "$d/swarm/manifests/T.1.sha256" "$d/f.txt" "$d/e.txt" > "$d/copy.out" 2>&1; RC=$?
chk "U a subdirectory of a work tree is still a work tree: only its own files, paths relative to it" 'copy_is $d ok && [[ "$(cat $d/f.txt)" == a.txt ]]'

# fingerprints, in the copy
fp() { local name="$1"; shift; d="$WORK/u-fp-$name"; export d; small "$d"; "$@"; copy_case "$d"; }
fp drift    bash -c 'echo tampered >> "$d/tree/src/app.txt"'
chk "U fingerprint: content drift -> fingerprint-mismatch naming the path" 'copy_is $d skip fingerprint-mismatch && copy_detail $d | grep -q src/app.txt'
fp deleted  bash -c 'echo back > "$d/tree/gone.txt"'
chk "U fingerprint: a deleted path that exists -> mismatch" 'copy_is $d skip fingerprint-mismatch && copy_detail $d | grep -q gone.txt'
fp missing  bash -c 'echo src/nope.txt >> "$d/swarm/manifests/T.1.files"; echo "$(printf "a%.0s" {1..64})  src/nope.txt" >> "$d/swarm/manifests/T.1.sha256"'
chk "U fingerprint: a manifest path absent from the copy -> mismatch" 'copy_is $d skip fingerprint-mismatch && copy_detail $d | grep -q src/nope.txt'
fp garbage  bash -c 'echo "garbage" >> "$d/swarm/manifests/T.1.sha256"'
chk "U fingerprint: an unparseable sidecar line -> mismatch" 'copy_is $d skip fingerprint-mismatch'
fp noline   bash -c 'echo two.txt >> "$d/swarm/manifests/T.1.files"'
chk "U fingerprint: a manifest path with no sidecar line -> mismatch" 'copy_is $d skip fingerprint-mismatch && copy_detail $d | grep -q two.txt'
fp star     bash -c 'sed -i "s#^\([0-9a-f]\{64\}\)  src/app.txt\$#\1 *src/app.txt#" "$d/swarm/manifests/T.1.sha256"'
chk "U fingerprint: the 'hash *path' form is accepted" 'copy_is $d ok'
fp dotdot   bash -c 'echo ../evil >> "$d/swarm/manifests/T.1.files"; echo "$(printf "a%.0s" {1..64})  ../evil" >> "$d/swarm/manifests/T.1.sha256"'
chk "U fingerprint: a manifest path leaving the tree is never read -> mismatch" 'copy_is $d skip fingerprint-mismatch'
fp excl     bash -c 'mkdir -p "$d/tree/data"; echo live > "$d/tree/data/x"; echo data/x >> "$d/swarm/manifests/T.1.files"; echo "$(printf "b%.0s" {1..64})  data/x" >> "$d/swarm/manifests/T.1.sha256"'
chk "U fingerprint: an excluded manifest path is skipped (not verified) and listed" 'copy_is $d ok && grep -qx data/x $d/excluded.txt'
fp excl2    bash -c 'echo .claude/agents/x.md >> "$d/swarm/manifests/T.1.files"; echo "$(printf "c%.0s" {1..64})  .claude/agents/x.md" >> "$d/swarm/manifests/T.1.sha256"'
chk "U fingerprint: an excluded manifest path that is not even on disk is listed" 'copy_is $d ok && grep -qx .claude/agents/x.md $d/excluded.txt'
fp emptyline bash -c 'printf "\nsrc/app.txt\n\n" > "$d/swarm/manifests/T.1.files"'
chk "U fingerprint: blank manifest lines ignored (the gate ignores them too)" 'copy_is $d ok'

# A4 item 2 — a DETAIL carries a manifest path only if it is plain segments joined by single slashes, has no
# . or .. segment, is at most 200 bytes and holds no secret; otherwise the fixed sentence stands alone.
# (the raw, worker-written manifest line is what deletedexists / missing / drift / noline echo)
CDS='["tok_FAKE_SECRET_0123456789abcdefXYZ"]'
mpcase() {                                             # mpcase NAME MANIFEST-LINE [SIDECAR-LINE]
  local name="$1" line="$2" side="${3:-}"; d="$WORK/u-mp-$name"; small "$d"
  printf '%s\n' "$line" >> "$d/swarm/manifests/T.1.files"
  [[ -z "$side" ]] || printf '%s\n' "$side" >> "$d/swarm/manifests/T.1.sha256"
  CD_SECRETS="$CDS" copy_case "$d"
}
nopath() { [[ "$(awk -F'\t' '{print NF}' "$1/copy.out")" == 3 ]]; }   # skip<TAB>reason<TAB>code — no path field
HA=$(printf 'a%.0s' {1..64})
mpcase abs     "$WORK/u-mp-abs/tree/src/app.txt";                          chk "U A4-2 an ABSOLUTE manifest path (no sidecar line): mismatch, the DETAIL has no path" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == noline ]] && nopath $d'
mpcase etc     /etc/hostname;                                              chk "U A4-2 /etc/hostname (noline): no path in the DETAIL" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == noline ]] && nopath $d'
mpcase up      ../../outside.txt;                                          chk "U A4-2 ../../outside.txt (noline): no path in the DETAIL" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == noline ]] && nopath $d'
mpcase inner   src/../src/app2.txt;                                        chk "U A4-2 an inner .. segment (noline): no path in the DETAIL" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == noline ]] && nopath $d'
mpcase innerm  src/../src/missing.txt "$HA  src/../src/missing.txt";       chk "U A4-2 an inner .. whose normalised file is missing (code missing echoes the RAW path): no path" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == missing ]] && nopath $d'
mpcase dotdrift ./src/app.txt "$(printf 'b%.0s' {1..64})  ./src/app.txt";   chk "U A4-2 a ./ path with a wrong hash (code drift echoes the RAW path): no path" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == drift ]] && nopath $d'
mpcase dotdel  ./two.txt "deleted  ./two.txt";                              chk "U A4-2 a ./ path fingerprinted as deleted but present (code deletedexists): no path" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == deletedexists ]] && nopath $d'
mpcase empty   src//app.txt;                                               chk "U A4-2 an empty segment src//app.txt (noline): no path" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == noline ]] && nopath $d'
mpcase trail   src/app.txt/;                                               chk "U A4-2 a trailing slash (noline): no path" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == noline ]] && nopath $d'
L201="$(printf 'a%.0s' {1..197}).txt"; L200="$(printf 'a%.0s' {1..196}).txt"
mpcase l201    "$L201";                                                    chk "U A4-2 a 201-byte path (noline): no path" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == noline ]] && nopath $d'
mpcase secretp "src/$SECRET.txt";                                          chk "U A4-2 a secret-bearing path (noline): no path" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == noline ]] && nopath $d && ! grep -qF "$SECRET" $d/copy.out'
mpcase l200    "$L200";                                                    chk "U A4-2 control: a 200-byte plain path IS appended" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == noline ]] && [[ "$(cut -f4 $d/copy.out)" == "$L200" ]]'
mpcase abdots  src/a..b.txt;                                               chk "U A4-2 control: a segment merely CONTAINING .. (a..b.txt) is a plain path and IS appended" 'copy_is $d skip fingerprint-mismatch && [[ "$(copy_code $d)" == noline ]] && [[ "$(cut -f4 $d/copy.out)" == src/a..b.txt ]]'

# =========================== T. tools.py unit tests (Docker-free) ==========================
# contains / keep / auth freshness / classify / verdict — in-process, see unit_tests.py
d="$WORK/unit"; mkdir -p "$d"
units=0
while IFS= read -r line; do
  case "$line" in
    "ok   - "*) ok "${line#ok   - }"; units=$((units+1)) ;;
    "FAIL - "*) bad "${line#FAIL - }"; units=$((units+1)) ;;
    *) echo "#     unit output: $line" ;;
  esac
done < <(env PYTHONUTF8=1 python3 "$HERE/unit_tests.py" "$TOOLS" "$d" "$TREE/swarm/codex/verdict.schema.json" 2>&1)
chk "T the unit tests ran (all of them reported)" '(( units >= 65 ))'

# =========================== X. exit codes, the audit dir, ordering (Docker-free) ===========
# exit 2 is for usage errors ONLY; anything else records a skip when it can (exit 0) and exits 1 when
# there is nowhere to record anything.
FAKE_AUTH="$WORK/fake-auth.json"; printf '{"tokens":{"access_token":"%s"},"short":"abc"}\n' "$SECRET" > "$FAKE_AUTH"
xrun() { ( cd "$TREE" && env TMPDIR="$WORK/tmp" SWARM_DIR="$1" SWARM_TREE="$WORK/u-main/tree" CODEX_BIN=/nonexistent CODEX_AUTH="$FAKE_AUTH" bash "$SCRIPT" T 1 ) > "$WORK/x.log" 2>&1; XRC=$?; }
if [[ "$(id -u)" != 0 ]]; then
  x="$WORK/x-ro"; mkdir -p "$x"; chmod 555 "$x"; xrun "$x/swarm"
  chk "X the verdicts dir cannot be created -> exit 1 (not 2), nothing written" '[[ $XRC == 1 ]] && [[ ! -e $x/swarm ]]'
  chmod 755 "$x"
  x="$WORK/x-rov"; mkdir -p "$x/verdicts"; chmod 555 "$x/verdicts"; xrun "$x"
  chk "X a skip record cannot be written -> exit 1, no output file" '[[ $XRC == 1 && -z "$(ls -A $x/verdicts)" ]]'
  chmod 755 "$x/verdicts"
else ok "X (skipped: running as root, permission fixtures are inert)"; fi
x="$WORK/x-aud"; mkdir -p "$x/verdicts"; : > "$x/codex"; xrun "$x"
chk "X an audit dir that cannot be created -> skip container-error, exit 0" '[[ $XRC == 0 && "$(field $x/verdicts/T.1.checker-codex.skip REASON)" == container-error ]] && grep -q "audit dir" $x/verdicts/T.1.checker-codex.skip'
x="$WORK/x-lnk"; mkdir -p "$x/verdicts" "$x/codex" "$WORK/x-lnk-target"; ln -s "$WORK/x-lnk-target" "$x/codex/T.1"; xrun "$x"
chk "X an audit dir that is a symlink is never used -> skip container-error, exit 0, target untouched" '[[ $XRC == 0 && "$(field $x/verdicts/T.1.checker-codex.skip REASON)" == container-error && -z "$(ls -A $WORK/x-lnk-target)" ]]'
x="$WORK/x-stale"; mkdir -p "$x/verdicts" "$x/codex/T.1/out/old/deeper" "$WORK/x-stale-target"; echo junk > "$x/codex/T.1/junk.txt"; echo o > "$x/codex/T.1/out/old/deeper/f"
echo t > "$WORK/x-stale-target/keep"; ln -s "$WORK/x-stale-target" "$x/codex/T.1/out/link"; echo x > "$x/codex/T.1/dropped.txt"
chmod 000 "$x/codex/T.1/out/old/deeper"; xrun "$x"
chk "X the audit dir is EMPTIED at the start of a handled run — everything in it, locked folders and links included; only dropped.txt (empty) and out/ remain" '[[ "$(field $x/verdicts/T.1.checker-codex.skip REASON)" == no-exclude-policy && "$(ls -A $x/codex/T.1 | tr "\n" " ")" == "dropped.txt out " && ! -s $x/codex/T.1/dropped.txt && -z "$(ls -A $x/codex/T.1/out)" && "$(cat $WORK/x-stale-target/keep)" == t ]]'
x="$WORK/x-verd"; mkdir -p "$x/verdicts" "$x/codex/T.1"; echo marker > "$x/codex/T.1/marker.txt"
printf 'VERDICT: FAIL\nCHECKER: checker-codex\nFAMILY: crossvendor\nTASK: T\nATTEMPT: 1\n---\nx\n' > "$x/verdicts/T.1.checker-codex.verdict"; vsha=$(sha256sum < "$x/verdicts/T.1.checker-codex.verdict"); xrun "$x"
chk "X an existing verdict: exit 0, the verdict and the audit dir untouched (nothing emptied), no skip" '[[ $XRC == 0 && "$(sha256sum < $x/verdicts/T.1.checker-codex.verdict)" == "$vsha" && -f $x/codex/T.1/marker.txt && ! -e $x/verdicts/T.1.checker-codex.skip ]] && grep -q "already exists" $WORK/x.log'
x="$WORK/x-usage"; mkdir -p "$x"; xrun "$x"
( cd "$TREE" && env SWARM_DIR="$x" bash "$SCRIPT" T x ) > /dev/null 2>&1; u4=$?
chk "X a usage error still exits 2 (bad attempt); a missing policy is a skip with exit 0, not 2" '[[ $u4 == 2 && $XRC == 0 && "$(field $x/verdicts/T.1.checker-codex.skip REASON)" == no-exclude-policy ]]'
chk "X a skip DETAIL is one fixed sentence, no host path (missing policy)" '[[ "$(field $x/verdicts/T.1.checker-codex.skip DETAIL)" == "the run'"'"'s exclusion policy file (codex.exclude) is missing" ]]'
chk "X the brief-pinned freshness sentence and the table are defined once, in the harness" 'grep -c "Codex login needs a refresh: open Codex on this machine once, then re-run" $SCRIPT | grep -qx 1'

# --- A4 items 1 and 3, Docker-free: a fake `docker` that records the SESSION each call runs in --------
# The harness is launched as a session leader (setsid), so a call it makes itself shares its session id
# (= the harness pid) and a call shielded by `setsid -w` has a session of its own.
K() { echo "$1/swarm/verdicts/T.1.checker-codex.skip"; }
SB="$WORK/shim"; mkdir -p "$SB" "$WORK/bin-free"
cat > "$SB/docker" <<'SH'
#!/bin/bash
# fake docker (run_tests.sh): logs "<sid> <pgid> <args>", succeeds, lists one fake id for ps/network/volume
echo "$(ps -o sid= -p $$ | tr -d ' ') $(ps -o pgid= -p $$ | tr -d ' ') $*" >> "$SHIM_LOG"
case "$*" in *"ps -aq"*|*"network ls"*|*"volume ls"*) echo fakeid ;; esac
exit 0
SH
chmod +x "$SB/docker"
printf '#!/bin/sh\necho "codex-cli free-0"\n' > "$WORK/bin-free/codex"; chmod +x "$WORK/bin-free/codex"
NS="$WORK/nosetsid"; mkdir -p "$NS"                        # a PATH with everything except setsid
for f in /usr/bin/*; do b="${f##*/}"; [[ "$b" == setsid ]] || ln -s "$f" "$NS/$b"; done; ln -sf "$SB/docker" "$NS/docker"                 # the fake replaces the real docker in the farm
shimrun() {                                                # shimrun DIR PATH [strace cmd...] -> RC; PID is the harness (session leader)
  local d="$1" p="$2"; shift 2
  mkdir -p "$d/htmp"; : > "$d/shim.log"
  ( cd "$TREE" && exec setsid env PATH="$p" SHIM_LOG="$d/shim.log" TMPDIR="$d/htmp" SWARM_DIR="$d/swarm" SWARM_TREE="$d/tree" \
      CODEX_BIN="$WORK/bin-free/codex" CODEX_AUTH="$FAKE_AUTH" CODEX_MODEL=gpt-6-astra CODEX_TIMEOUT=60 "$@" bash "$SCRIPT" T 1 ) > "$d/run.log" 2>&1 &
  PID=$!; wait $PID; RC=$?
}
sess() { awk -v pid="$PID" -v pat="$2" '$0 ~ pat { if ($1 == pid) same++; else other++ } END { printf "%d %d\n", same+0, other+0 }' "$1"; }   # LOG PATTERN -> same-session other-session
TEARDOWN_PATTERNS=('logs --no-color' ' down --volumes' 'ps -aq' 'network ls' 'network rm fakeid' 'volume ls' 'volume rm -f fakeid' 'rm -f -v fakeid' 'rm -f -v .*-checker$')
d="$WORK/shim-a"; mkfx "$d" pass
STRACE=(); command -v strace >/dev/null 2>&1 && STRACE=(strace -f -qq -v -e trace=execve,execveat -s 1000000 -o "$d/trace")
shimrun "$d" "$SB:$PATH" "${STRACE[@]}"
read -r msame mother < <(sess "$d/shim.log" 'compose .* build$')
chk "X A4-3 set-up: the fake docker saw the harness's main flow (build, up, run) and it ended with container-error ce-nostart" '[[ $msame -ge 1 && $mother == 0 && "$(field $(K $d) REASON)" == container-error ]] && grep -q "compose .* up -d" $d/shim.log && grep -q "compose .* run " $d/shim.log'
chk "X A4-3 the main flow's compose calls (build, up, run) stay in the harness's session (the compose run is NOT moved out of the process group)" '[[ $(sess $d/shim.log "compose .* (build|up -d|run )" | cut -d" " -f2) == 0 ]]'
bad_p=""; for pat in "${TEARDOWN_PATTERNS[@]}"; do read -r sm ot < <(sess "$d/shim.log" "$pat"); (( ot >= 1 && sm == 0 )) || bad_p+="[$pat same=$sm other=$ot] "; done
chk "X A4-3 EVERY docker call the teardown makes (logs, down, ps, network ls/rm, volume ls/rm, rm) runs in its own session via setsid -w" '[[ -z "$bad_p" ]]'
[[ -z "$bad_p" ]] || echo "#     not shielded: $bad_p"
d="$WORK/shim-b"; mkfx "$d" pass; shimrun "$d" "$NS"
bad_p=""; for pat in "${TEARDOWN_PATTERNS[@]}"; do read -r sm ot < <(sess "$d/shim.log" "$pat"); (( sm >= 1 )) || bad_p+="[$pat same=$sm other=$ot] "; done
chk "X A4-3 without setsid on PATH the teardown calls still ALL run (directly) — a teardown step is never skipped" '[[ -z "$bad_p" && "$(field $(K $d) REASON)" == container-error ]]'
[[ -z "$bad_p" ]] || { echo "#     skipped: $bad_p"; tail -3 "$d/run.log" | sed 's/^/#     run.log: /'; }
chk "X A4-3 the harness exits with its own code (0: a skip was recorded) whatever the shielded calls did" '[[ $RC == 0 ]]'

# --- A4 item 1, Docker-free: no secret in any process's argv (the traced run above) -----------------
if [[ ${#STRACE[@]} -gt 0 ]]; then
  d="$WORK/shim-a"
  tc=$(python3 "$HERE/trace_check.py" "$d/trace" "$SECRET" 2>&1); tcrc=$?
  chk "X A4-1 traced harness run: no argv carries a secret; only tools.py processes get it in their environment" '[[ $tcrc == 0 ]]'
  [[ $tcrc == 0 ]] || sed 's/^/#     /' <<<"$tc"
  chk "X A4-1 the trace is not vacuous: it saw tools.py execs, environments (strace -v), and at least one exec that carries the secret in its ENVIRONMENT" 'grep -q tools.py $d/trace && [[ "$(awk '"'"'$1=="ok"{print $4+0}'"'"' <<<"$tc")" -ge 1 ]]'
  # meta-test of the checker itself: the attempt-3 shape (env VAR=secret cmd) and a leaking non-python exec must FAIL it
  printf '%s\n' "1 execve(\"/usr/bin/env\", [\"env\", \"CD_SECRETS=[\\\"$SECRET\\\"]\", \"python3\", \"/x/tools.py\"], [\"A=b\"]) = 0" > "$WORK/tr-bad1"
  printf '%s\n' "1 execve(\"/usr/bin/docker\", [\"docker\", \"ps\"], [\"CD_SECRETS=[\\\"$SECRET\\\"]\"]) = 0" > "$WORK/tr-bad2"
  printf '%s\n' "1 execve(\"/usr/bin/python3\", [\"python3\", \"/x/tools.py\", \"keep\"], [\"CD_SECRETS=[\\\"$SECRET\\\"]\"]) = 0" > "$WORK/tr-ok"
  python3 "$HERE/trace_check.py" "$WORK/tr-bad1" "$SECRET" >/dev/null 2>&1; r1=$?
  python3 "$HERE/trace_check.py" "$WORK/tr-bad2" "$SECRET" >/dev/null 2>&1; r2=$?
  python3 "$HERE/trace_check.py" "$WORK/tr-ok" "$SECRET" >/dev/null 2>&1; r3=$?
  chk "X A4-1 the trace checker catches a secret in argv (env VAR=secret python3 ...) and in a non-python environment, and accepts the tools.py environment" '[[ $r1 == 1 && $r2 == 1 && $r3 == 0 ]]'
else ok "X A4-1 (skipped: strace is not installed)"; fi
chk "X A4-1 the harness never exports the secret set or passes it to env (static, comments aside)" '! grep -v "^[[:space:]]*#" $SCRIPT | grep -qE "export[[:space:]]+(-[a-z]+ )?CD_SECRETS|env[[:space:]]+CD_SECRETS" && grep -q "^pys() { CD_SECRETS=" $SCRIPT'

if [[ "$ONLY" == unit ]]; then
  if (( NFAIL == 0 )); then echo "ALL PASS"; exit 0; fi
  echo "FAILED: $NFAIL"; exit 1
fi

# =========================== H. the harness with a stub Codex, in the real container ======
mkdir -p "$WORK/bin"; cp "$HERE/stub-codex" "$WORK/bin/codex"; chmod +x "$WORK/bin/codex"
printf '#!/bin/sh\nexit 0\n' > "$WORK/bin/codex-code-mode-host"; chmod +x "$WORK/bin/codex-code-mode-host"
STUB="$WORK/bin/codex"
FAKE_SHA=$(sha256sum < "$FAKE_AUTH" | cut -d' ' -f1)
HP=$(python3 -c 'import socket;s=socket.socket();s.bind(("",0));print(s.getsockname()[1])')
mkdir -p "$WORK/www"; echo hostprobe > "$WORK/www/index.html"
python3 -m http.server "$HP" --bind 0.0.0.0 --directory "$WORK/www" >/dev/null 2>&1 & HPID=$!
sleep 1
HOSTIPS=$(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | tr '\n' ' ')
hostctl() { local ip; curl -s -m 5 "http://172.17.0.1:$HP/" | grep -q hostprobe || return 1
  for ip in $HOSTIPS; do curl -s -m 5 --noproxy "*" "http://$ip:$HP/" | grep -q hostprobe || return 1; done; }
chk "H positive control: the host listener answers on 172.17.0.1 and on every address the host has" 'hostctl'
imgs() { docker images --format '{{.Repository}}:{{.Tag}}' | grep -v '^agents2-codex-' | LC_ALL=C sort; }
I0=$(imgs); C0=$(docker ps -aq | wc -l); N0=$(docker network ls -q | wc -l); V0=$(docker volume ls -q | wc -l)

run() {                                                 # run DIR [ENV=...]: RC — every run has its OWN temp root, DIR/htmp
  local d="$1"; shift
  mkdir -p "$d/htmp"
  ( cd "$TREE" && env TMPDIR="$d/htmp" SWARM_DIR="$d/swarm" SWARM_TREE="$d/tree" CODEX_BIN="$STUB" CODEX_AUTH="$FAKE_AUTH" \
      CODEX_MODEL=gpt-6-astra CODEX_TIMEOUT="${CT:-300}" "$@" bash "${SX:-$SCRIPT}" T 1 ) > "$d/run.log" 2>&1
  RC=$?
}
V() { echo "$1/swarm/verdicts/T.1.checker-codex.verdict"; }
K() { echo "$1/swarm/verdicts/T.1.checker-codex.skip"; }
A() { echo "$1/swarm/codex/T.1"; }
S() { echo "$1/swarm/codex/T.1/out"; }                  # the stub's flat records: out/stub-<name>
netok() { grep -q " rc=0" "$1" && ! grep -q "code=000" "$1"; }
skip_case() {                                          # skip_case LABEL REASON DIR
  local f; f=$(K "$3")
  if [[ $RC == 0 && -f "$f" && ! -e $(V "$3") && "$(field "$f" REASON)" == "$2" && "$(field "$f" TASK)" == T \
        && "$(field "$f" ATTEMPT)" == 1 && -n "$(field "$f" DETAIL)" ]]; then ok "H $1 -> skip $2"
  else bad "H $1 -> want skip $2, got rc=$RC skip='$(field "$f" REASON)' verdict=$([[ -e $(V "$3") ]] && echo yes || echo no) :: $(tail -2 "$3/run.log" | tr '\n' ' ')"; fi
}
nosecret() { ! timeout 60 grep -rqaF -e "$SECRET" "$@" 2>/dev/null; }   # no arg holds the secret (raw)

# a stale image under the proxy's fixed name must be replaced (SPEC CD-g)
OLD_PROXY_ID="$(docker image inspect -f '{{.Id}}' agents2-codex-proxy:local 2>/dev/null)"
docker tag debian:bookworm-slim agents2-codex-proxy:local 2>/dev/null

d="$WORK/pass"; mkfx "$d" pass; mkdir -p "$(A $d)/old-junk"; echo stale > "$(A $d)/proxy.log"; run "$d"
f=$(V "$d"); sd=$(S "$d"); side_sha=$(sha256sum < "$d/swarm/manifests/T.1.sha256" | cut -d' ' -f1)
chk "H pass: exit 0, a verdict, no skip record" '[[ $RC == 0 && -f $f && ! -e $(K $d) ]]'
chk "H pass: headers VERDICT/CHECKER/FAMILY/TASK/ATTEMPT" '[[ "$(field $f VERDICT)" == PASS && "$(field $f CHECKER)" == checker-codex && "$(field $f FAMILY)" == crossvendor && "$(field $f TASK)" == T && "$(field $f ATTEMPT)" == 1 ]]'
chk "H pass: MANIFEST_SHA256 is the sidecar hash, CODEX_MODEL, CODEX_VERSION" '[[ "$(field $f MANIFEST_SHA256)" == "$side_sha" && "$(field $f CODEX_MODEL)" == gpt-6-astra && "$(field $f CODEX_VERSION)" == "codex-cli stub-1.2.3" ]]'
chk "H pass: headers precede a single --- and the evidence follows" '[[ "$(grep -n "^---$" $f | cut -d: -f1)" == 9 ]] && grep -q "criterion crit-a: PASS" $f && grep -q "command: echo cmd-b" $f && grep -q "obs-1" $f'
chk "H pass: the audit dir holds exactly files.txt excluded.txt dropped.txt events.jsonl proxy.log out/ (the stale junk from before is gone)" '[[ "$(ls -A $(A $d) | tr "\n" " ")" == "dropped.txt events.jsonl excluded.txt files.txt out proxy.log " ]] && ! grep -q stale $(A $d)/proxy.log'
chk "H pass: out/ holds only last.json and the stub's flat stub-* records" '[[ -f $(A $d)/out/last.json && -f $sd/stub-argv && -z "$(find $(A $d)/out -mindepth 1 ! -name last.json ! -name "stub-*")" && -z "$(find $(A $d)/out -mindepth 2)" ]]'
chk "H pass: dropped.txt is empty on a clean run" '[[ -f $(A $d)/dropped.txt && ! -s $(A $d)/dropped.txt ]]'
chk "H pass: files.txt is the copy, excluded.txt the excluded paths, in byte order" '[[ "$(cat $sd/stub-work-files)" == "$EXP_FILES" && "$(cat $(A $d)/files.txt)" == "$EXP_FILES" && "$(cat $(A $d)/excluded.txt)" == "$EXP_EXCL" ]]'
argv=$(cat "$sd/stub-argv" 2>/dev/null)
chk "H pass: exact Codex argv" '[[ "$(tr "\n" " " <<<"$argv")" == "exec --dangerously-bypass-approvals-and-sandbox --ephemeral --ignore-rules --skip-git-repo-check -m gpt-6-astra -C /work --json --output-schema /schema/verdict.schema.json -o /out/last.json - " ]]'
envf=$(cat "$sd/stub-env" 2>/dev/null)
chk "H pass: uid 1000:1000, CODEX_HOME, HOME, both proxies" 'grep -qx UID=1000 <<<"$envf" && grep -qx GID=1000 <<<"$envf" && grep -qx CODEX_HOME=/codex-home <<<"$envf" && grep -qx HOME=/tmp/home <<<"$envf" && grep -qx HTTPS_PROXY=http://proxy:8888 <<<"$envf" && grep -qx HTTP_PROXY=http://proxy:8888 <<<"$envf"'
chk "H pass: no module cache env for a non-Go tree" 'grep -qx GOMODCACHE= <<<"$envf" && ! grep -q gomodcache $sd/stub-mounts'
chk "H pass: the mounts are exactly these and no others" '[[ "$(cat $sd/stub-mounts)" == "$(printf "%s\n" / /work /opt/codex/codex /opt/codex/codex-code-mode-host /codex-home /codex-home/auth.json /out /schema/verdict.schema.json | LC_ALL=C sort)" ]]'
chk "H pass: /out is a PRIVATE dir (inside the run's temp root), never the audit dir; /schema is the ONE schema file" 'grep "^/out " $sd/stub-mount-sources | grep -q "/htmp/codex-check\." && ! grep "^/out " $sd/stub-mount-sources | grep -q "/swarm/codex/" && grep "^/schema/verdict.schema.json " $sd/stub-mount-sources | grep -q "/swarm/codex/verdict.schema.json " && [[ "$(cat $sd/stub-schema-ls)" == "verdict.schema.json " ]]'
chk "H pass: /work rw; Codex, its helper, the schema and the auth file read-only" 'grep -qx "/work rw" $sd/stub-writable && grep -qx "/opt/codex/codex ro" $sd/stub-writable && grep -qx "/opt/codex/codex-code-mode-host ro" $sd/stub-writable && grep -qx "/schema/verdict.schema.json ro" $sd/stub-writable && grep -qx "/codex-home/auth.json ro" $sd/stub-writable'
chk "H pass: CODEX_HOME = empty config.toml + the given auth file, nothing else" '[[ "$(cat $sd/stub-codex-home-ls)" == $'"'"'auth.json\nconfig.toml'"'"' && "$(tr -d " " < $sd/stub-config-bytes)" == 0 && "$(cat $sd/stub-auth-sha)" == "$FAKE_SHA" ]]'
chk "H pass: no host home, docker socket or Codex install visible" '[[ ! -s $sd/stub-host-paths ]]'
chk "H pass: prompt = brief, then About this copy (every excluded path), then the criteria" '[[ $(grep -n "adversarial checker" $sd/stub-prompt | head -1 | cut -d: -f1) -lt $(grep -n "^## About this copy" $sd/stub-prompt | cut -d: -f1) && $(grep -n "^## About this copy" $sd/stub-prompt | cut -d: -f1) -lt $(grep -n "^Criteria for task" $sd/stub-prompt | cut -d: -f1) ]] && grep -qF -- "- PLANNING_LOG.md" $sd/stub-prompt && grep -qF -- "- deep/AGENTS.override.md" $sd/stub-prompt && grep -qF -- "- nested/" $sd/stub-prompt && grep -q "artefact" $sd/stub-prompt && ! grep -qi census $sd/stub-prompt'
chk "H net: NO host address is reachable from the checker — the network's own gateway (.1) and every address of the host included (SPEC ruling CD-l)" '[[ -s $sd/stub-net-hostips && -n "$HOSTIPS" ]] && ! grep -q " reachable$" $sd/stub-net-hostips && [[ $(grep -c unreachable $sd/stub-net-hostips) -ge 3 ]]'
chk "H net: a host service on docker0 is unreachable; the checker has no default route and one address" '! netok $sd/stub-net-host && [[ ! -s $sd/stub-default-route ]] && [[ "$(wc -w < $sd/stub-my-ips)" == 1 ]]'
chk "H net: a non-allowlisted host is refused" '! netok $sd/stub-net-denied'
chk "H net: chatgpt.com, auth.openai.com, api.openai.com reachable through the proxy" 'netok $sd/stub-net-allowed && netok $sd/stub-net-auth && netok $sd/stub-net-api'
chk "H net: lookalike hosts refused, and refused BY THE FILTER (proxy.log)" '! netok $sd/stub-net-look1 && ! netok $sd/stub-net-look2 && ! netok $sd/stub-net-look3 && grep -i "chatgpt\.com\.evil\.invalid" $(A $d)/proxy.log | grep -qiE "refus|filter|denied|403"'
chk "H net: CONNECT to port 80 refused; plain HTTP to a non-allowlisted host refused; no direct egress" '! netok $sd/stub-net-port80 && ! grep -q "code=200" $sd/stub-net-plainhttp && ! netok $sd/stub-net-direct'
chk "H net: proxy.log names the allowed host and the refused host" 'grep -q "chatgpt\.com" $(A $d)/proxy.log && grep -i "example\.com" $(A $d)/proxy.log | grep -qiE "refus|denied|filter|403"'
chk "H pass: events.jsonl captured; no secret anywhere in the audit dir or the verdict" 'grep -q thread.started $(A $d)/events.jsonl && nosecret $(A $d) $f'
chk "H pass: the private temp dir (copy, out, logs) was deleted" '[[ -z "$(ls -A $d/htmp)" ]]'
chk "H pass: the stale proxy image was replaced by a real tinyproxy (rebuilt every run)" 'docker run --rm --network none --entrypoint tinyproxy agents2-codex-proxy:local -v | grep -q tinyproxy'
# the tag trick above left the previous proxy image untagged: remove that one image (by ID) so the test leaves nothing behind
if [[ -n "$OLD_PROXY_ID" && "$(docker image inspect -f '{{len .RepoTags}}' "$OLD_PROXY_ID" 2>/dev/null)" == 0 ]]; then docker rmi "$OLD_PROXY_ID" >/dev/null 2>&1; fi

# the isolated network gives the HOST no address at all (SPEC ruling CD-l): bring up the real compose
# project's proxy and look at the host side of its bridge
BP="agents2-codex-nettest-$$-$RANDOM"
bp() { ( export CD_WORK="$WORK" CD_CODEX_BIN="$STUB" CD_CODEX_HOME="$WORK" CD_AUTH="$FAKE_AUTH" CD_OUT="$WORK" CD_SCHEMA="$TREE/swarm/codex/verdict.schema.json"
         docker compose --env-file /dev/null -p "$BP" -f "$TREE/swarm/codex/compose.yaml" "$@" ); }
bp up -d --no-build --wait proxy > "$WORK/bp.log" 2>&1
nid=$(docker network inspect -f '{{.Id}}' "${BP}_isolated" 2>/dev/null); br="br-${nid:0:12}"
chk "H network: internal, IPv6 off, host IPv4 address inhibited" '[[ "$(docker network inspect -f "{{.Internal}} {{.EnableIPv6}} {{index .Options \"com.docker.network.bridge.inhibit_ipv4\"}}" ${BP}_isolated)" == "true false true" ]]'
chk "H network: the bridge exists on the host and carries NO IPv4 (and no IPv6) address" 'ip link show "$br" >/dev/null 2>&1 && [[ -z "$(ip -o addr show dev $br 2>/dev/null | grep -E "inet6? " | grep -v "inet6 fe80")" ]]'
bp down --volumes --remove-orphans --timeout 5 >> "$WORK/bp.log" 2>&1
chk "H network: the test project was torn down" '[[ -z "$(docker network ls -q --filter label=com.docker.compose.project=$BP)" && -z "$(docker ps -aq --filter label=com.docker.compose.project=$BP)" ]]'

# a Go tree: per-run module subset, read-only, offline build
d="$WORK/go"; mkfx "$d" fail go; run "$d"; sd=$(S "$d")
chk "H go: a FAIL verdict with empty evidence is still written" '[[ -f $(V $d) && "$(field $(V $d) VERDICT)" == FAIL && ! -e $(K $d) ]]'
chk "H go: GOMODCACHE/GOPROXY/GOFLAGS/GOCACHE as specified; /gomodcache read-only" 'grep -qx GOMODCACHE=/gomodcache $sd/stub-env && grep -qx GOPROXY=off $sd/stub-env && grep -qx GOFLAGS=-mod=mod $sd/stub-env && grep -qx GOCACHE=/tmp/gocache $sd/stub-env && grep -qx "/gomodcache ro" $sd/stub-writable && grep -qx /gomodcache $sd/stub-mounts'
chk "H go: go build works offline in the container; go.mod in the copy" 'grep -qx rc=0 $sd/stub-gobuild && grep -qx go.mod $sd/stub-work-files'
UUID_DIR="$(go env GOMODCACHE)/cache/download/github.com/google/uuid/@v"
if [[ -f "$UUID_DIR/v1.6.0.zip" ]]; then
  d="$WORK/godep"; mkfx "$d" pass go
  ( cd "$d/tree" && printf 'module example.com/fx\n\ngo 1.26\n\nrequire github.com/google/uuid v1.6.0\n' > go.mod \
      && printf 'package main\n\nimport "github.com/google/uuid"\n\nfunc main() { _ = uuid.New() }\n' > main.go \
      && GOFLAGS=-mod=mod GOPROXY="file://$(go env GOMODCACHE)/cache/download" GOSUMDB=off GOTOOLCHAIN=local go mod tidy >/dev/null 2>&1 \
      && rm -rf nested && git add -A >/dev/null && git commit -qm dep )
  run "$d"; sd=$(S "$d")
  chk "H go+dep: the subset holds the target's dependency and the container builds offline" 'grep -qx rc=0 $sd/stub-gobuild && [[ $(grep -c "^go.sum$" $sd/stub-work-files) == 1 ]]'
else ok "H go+dep: skipped (github.com/google/uuid v1.6.0 is not in this host's module cache)"; fi

# every skip reason (exactly one output; exit 0)
n=0; nx() { n=$((n+1)); d="$WORK/k$n"; mkfx "$d" "$1" ${2:-}; }
nx pass; rm "$d/swarm/codex.exclude"; run "$d"; skip_case "no exclude policy" no-exclude-policy "$d"
nx pass; rm "$d/swarm/codex/T.1.criteria.md"; run "$d"; skip_case "no criteria" no-criteria "$d"
nx pass; rm "$d/swarm/manifests/T.1.sha256"; run "$d"; skip_case "no sidecar" no-evidence "$d"
nx pass; rm "$d/swarm/manifests/T.1.files"; run "$d"; skip_case "no manifest" no-evidence "$d"
nx pass; run "$d" CODEX_BIN=/nonexistent/codex; skip_case "no Codex binary" no-codex "$d"
nx pass; run "$d" CODEX_BIN=/etc; skip_case "CODEX_BIN a directory" no-codex "$d"
nx pass; run "$d" CODEX_AUTH=/nonexistent/auth.json; skip_case "no auth file" auth "$d"
nx pass; run "$d" DOCKER_HOST=unix:///nonexistent/docker.sock; skip_case "docker unreachable" docker-unavailable "$d"
nx pass; ln -s /etc/hostname "$d/tree/link-abs"; run "$d"; skip_case "absolute symlink" unsafe-tree "$d"
chk "H unsafe-tree: DETAIL names the offending symlink (a plain tree-relative path), and no target" 'grep -q "^DETAIL: .*: link-abs$" $(K $d) && ! grep -q "/etc" $(K $d)'
nx pass; ln -s /etc/hostname "$d/tree/link-$SECRET"; run "$d"; skip_case "a symlink whose NAME holds the secret" unsafe-tree "$d"
chk "H unsafe-tree: a path holding a secret is never named in the DETAIL" 'nosecret $(K $d) $d/run.log && ! grep -q "tok_" $(K $d)'
nx pass; ln -s /etc/hostname "$d/tree/sp ace-link"; run "$d"; skip_case "a symlink with a space in its name" unsafe-tree "$d"
chk "H unsafe-tree: a path with a character outside [A-Za-z0-9._-] in a segment (here a space) is not named (the sentence alone)" '! grep -q "ace" $(K $d)'
nx pass; rm -rf "$d/tree/.git"; run "$d"; skip_case "not a git work tree" unsafe-tree "$d"
nx pass; echo tampered >> "$d/tree/src/app.txt"; run "$d"; skip_case "content drift" fingerprint-mismatch "$d"
chk "H fingerprint-mismatch: DETAIL names the first path, no sidecar line, no host path" 'grep -q "^DETAIL: .*: src/app.txt$" $(K $d) && ! grep -q "/home\|/tmp" $(K $d)'
nx pass; echo "garbage line with /etc/passwd" >> "$d/swarm/manifests/T.1.sha256"; run "$d"; skip_case "an unparseable sidecar line" fingerprint-mismatch "$d"
chk "H fingerprint-mismatch: the offending SIDECAR LINE is never quoted in the DETAIL" '! grep -q "garbage\|passwd" $(K $d)'
nx quota; run "$d"; skip_case "usage limit (error event)" quota "$d"; DQ1=$(field $(K $d) DETAIL)
nx quota-stderr; run "$d"; skip_case "usage limit on stderr only" quota "$d"; DQ2=$(field $(K $d) DETAIL)
nx quota-failed; run "$d"; skip_case "quota in a turn.failed event" quota "$d"; DQ3=$(field $(K $d) DETAIL)
nx quota-auth; run "$d"; skip_case "quota outranks auth" quota "$d"
nx longerr; run "$d"; skip_case "a long error message holding the secret" quota "$d"; DQ4=$(field $(K $d) DETAIL)
chk "H a secret inside Codex's error message never reaches the skip DETAIL — nor any Codex words" 'nosecret $(K $d) $d/run.log && ! grep -qiE "Too Many Requests|usage limit|XXXX" $(K $d)'
nx auth; run "$d"; skip_case "a 401 from Codex" auth "$d"
chk "H the rejected-login DETAIL is a fixed sentence, not the freshness one and not Codex's words" '! grep -qi "refresh token has expired\|needs a refresh" $(K $d)'
nx crash; run "$d"; skip_case "codex crash" codex-error "$d"
nx crash-secret; run "$d"; skip_case "a secret on stderr" codex-error "$d"
chk "H a secret on stderr never reaches the skip record, the log or the audit dir" 'nosecret $(K $d) $d/run.log $(A $d)'
nx crash-with-last; run "$d"; skip_case "codex exit != 0 even with a last.json" codex-error "$d"
nx incidental; run "$d"; skip_case "'quota'/'429' in an ordinary event is not quota" codex-error "$d"
nx reqid; run "$d"; skip_case "a request_id holding 429 is not quota (only the message counts)" codex-error "$d"
nx reqid-failed; run "$d"; skip_case "a code field holding 401 is not auth (turn.failed)" codex-error "$d"
nx noout; run "$d"; skip_case "exit 0 without last.json" codex-error "$d"
nx hang; CT=8 run "$d"; skip_case "timeout" timeout "$d"
nx invalid; run "$d"; skip_case "schema: bad enum + empty criteria" schema-invalid "$d"
nx invalid-json; run "$d"; skip_case "schema: not JSON" schema-invalid "$d"
nx invalid-extra; run "$d"; skip_case "schema: an extra key" schema-invalid "$d"
chk "H schema-invalid: the DETAIL never names the extra key or an enum value from the answer" '! grep -qi "TOPSECRET\|MAYBE\|secretkey" $(K $d)'
nx pass-inconsistent; run "$d"; skip_case "PASS with a failed criterion" schema-invalid "$d"
nx fail-inconsistent; run "$d"; skip_case "FAIL with every criterion passing" schema-invalid "$d"
nx lastlink; run "$d"; skip_case "last.json is a symlink (present, never followed)" schema-invalid "$d"
nx lastdir; run "$d"; skip_case "last.json is a directory (present)" schema-invalid "$d"
nx lastbig; run "$d"; skip_case "last.json over 4 MiB" schema-invalid "$d"
nx lastmid; run "$d"
chk "H last.json of 1.5 MiB: the verdict is written, the file is not kept (over 1 MiB) and dropped.txt says so" '[[ -f $(V $d) && ! -e $(A $d)/out/last.json ]] && grep -qP "^last.json\tlarger than 1 MiB" $(A $d)/dropped.txt'
nx notools; run "$d"; skip_case "Codex could not run commands (its FAIL must not count)" codex-error "$d"
chk "H notools: DETAIL says tool execution unavailable" 'grep -qi "tool execution unavailable" $(K $d)'
nx tools-words; run "$d"
chk "H the same words in an ordinary event do not void a verdict" '[[ -f $(V $d) && ! -e $(K $d) ]]'
nx tools-field; run "$d"
chk "H the words outside an error event's message do not void a verdict" '[[ -f $(V $d) && ! -e $(K $d) ]]'
nx evidence-free; run "$d"; skip_case "PASS with an empty result" evidence-free-pass "$d"
nx leak; run "$d"; skip_case "an auth secret in last.json" secret-leak "$d"
chk "H secret-leak: no secret anywhere (audit dir, skip, log); last.json is dropped (listed); the CLEAN files are still kept" '[[ ! -e $(S $d)/last.json && -f $(S $d)/stub-argv ]] && nosecret $(A $d) $(K $d) $d/run.log && grep -qP "^last.json\tcontains a secret" $(A $d)/dropped.txt'
nx leak-escaped; run "$d"; skip_case "a u-escaped secret in last.json" secret-leak "$d"
nx leak-invalid; run "$d"; skip_case "a secret in a last.json that is not even JSON" secret-leak "$d"
nx echo-secret; run "$d"
chk "H an event carrying a secret: events.jsonl is DROPPED (never redacted), listed; the verdict is still written" '[[ -f $(V $d) && ! -e $(A $d)/events.jsonl ]] && grep -qP "^events.jsonl\tcontains a secret" $(A $d)/dropped.txt && nosecret $(A $d) $(V $d)'
nx pass; printf 'REASON: quota\nDETAIL: old\nTASK: T\nATTEMPT: 1\n' > "$(K "$d")"; run "$d"
chk "H a verdict replaces a stale skip record" '[[ -f $(V $d) && ! -e $(K $d) ]]'
nx crash; printf 'REASON: quota\nDETAIL: old\nTASK: T\nATTEMPT: 1\n' > "$(K "$d")"; run "$d"; skip_case "a new skip replaces the old skip record" codex-error "$d"
nx pass; printf 'VERDICT: FAIL\nCHECKER: checker-codex\nFAMILY: crossvendor\nTASK: T\nATTEMPT: 1\n---\nearlier FAIL\n' > "$(V "$d")"; vsha=$(sha256sum < "$(V "$d")"); mkdir -p "$(A $d)"; echo m > "$(A $d)/marker.txt"; run "$d"
chk "H an existing verdict is never replaced: nothing run, the audit dir untouched" '[[ $RC == 0 && "$(sha256sum < $(V $d))" == "$vsha" && ! -e $(K $d) && ! -e $(S $d)/stub-argv && -f $(A $d)/marker.txt ]] && grep -q "already exists" $d/run.log'
nx crash; mkdir -p "$(A "$d")/out"; printf '{"verdict":"PASS","criteria":[{"id":"a","attack":"x","command":"c","result":"r","pass":true}],"observations":[]}\n' > "$(A "$d")/out/last.json"; run "$d"
skip_case "a stale out/last.json is never reused" codex-error "$d"

# --- keep-or-drop: names, forms, shapes, limits, on verdict and skip paths ---------------------
nx leak-ro; run "$d"
chk "H leak-ro: the run yields its verdict; a secret in a read-only file, a mode-000 file or a mode-000 folder is nowhere" '[[ -f $(V $d) && ! -e $(K $d) ]] && nosecret $(A $d) $(V $d) $d/run.log && [[ ! -e $(S $d)/readonly.txt && ! -e $(S $d)/m000.txt && ! -e $(S $d)/locked ]]'
chk "H leak-ro: a clean mode-000 file is dropped as unreadable, never assumed clean" '[[ ! -e $(S $d)/m000-clean.txt ]] && grep -qP "^m000-clean.txt\tunreadable" $(A $d)/dropped.txt'
chk "H leak-ro: the private temp dir with its locked folder was deleted" '[[ -z "$(ls -A $d/htmp)" ]]'
nx deep; run "$d"
chk "H deep: the attack really planted a secret (relative walk past PATH_MAX)" '[[ "$(cat $(S $d)/stub-deep-planted 2>/dev/null)" == planted ]]'
chk "H deep: never kept, the verdict is written, the audit out/ is flat, and the private tree (deeper than PATH_MAX) was deleted" '[[ -f $(V $d) ]] && nosecret $(A $d) $(V $d) && [[ -z "$(find $(A $d)/out -mindepth 1 ! -type f)" && -z "$(ls -A $d/htmp)" ]] && grep -qP "^<unprintable name>\tname not allowed" $(A $d)/dropped.txt'
nx linkout; run "$d"
chk "H linkout: symlinks, a sub-folder, a FIFO and dot-files planted in /out are not kept" '[[ -f $(V $d) && ! -e $(S $d)/auth-link && ! -L $(S $d)/auth-link && ! -L $(S $d)/pw-link && ! -e $(S $d)/sub && ! -e $(S $d)/pipe && ! -e $(S $d)/.hidden && ! -e $(S $d)/.git && ! -e "$(S $d)/sp ace.txt" ]]'
chk "H linkout: dropped.txt lists them: plain names as written, others as <unprintable name>" 'grep -qP "^auth-link\tsymlink" $(A $d)/dropped.txt && grep -qP "^pw-link\t" $(A $d)/dropped.txt && grep -qP "^sub\tdirectory" $(A $d)/dropped.txt && grep -qP "^pipe\t" $(A $d)/dropped.txt && [[ $(grep -c "^<unprintable name>" $(A $d)/dropped.txt) -ge 3 ]] && ! grep -q "hidden\|sp ace" $(A $d)/dropped.txt'
nx secretname; run "$d"
chk "H secretname: an entry NAMED with the secret (file, link, folder) is not kept and its name appears nowhere" '[[ -f $(V $d) && -z "$(find $(A $d) -name "*tok_FAKE*" 2>/dev/null)" ]] && nosecret $(A $d) $(V $d) && ! grep -rqa "tok_FAKE" $(A $d)/dropped.txt'
nx esckey; run "$d"
chk "H esckey: a secret spelled as u-escapes — as a JSON key, in plain text, double-escaped — drops each file" '[[ -f $(V $d) && ! -e $(S $d)/esckey.json && ! -e $(S $d)/esctext.txt && ! -e $(S $d)/dblesc.txt ]] && grep -qP "^esckey.json\tcontains a secret" $(A $d)/dropped.txt'
nx utf16; run "$d"
chk "H utf16: UTF-16LE and UTF-16BE copies of the secret are dropped" '[[ -f $(V $d) && ! -e $(S $d)/u16le.bin && ! -e $(S $d)/u16be.bin ]]'
nx forms; run "$d"
chk "H forms: a partially escaped secret, and an escaped secret in an event, are dropped (events.jsonl too)" '[[ -f $(V $d) && ! -e $(S $d)/partial.txt && ! -e $(A $d)/events.jsonl ]] && grep -qP "^events.jsonl\tcontains a secret" $(A $d)/dropped.txt'
nx proxyleak; run "$d"
chk "H proxyleak: a secret smuggled into the proxy log (as a hostname) -> proxy.log dropped, listed; nothing else lost" '[[ -f $(V $d) && ! -e $(A $d)/proxy.log && -f $(A $d)/events.jsonl ]] && grep -qP "^proxy.log\tcontains a secret" $(A $d)/dropped.txt && nosecret $(A $d)'
nx many; run "$d"
chk "H many: exactly 64 files kept when more are offered (last.json among them)" '[[ -f $(V $d) && $(find $(A $d)/out -maxdepth 1 -type f | wc -l) -eq 64 && -f $(A $d)/out/last.json ]] && grep -q "over the 64-entry limit" $(A $d)/dropped.txt'
nx big; run "$d"
chk "H big: 1 048 576 bytes is kept, 1 048 577 is not" '[[ -f $(V $d) && -f $(S $d)/exact.bin && ! -e $(S $d)/over.bin ]]'
nx longname; run "$d"
chk "H longname: a 64-character name is kept, 65 is not" '[[ -f $(V $d) && -f $(S $d)/$(printf "n%.0s" $(seq 1 64)) && ! -e $(S $d)/$(printf "n%.0s" $(seq 1 65)) ]]'
nx quota; run "$d"
chk "H keep-or-drop runs on skip paths too: the stub's clean records are kept after a quota skip" '[[ "$(field $(K $d) REASON)" == quota && -f $(S $d)/stub-argv && -f $(A $d)/events.jsonl && -f $(A $d)/dropped.txt ]]'
nx hang; CT=8 run "$d"
chk "H ...and after a timeout skip" '[[ "$(field $(K $d) REASON)" == timeout && -f $(S $d)/stub-argv && -f $(A $d)/dropped.txt && -z "$(ls -A $d/htmp)" ]]'

# --- auth: read-only, no on-disk copy, the pre-run secret set, the freshness gate ----------------
nx trunc-auth; AUTH_T="$WORK/auth-trunc.json"; cp "$FAKE_AUTH" "$AUTH_T"; run "$d" CODEX_AUTH="$AUTH_T"
skip_case "a container that tries to rewrite auth.json still cannot hide a leak" secret-leak "$d"
chk "H auth: truncating AND deleting the mounted file are both refused; the host file is byte-identical" '[[ "$(cat $(S $d)/stub-trunc)" == refused && "$(cat $(S $d)/stub-rm)" == refused && "$(sha256sum < $AUTH_T | cut -d" " -f1)" == "$FAKE_SHA" ]]'
jwt() { python3 -c "import base64,json,sys,time; e=lambda o: base64.urlsafe_b64encode(json.dumps(o).encode()).rstrip(b'=').decode(); print(e({'alg':'none'})+'.'+e({'exp':int(time.time())+int(sys.argv[1])})+'.sig')" "$1"; }
agoZ() { python3 -c "import datetime,sys; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=float(sys.argv[1]))).strftime('%Y-%m-%dT%H:%M:%S.%fZ'))" "$1"; }
mkauth() { printf '{"last_refresh":"%s","tokens":{"access_token":"%s","refresh_token":"%s"}}\n' "$(agoZ "$1")" "$(jwt "$2")" "$SECRET" > "$3"; }
mkauth 7.5 864000 "$WORK/a-stale.json"; mkauth 6.5 864000 "$WORK/a-ok.json"; mkauth 1 600 "$WORK/a-exp.json"; mkauth 1 1300 "$WORK/a-exp-ok.json"; echo '{}' > "$WORK/a-empty.json"
fresh_case() {                                         # label auth-file expect(auth|verdict)
  nx pass; run "$d" CODEX_AUTH="$2" CODEX_TIMEOUT=300
  if [[ "$3" == auth ]]; then
    chk "H fresh: $1 -> skip auth, exit 0, before any container (no output of the stub, no temp dir made)" '[[ $RC == 0 && "$(field $(K $d) REASON)" == auth && ! -e $(S $d)/stub-argv && -z "$(ls -A $d/htmp)" ]]'
  else chk "H fresh: $1 -> proceeds" '[[ -f $(V $d) ]]'; fi
}
fresh_case "last_refresh 7.5 days ago (Z form)" "$WORK/a-stale.json" auth
chk "H fresh: the DETAIL is exactly the pinned sentence" '[[ "$(field $(K $d) DETAIL)" == "Codex login needs a refresh: open Codex on this machine once, then re-run" ]]'
fresh_case "last_refresh 6.5 days ago" "$WORK/a-ok.json" verdict
fresh_case "an access token expiring in 600 s (< timeout 300 + 600)" "$WORK/a-exp.json" auth
fresh_case "an access token expiring in 1300 s (> timeout 300 + 600)" "$WORK/a-exp-ok.json" verdict
fresh_case "an auth file with no secret at all" "$WORK/a-empty.json" auth
chk "H fresh: the no-secret DETAIL is its own sentence, not the refresh one" '! grep -qi "needs a refresh" $(K $d)'
nx pass; run "$d" CODEX_AUTH="$WORK/a-stale.json" DOCKER_HOST=unix:///nonexistent/docker.sock; skip_case "docker-unavailable comes BEFORE the freshness gate (step 1 then 1b)" docker-unavailable "$d"

# rotation, the on-disk scan during a run, signals and SIGKILL (planted-then-signalled)
mine() { for id in $(docker ps -q --filter label=com.docker.compose.service=checker 2>/dev/null); do
           docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$id" 2>/dev/null | grep -qF "$TREE/swarm/codex/" && echo "$id"; done; }
launch() {                                             # dir auth -> PID (background harness)
  mkdir -p "$1/htmp"
  ( cd "$TREE" && env TMPDIR="$1/htmp" SWARM_DIR="$1/swarm" SWARM_TREE="$1/tree" CODEX_BIN="$STUB" CODEX_AUTH="$2" \
      CODEX_MODEL=gpt-6-astra CODEX_TIMEOUT=300 bash "$SCRIPT" T 1 ) > "$1/run.log" 2>&1 & PID=$!
}
waitfor() { local i; for i in $(seq 1 ${2:-240}); do eval "$1" && return 0; sleep 0.5; done; return 1; }
ROT_NEW=tok_ROTATED_SECRET_9876543210zyxwvUT
nx rotate-old; cp "$FAKE_AUTH" "$WORK/auth-rot.json"; launch "$d" "$WORK/auth-rot.json"
waitfor 'compgen -G "$d/htmp/*/out/ready" >/dev/null'; up=$?
chk "H rotation: the checker is running and has written into its PRIVATE /out" '[[ $up == 0 ]]'
chk "H DURING the run no file in the private temp dir holds an auth secret (no snapshot, no copy on disk)" 'nosecret $d/htmp'
chk "H DURING the run nothing of Codex's has reached the audit dir yet (only harness-written files)" '[[ -z "$(find $(A $d)/out -mindepth 1 2>/dev/null)" && ! -e $(A $d)/events.jsonl && ! -e $(A $d)/proxy.log ]]'
printf '{"tokens":{"access_token":"%s"},"short":"abc"}\n' "$ROT_NEW" > "$WORK/auth-rot.json"
wait $PID; RC=$?
chk "H rotation: the OLD secret (read before the run, held in memory) still yields secret-leak" '[[ "$(field $(K $d) REASON)" == secret-leak ]] && nosecret $(A $d) $(K $d)'
nx rotate-new; cp "$FAKE_AUTH" "$WORK/auth-rot.json"; launch "$d" "$WORK/auth-rot.json"
waitfor 'compgen -G "$d/htmp/*/out/ready" >/dev/null'; printf '{"tokens":{"access_token":"%s"},"short":"abc"}\n' "$ROT_NEW" > "$WORK/auth-rot.json"
wait $PID; RC=$?
chk "H rotation: a file holding the NEW secret is dropped (union with the live file)" '[[ -f $(V $d) && ! -e $(S $d)/new.txt ]] && ! grep -rqa "tok_ROTATED" $(A $d) $(V $d)'
mine_left() { local n=0 id; for id in $(docker ps -aq --filter label=com.docker.compose.project.config_files 2>/dev/null); do
                docker inspect -f '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$id" 2>/dev/null | grep -qF "$TREE/swarm/codex/" && n=$((n+1)); done; echo $n; }
planted() { compgen -G "$1/htmp/*/out/leak.txt" >/dev/null; }
sig_case() {                                           # label expected-rc signals...
  local label="$1" want="$2"; shift 2
  nx slow-leak; launch "$d" "$FAKE_AUTH"
  waitfor 'planted "$d"'; local seen=$?
  for sg in "$@"; do
    kill -"$sg" $PID 2>/dev/null
    if [[ "$sg" == "${SIG_WAIT_DOWN:-}" ]]; then waitfor 'pgrep -f "docker compose .*agents2-codex-.* down" >/dev/null' 40 || true; else sleep 0.4; fi
  done
  wait $PID; RC=$?
  chk "H signals: $label — the secret was planted first; exit $want; no secret in the audit dir, verdicts or skip; the private dir removed; no container or network of this run left" '[[ $seen == 0 && $RC == '"$want"' ]] && nosecret $(A $d) $d/swarm/verdicts && [[ -z "$(ls -A $d/htmp 2>/dev/null)" && $(mine_left) == 0 ]]'
  chk "H signals: $label — a skip record with the fixed interrupted DETAIL, and only harness/clean files in the audit dir" '[[ "$(field $(K $d) REASON)" == container-error && "$(field $(K $d) DETAIL)" == *interrupted* ]] && [[ ! -e $(S $d)/leak.txt ]]'
}
sig_case "TERM" 143 TERM
SIG_WAIT_DOWN=TERM sig_case "TERM, then TERM again while the teardown runs" 143 TERM TERM
sig_case "INT then HUP" 130 INT HUP
sig_case "HUP" 129 HUP
nx slow-leak; launch "$d" "$FAKE_AUTH"; waitfor 'planted "$d"'; seen=$?
kill -KILL $PID 2>/dev/null; wait $PID 2>/dev/null
chk "H SIGKILL after the secret was planted: the audit dir holds no secret and no unchecked Codex file (only harness-written files and an empty out/)" '[[ $seen == 0 ]] && nosecret $(A $d) $d/swarm/verdicts && [[ -z "$(find $(A $d)/out -mindepth 1 2>/dev/null)" && ! -e $(A $d)/events.jsonl && ! -e $(A $d)/proxy.log ]]'
# a SIGKILLed run leaves its private temp dir and its compose project: removing them is the test's job
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

# --- A4 item 4: a valid last.json, then /out set to mode 000 -----------------------------------------
nx lockout; run "$d"
skip_case "A4-4 a valid last.json, then /out set to mode 000: the harness cannot search the dir, so last.json counts as PRESENT -> step 7 judges it" schema-invalid "$d"
chk "A4-4 lockout: not codex-error, no verdict; the unlistable out/ is dropped whole (listed), nothing kept, no secret anywhere, private dir deleted" '[[ ! -e $(V $d) && -z "$(find $(A $d)/out -mindepth 1 2>/dev/null)" && -z "$(ls -A $d/htmp)" ]] && grep -qP "^out\tthe private output dir could not be listed" $(A $d)/dropped.txt && nosecret $(A $d) $(K $d) $d/run.log && ! grep -q "codex-error" $(K $d)'

# --- A4 item 1, real docker: the whole harness (copy, verdict, keep) traced -------------------------
if command -v strace >/dev/null 2>&1; then
  nx pass; mkdir -p "$d/htmp"
  ( cd "$TREE" && env TMPDIR="$d/htmp" SWARM_DIR="$d/swarm" SWARM_TREE="$d/tree" CODEX_BIN="$STUB" CODEX_AUTH="$FAKE_AUTH" CODEX_MODEL=gpt-6-astra CODEX_TIMEOUT=300 \
      strace -f -qq -v -e trace=execve,execveat -s 1000000 -o "$d/trace" bash "$SCRIPT" T 1 ) > "$d/run.log" 2>&1
  tc=$(python3 "$HERE/trace_check.py" "$d/trace" "$SECRET" 2>&1); tcrc=$?
  chk "H A4-1 a traced full run (real container): the verdict is written, no argv carries a secret, only tools.py processes carry it in their environment" '[[ -f $(V $d) && $tcrc == 0 ]]'
  [[ $tcrc == 0 ]] || sed 's/^/#     /' <<<"$tc"
  chk "H A4-1 ...and the trace saw the copy, verdict and keep processes carry it (>= 3 tools.py execs with the secret in their environment)" '[[ "$(awk '"'"'$1=="ok"{print $4+0}'"'"' <<<"$tc")" -ge 3 ]]'
else ok "H A4-1 (skipped: strace is not installed)"; fi

# --- A4 item 3, real docker: signals sent to the harness's whole PROCESS GROUP ---------------------------
glaunch() {                                            # dir auth -> PID: the harness as its own process-group leader
  mkdir -p "$1/htmp"
  ( cd "$TREE" && exec setsid env TMPDIR="$1/htmp" SWARM_DIR="$1/swarm" SWARM_TREE="$1/tree" CODEX_BIN="$STUB" CODEX_AUTH="$2" \
      CODEX_MODEL=gpt-6-astra CODEX_TIMEOUT=300 bash "$SCRIPT" T 1 ) > "$1/run.log" 2>&1 & PID=$!
}
proj_left() { [[ -n "$1" ]] || return 0; docker ps -aq --filter "label=com.docker.compose.project=$1"
  docker network ls -q --filter "label=com.docker.compose.project=$1"; docker network ls -q --filter "name=^$1_"
  docker volume ls -q --filter "label=com.docker.compose.project=$1"; }
proj_sweep() { [[ -n "$1" ]] || return 0; local id
  for id in $(docker ps -aq --filter "label=com.docker.compose.project=$1"); do docker rm -f -v "$id" >/dev/null 2>&1; done
  for id in $(docker network ls -q --filter "label=com.docker.compose.project=$1") $(docker network ls -q --filter "name=^$1_"); do docker network rm "$id" >/dev/null 2>&1; done
  for id in $(docker volume ls -q --filter "label=com.docker.compose.project=$1"); do docker volume rm -f "$id" >/dev/null 2>&1; done; }
gbarrage() {                                           # label first-signal when(down|now) gap signals...
  local label="$1" first="$2" when="$3" gap="$4"; shift 4
  nx slow-leak; glaunch "$d" "$FAKE_AUTH"
  waitfor '[[ -n "$(mine)" ]]'
  local pj; pj=$(for id in $(mine); do docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id"; done | sort -u)
  [[ "$(grep -c . <<<"$pj")" == 1 ]] || pj=""
  local lead; lead=$(ps -o pgid= -p "$PID" 2>/dev/null | tr -d ' ')
  waitfor 'planted "$d"'; local seen=$?
  kill -"$first" -- -"$PID" 2>/dev/null
  local t=0 indown=no
  if [[ "$when" == down ]]; then                        # the barrage lands while THIS project's `compose ... down` runs
    while (( t < 600 )); do
      if [[ -n "$pj" ]] && pgrep -f -- "$pj.* down( |\$)" >/dev/null; then indown=yes; break; fi
      kill -0 "$PID" 2>/dev/null || break
      sleep 0.05; t=$((t+1))
    done
  fi
  for sg in "$@"; do kill -"$sg" -- -"$PID" 2>/dev/null; sleep "$gap"; done
  wait $PID 2>/dev/null; local grc=$?
  sleep 2; local left; left=$(proj_left "$pj" | sort -u | tr '\n' ' ')
  chk "H A4-3 group $label: set-up valid (own process group, exactly one project, secret planted$([[ $when == down ]] && echo ", barrage during compose down"))" '[[ $seen == 0 && "$lead" == "$PID" && -n "$pj" && ( "$when" == now || $indown == yes ) ]]'
  chk "H A4-3 group $label: no container, network or volume of the project remains; the private dir is gone; no secret in the audit dir, verdicts or skip" '[[ -n "$pj" && -z "${left// /}" && -z "$(ls -A $d/htmp 2>/dev/null)" ]] && nosecret $(A $d) $d/swarm/verdicts'
  chk "H A4-3 group $label: the run's outcome stands (skip container-error, exit 130)" '[[ "$(field $(K $d) REASON)" == container-error && ! -e $(V $d) && $grc == 130 ]]'
  [[ -z "${left// /}" ]] || echo "#     left behind: $left"
  proj_sweep "$pj"; chmod -R u+rwX "$d/htmp" 2>/dev/null; rm -rf "$d/htmp"
}
gbarrage "(ii) INT after the plant, TERM x3 while compose down runs" INT down 0.4 TERM TERM TERM
gbarrage "(iii) INT after the plant, TERM x3 at once" INT now 0.1 TERM TERM TERM

# interface
( cd "$TREE" && bash "$SCRIPT" ) > /dev/null 2>&1; u1=$?
( cd "$TREE" && bash "$SCRIPT" T ) > /dev/null 2>&1; u2=$?
( cd "$TREE" && bash "$SCRIPT" T 1 extra ) > /dev/null 2>&1; u3=$?
d="$WORK/usage"; mkfx "$d" pass
( cd "$TREE" && SWARM_DIR="$d/swarm" SWARM_TREE="$d/tree" bash "$SCRIPT" T x ) > /dev/null 2>&1; u4=$?
( cd "$TREE" && SWARM_DIR="$d/swarm" SWARM_TREE="$d/tree" bash "$SCRIPT" T -1 ) > /dev/null 2>&1; u5=$?
( cd "$TREE" && SWARM_DIR="$d/swarm" SWARM_TREE="$d/tree" bash "$SCRIPT" ../evil 1 ) > /dev/null 2>&1; u6=$?
chk "H usage: 0, 1, 3 arguments, a non-integer / negative attempt, a path-like task -> exit 2" '[[ $u1 == 2 && $u2 == 2 && $u3 == 2 && $u4 == 2 && $u5 == 2 && $u6 == 2 ]]'
chk "H usage errors write nothing" '[[ -z "$(ls -A $d/swarm/verdicts)" ]]'

# every skip record's DETAIL is one fixed sentence: the same sentence for the same cause, no Codex words, no host path
det_bad=""
for f in $WORK/k*/swarm/verdicts/T.1.checker-codex.skip; do
  [[ -f "$f" ]] || continue
  dl=$(field "$f" DETAIL)
  grep -qiE "Too Many Requests|refresh token has expired|stub internal failure|usage limit reached|req_4291|MAYBE|TOPSECRET|tok_|$WORK|/home/|/tmp/|/etc/|/usr/|$HOME" <<<"$dl" && det_bad+="$f: $dl | "
done
chk "H no skip DETAIL (all scenarios) carries Codex's words, a secret, or a host path" '[[ -z "$det_bad" ]]'
[[ -z "$det_bad" ]] || echo "#     $det_bad"
chk "H the same cause gives the same DETAIL sentence (quota from an event, from stderr, from turn.failed, from a long message)" '[[ -n "$DQ1" && "$DQ1" == "$DQ2" && "$DQ2" == "$DQ3" && "$DQ3" == "$DQ4" ]]'

# =========================== Z. hygiene ====================================================
chk "Z no containers left behind" '[[ $(docker ps -aq | wc -l) == $C0 ]]'
chk "Z no networks left behind" '[[ $(docker network ls -q | wc -l) == $N0 ]]'
chk "Z no per-run images left behind (fixed names only)" '[[ "$(imgs)" == "$I0" ]]'
chk "Z the fixed-name images exist" 'docker image inspect agents2-codex-check:local agents2-codex-proxy:local >/dev/null 2>&1'
chk "Z no volumes left behind" '[[ $(docker volume ls -q | wc -l) == $V0 ]]'
leftover=$(for h in $WORK/*/htmp; do [[ -n "$(ls -A $h 2>/dev/null)" ]] && echo "$h"; done)
chk "Z every run removed its private temp dir" '[[ -z "$leftover" ]]'
[[ -z "$leftover" ]] || echo "#     leftover: $leftover"

if (( NFAIL == 0 )); then echo "ALL PASS"; exit 0; fi
echo "FAILED: $NFAIL"; exit 1
