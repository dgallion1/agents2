# Tiered Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the boss/worker/checker swarm kit with three verification tiers selected per task, evidence-backed escalation, and a mechanical acceptance gate (`gate.sh`) the boss cannot bypass.

**Architecture:** Prompt-driven dispatch over a mechanical enforcement core. The boss assigns a tier per task and dispatches workers/checkers as before, but every agent writes its own evidence file (manifest or verdict) into a gitignored `.swarm/` run directory, and a pure-bash `gate.sh` — no LLM calls — reads that evidence and decides acceptance. Tier 1 = one checker; Tier 2 = dual-family checkers + 3-judge dispute panel; Tier 3 = blind N-version in two worktrees, behavioral divergence report, then Tier 2 checks on the merge.

**Tech Stack:** Bash (gate + worktree scripts), Python 3 (glob matching, already a kit dependency via `difflib`), LiteLLM gateway + Docker (unchanged base kit), Claude Code subagents (Markdown frontmatter agents), git worktrees.

## Global Constraints

- **The kit is a git repo** rooted at `/home/darrell/work/agents2`; `git init` is already done. Tracked kit lives at the repo root and in `.claude/agents/`, `swarm/`, `smoketest/`.
- **`.swarm/` is per-project run state and is gitignored.** Never commit it. `swarm/` (no dot) is the tracked directory of kit scripts — do not confuse the two.
- **`gate.sh` makes zero LLM calls** and stays roughly 100–200 lines of bash. Target length is a guide, not a hard limit.
- **`gate.sh` reads its root from `$SWARM_DIR`** (default `.swarm`) so tests can point it at fixtures. It never hard-codes `.swarm`.
- **Every agent writes its own evidence** (Evidence formats below). The boss reads evidence and updates ledger status; the boss never transcribes a verdict.
- **Model families** are exactly three strings: `anthropic`, `glm`, `local`. Every verdict declares one.
- **Model IDs (verbatim):** boss `claude-fable-5` or `claude-opus-4-8`; checkers/`judge-claude` `checker-haiku` (→ `anthropic/claude-haiku-4-5-20251001`); `checker-second`/`judge-glm` `checker-glm` (→ GLM via Z.ai); `worker-local`/`judge-local` `worker-local` (→ local Qwen). These are LiteLLM aliases resolved by the gateway.
- **TDD throughout:** write the failing test, watch it fail, implement minimally, watch it pass, commit. Bash tests are zero-dependency (plain `bash`, no `bats`).

### Evidence formats (canonical — every task that reads or writes evidence uses these exactly)

**Ledger** — `.swarm/ledger.tsv`, tab-separated, 7 columns, `#` comment lines allowed:

```
task_id <TAB> tier <TAB> checks <TAB> status <TAB> attempt <TAB> worker <TAB> reason
```
- `tier` ∈ `1|2|3`. `attempt` is a non-negative integer. `status` ∈ `pending|running|verifying|accepted|failed|blocked`.
- `checks` is a comma list of the Tier-1 mechanical checkers required, e.g. `content,a11y` (maps to agents `checker-content`, `checker-a11y`). Empty allowed for tasks with no content/markup surface (write a single `-`).

**Verdict file** — `.swarm/verdicts/<task>.<attempt>.<agent-name>.verdict`:

```
VERDICT: PASS | FAIL | UPHOLD | OVERRULE
CHECKER: <agent name>
FAMILY: anthropic | glm | local
TASK: <task-id> ATTEMPT: <n>
---
<free-form evidence: diffs, axe output, reasoning>
```
Checkers write `PASS`/`FAIL`. Judges write `UPHOLD`/`OVERRULE` (of the contested verdict). The boss, when overruling a checker at Tier 1, writes a verdict file with `VERDICT: OVERRULE`, `CHECKER: boss`, `FAMILY: anthropic`.

**Manifest file** — `.swarm/manifests/<task>.<attempt>.files`: repo-relative paths of every file the worker created or changed, one per line, no other content.

**Flag file** — `.swarm/flags/<task>.flag`, written by `gate.sh escalate-scan`:

```
TARGET_TIER: <n>
REASON: <space-separated trigger names>
```
A flag is **unresolved** while the ledger `tier` for that task `< TARGET_TIER`, and **resolved** once `tier >= TARGET_TIER`. `gate.sh check` and `gate.sh done` block on unresolved flags only.

**Tier-3 divergence report** — `.swarm/tier3/<task>/report.md`, written by `tier3-compare.sh`. The boss appends a line starting `RESOLUTION:` when adjudication is done.

**Tier-3 oracle** — `.swarm/tier3/<task>/accept.sh`, an executable script the boss writes before dispatch; prints observations for the acceptance checks. `tier3-compare.sh` runs it inside each worktree.

---

## File structure

Created or modified by this plan:

```
agents2/
├── .gitignore                     # NEW: ignores .swarm/
├── README.md                      # base kit + NEW tier section (Task 12)
├── CLAUDE.md                      # base kit + NEW tier/gate/escalation rules (Task 10)
├── TIERS.md                       # NEW: risk rubric + protocols (Task 9)
├── litellm-config.yaml            # base kit + NEW checker-glm alias (Task 7)
├── docker-compose.yaml            # base kit, unchanged (Task 1)
├── .claude/agents/
│   ├── worker-coder.md            # base + manifest writing (Task 6)
│   ├── worker-local.md            # base + manifest writing (Task 6)
│   ├── checker-content.md         # base + verdict writing (Task 7)
│   ├── checker-a11y.md            # base + verdict writing (Task 7)
│   ├── checker-second.md          # NEW: spec-compliance checker, GLM (Task 7)
│   ├── judge-claude.md            # NEW: dispute judge, correctness lens (Task 8)
│   ├── judge-glm.md               # NEW: dispute judge, standards lens (Task 8)
│   └── judge-local.md             # NEW: dispute judge, user-impact lens (Task 8)
├── swarm/
│   ├── gate.sh                    # NEW: enforcement core (Tasks 2–4)
│   ├── tier3-setup.sh             # NEW: creates 2 worktrees (Task 11)
│   └── tier3-compare.sh           # NEW: runs oracle in both, emits report (Task 11)
└── smoketest/
    ├── gate/
    │   ├── _lib.sh                # NEW: bash test helpers (Task 2)
    │   ├── run_check.sh           # NEW: gate check tests (Task 2)
    │   ├── run_escalate.sh        # NEW: escalate-scan tests (Task 3)
    │   ├── run_done.sh            # NEW: done tests (Task 4)
    │   ├── run_tests.sh           # NEW: runs all gate tests (Task 4)
    │   └── tier3_test.sh          # NEW: worktree-script tests (Task 11)
    ├── checker-evals/             # NEW: planted-fault fixtures + runbook (Task 13)
    └── e2e/                       # NEW: live end-to-end fixture + runbook (Task 14)
```

---

### Task 1: Install the base kit and scaffold the repo

The base kit is not yet on disk — it lives in `/home/darrell/Downloads/files.zip` (8 flat files). This task lays it down at the correct paths, adds the gitignore, and creates the empty tracked directories, so every later task extends real files.

**Files:**
- Create: `.gitignore`
- Create (extracted): `README.md`, `CLAUDE.md`, `litellm-config.yaml`, `docker-compose.yaml`, `.claude/agents/worker-coder.md`, `.claude/agents/worker-local.md`, `.claude/agents/checker-content.md`, `.claude/agents/checker-a11y.md`
- Create dirs: `swarm/`, `smoketest/`

**Interfaces:**
- Produces: the base kit files at the paths above, byte-identical to the zip; `.gitignore` containing `.swarm/`.

- [ ] **Step 1: Write the failing test**

Create `smoketest/verify_layout.sh`:

```bash
#!/usr/bin/env bash
# Structural check: base kit + scaffolding present.
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"
fail=0
for f in README.md CLAUDE.md litellm-config.yaml docker-compose.yaml \
         .claude/agents/worker-coder.md .claude/agents/worker-local.md \
         .claude/agents/checker-content.md .claude/agents/checker-a11y.md \
         .gitignore; do
  if [[ -f "$root/$f" ]]; then echo "ok   - $f"; else echo "FAIL - $f missing"; fail=1; fi
done
grep -q '^\.swarm/' "$root/.gitignore" 2>/dev/null && echo "ok   - .gitignore ignores .swarm/" || { echo "FAIL - .gitignore"; fail=1; }
for d in swarm smoketest .claude/agents; do
  [[ -d "$root/$d" ]] && echo "ok   - dir $d" || { echo "FAIL - dir $d"; fail=1; }
done
exit $fail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/verify_layout.sh`
Expected: FAIL lines for the 8 kit files and `.gitignore` (only the spec exists so far).

- [ ] **Step 3: Extract the base kit and create scaffolding**

```bash
mkdir -p .claude/agents swarm smoketest
unzip -o /home/darrell/Downloads/files.zip -d /tmp/basekit >/dev/null
cp /tmp/basekit/README.md /tmp/basekit/CLAUDE.md \
   /tmp/basekit/litellm-config.yaml /tmp/basekit/docker-compose.yaml .
cp /tmp/basekit/worker-coder.md /tmp/basekit/worker-local.md \
   /tmp/basekit/checker-content.md /tmp/basekit/checker-a11y.md .claude/agents/
printf '.swarm/\n' > .gitignore
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/verify_layout.sh`
Expected: all `ok` lines, exit 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: install base swarm kit and scaffold tiered-verification layout"
```

---

### Task 2: `gate.sh check` — the acceptance core

Builds `gate.sh` with ledger validation, shared helpers, and the `check` subcommand for all three tiers. This is the enforcement heart; the other subcommands slot into it later.

**Files:**
- Create: `swarm/gate.sh`
- Create: `smoketest/gate/_lib.sh`
- Test: `smoketest/gate/run_check.sh`

**Interfaces:**
- Consumes: Evidence formats (ledger, verdict, flag, tier-3 report) from Global Constraints.
- Produces:
  - CLI `SWARM_DIR=<dir> gate.sh check <task-id>` → exit 0 accept, 1 not-acceptable, 2 usage/corruption.
  - Bash functions later tasks extend: `validate_ledger`, `row_for`, `col`, `field_of`, `verdict_files`, `check_tier1`, `check_tier2`, `check_tier3`, `main` dispatch.
  - Test helpers in `_lib.sh`: `newswarm`, `mkledger`, `mkverdict`, `assert_rc`, `assert_file`, `assert_nofile`, `finish`.

- [ ] **Step 1: Write the failing test — `_lib.sh` then `run_check.sh`**

Create `smoketest/gate/_lib.sh`:

```bash
# Shared helpers for gate.sh tests. Source, don't execute.
GATE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../swarm" && pwd)/gate.sh"
FAILN=0
assert_rc()     { if [[ "$2" == "$3" ]]; then echo "ok   - $1"; else echo "FAIL - $1 (want rc $2 got $3)"; FAILN=$((FAILN+1)); fi; }
assert_file()   { if [[ -e "$2" ]];   then echo "ok   - $1"; else echo "FAIL - $1 (missing $2)"; FAILN=$((FAILN+1)); fi; }
assert_nofile() { if [[ ! -e "$2" ]]; then echo "ok   - $1"; else echo "FAIL - $1 (unexpected $2)"; FAILN=$((FAILN+1)); fi; }
newswarm()  { local d; d=$(mktemp -d); mkdir -p "$d/verdicts" "$d/manifests" "$d/flags" "$d/tier3"; echo "$d"; }
mkledger()  { printf '%b' "$2" > "$1/ledger.tsv"; }         # $1=swarmdir  $2=body with \t \n
mkverdict() { printf 'VERDICT: %s\nCHECKER: %s\nFAMILY: %s\nTASK: %s ATTEMPT: %s\n---\nevidence\n' \
                 "$5" "$4" "$6" "$2" "$3" > "$1/verdicts/$2.$3.$4.verdict"; } # sd task attempt name verdict family
run_gate()  { local sd="$1"; shift; SWARM_DIR="$sd" bash "$GATE" "$@" >/dev/null 2>&1; return $?; }
finish()    { (( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }; }
```

Create `smoketest/gate/run_check.sh`:

```bash
#!/usr/bin/env bash
set -u
. "$(dirname "$0")/_lib.sh"

# T1: Tier 1 with all required checkers PASS -> accept (rc 0)
sd=$(newswarm)
mkledger "$sd" 't1\t1\tcontent,a11y\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t1 0 checker-content PASS anthropic
mkverdict "$sd" t1 0 checker-a11y    PASS anthropic
run_gate "$sd" check t1; assert_rc "tier1 all-pass accepts" 0 $?

# T2: Tier 2 with only ONE verdict -> reject (rc 1)
sd=$(newswarm)
mkledger "$sd" 't2\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t2 0 checker-content PASS anthropic
run_gate "$sd" check t2; assert_rc "tier2 single verdict rejects" 1 $?

# T3: Tier 2 with two DIFFERENT-family PASS -> accept (rc 0)
sd=$(newswarm)
mkledger "$sd" 't3\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t3 0 checker-content PASS anthropic
mkverdict "$sd" t3 0 checker-second  PASS glm
run_gate "$sd" check t3; assert_rc "tier2 dual-family accepts" 0 $?

# T4: Tier 2 dispute (one FAIL) resolved by 2-of-3 OVERRULE -> accept (rc 0)
sd=$(newswarm)
mkledger "$sd" 't4\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" t4 0 checker-content PASS anthropic
mkverdict "$sd" t4 0 checker-second  FAIL glm
mkverdict "$sd" t4 0 judge-claude OVERRULE anthropic
mkverdict "$sd" t4 0 judge-glm    OVERRULE glm
mkverdict "$sd" t4 0 judge-local  UPHOLD   local
run_gate "$sd" check t4; assert_rc "tier2 dispute overruled accepts" 0 $?

# T5: malformed ledger (6 fields) -> corruption error (rc 2)
sd=$(newswarm)
mkledger "$sd" 'tX\t2\tcontent\tverifying\t0\tworker-coder\n'
run_gate "$sd" check tX; assert_rc "malformed ledger rejected" 2 $?

finish
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/gate/run_check.sh`
Expected: every assertion FAILs / errors — `swarm/gate.sh` does not exist yet.

- [ ] **Step 3: Write `swarm/gate.sh` with `check`**

```bash
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
```

Note: `check_tier1` maps a `checks` entry `content` to verdict file `checker-content.verdict`, matching the agent name.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/gate/run_check.sh`
Expected: 5 `ok` lines then `ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add swarm/gate.sh smoketest/gate/_lib.sh smoketest/gate/run_check.sh
git commit -m "feat(gate): add gate.sh check for tiers 1-3 with dispute resolution"
```

---

### Task 3: `gate.sh escalate-scan` — mechanical escalation triggers

Adds the subcommand that writes escalation flags for the three triggers: two consecutive FAILs, a recorded checker overrule, and a manifest path matching `critical.globs`.

**Files:**
- Modify: `swarm/gate.sh` (add helpers + `cmd_escalate_scan`, wire dispatch)
- Test: `smoketest/gate/run_escalate.sh`

**Interfaces:**
- Consumes: `validate_ledger`, `col`, `field_of` from Task 2; manifest + flag formats.
- Produces: `SWARM_DIR=<dir> gate.sh escalate-scan` → writes `.swarm/flags/<task>.flag` (`TARGET_TIER` = `min(tier+1,3)`) for each task with an active trigger and no existing flag while `tier < target`; deletes a flag when no trigger is active and it is resolved. New bash functions `has_fail_at`, `manifest_hits_glob`, `overrule_exists`, `cmd_escalate_scan`.

- [ ] **Step 1: Write the failing test**

Create `smoketest/gate/run_escalate.sh`:

```bash
#!/usr/bin/env bash
set -u
. "$(dirname "$0")/_lib.sh"

# E1: two consecutive FAILs (attempts 0 and 1) -> flag written
sd=$(newswarm)
mkledger "$sd" 'e1\t1\tcontent\tfailed\t1\tworker-coder\t-\n'
mkverdict "$sd" e1 0 checker-content FAIL anthropic
mkverdict "$sd" e1 1 checker-content FAIL anthropic
run_gate "$sd" escalate-scan; assert_rc "escalate-scan exits 0" 0 $?
assert_file "two consecutive fails -> flag" "$sd/flags/e1.flag"
grep -q '^TARGET_TIER: 2' "$sd/flags/e1.flag" && echo "ok   - e1 target tier 2" || { echo "FAIL - e1 target"; FAILN=$((FAILN+1)); }

# E2: manifest path matches critical.globs -> flag written
sd=$(newswarm)
mkledger "$sd" 'e2\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
printf 'src/payments/**\n' > "$sd/critical.globs"
printf 'src/payments/checkout.js\nsrc/ui/nav.js\n' > "$sd/manifests/e2.0.files"
run_gate "$sd" escalate-scan
assert_file "critical-glob match -> flag" "$sd/flags/e2.flag"

# E3: recorded OVERRULE verdict -> flag written
sd=$(newswarm)
mkledger "$sd" 'e3\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" e3 0 boss OVERRULE anthropic
run_gate "$sd" escalate-scan
assert_file "overrule -> flag" "$sd/flags/e3.flag"

# E4: no trigger -> no flag
sd=$(newswarm)
mkledger "$sd" 'e4\t1\tcontent\tverifying\t0\tworker-coder\t-\n'
mkverdict "$sd" e4 0 checker-content PASS anthropic
run_gate "$sd" escalate-scan
assert_nofile "clean task -> no flag" "$sd/flags/e4.flag"

# E5: unresolved flag blocks check at old tier
sd=$(newswarm)
mkledger "$sd" 'e5\t1\tcontent\tverifying\t1\tworker-coder\t-\n'
mkverdict "$sd" e5 0 checker-content FAIL anthropic
mkverdict "$sd" e5 1 checker-content FAIL anthropic
run_gate "$sd" escalate-scan
mkverdict "$sd" e5 1 checker-content PASS anthropic   # even a pass can't accept while flagged
run_gate "$sd" check e5; assert_rc "unresolved flag blocks check" 1 $?

finish
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/gate/run_escalate.sh`
Expected: FAILs — `escalate-scan` is not a known subcommand yet (rc 2), no flags written.

- [ ] **Step 3: Add escalation to `swarm/gate.sh`**

Insert these helper functions immediately before the `# --- subcommands` banner:

```bash
# --- escalation helpers -----------------------------------------------------
has_fail_at() {                                                    # task attempt
  local f
  for f in "$VERDICTS/$1.$2."*.verdict; do
    [[ -f "$f" ]] || continue
    [[ "$(field_of "$f" VERDICT)" == FAIL ]] && return 0
  done
  return 1
}
overrule_exists() {                                                # task
  grep -lq '^VERDICT: OVERRULE' "$VERDICTS/$1."*.verdict 2>/dev/null
}
manifest_hits_glob() {                                             # task -> 0 if any path matches any glob
  [[ -f "$GLOBS" ]] || return 1
  shopt -s nullglob
  local mans=("$MANIFESTS/$1."*.files); (( ${#mans[@]} )) || return 1
  python3 - "$GLOBS" "${mans[@]}" <<'PY'
import sys, fnmatch
globs=[l.strip() for l in open(sys.argv[1]) if l.strip() and not l.startswith('#')]
paths=[]
for p in sys.argv[2:]:
    paths += [l.strip() for l in open(p) if l.strip()]
for path in paths:
    for g in globs:
        # fnmatch treats ** like *, which is the desired "any depth" behaviour here
        if fnmatch.fnmatch(path, g) or fnmatch.fnmatch(path, g.replace('/**', '/*')):
            sys.exit(0)
sys.exit(1)
PY
}
```

Add `cmd_escalate_scan` immediately after `cmd_check`:

```bash
cmd_escalate_scan() {
  validate_ledger
  mkdir -p "$FLAGS"
  local row task tier attempt reasons target flag ft
  while IFS= read -r row || [[ -n "$row" ]]; do
    [[ -z "$row" || "$row" == \#* ]] && continue
    task=$(col "$row" 1); tier=$(col "$row" 2); attempt=$(col "$row" 5)
    reasons=""
    if (( attempt >= 1 )) && has_fail_at "$task" "$attempt" && has_fail_at "$task" "$((attempt-1))"; then
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
```

Change the dispatch `case` in `main` to add the subcommand:

```bash
  case "$cmd" in
    check)         cmd_check "$@" ;;
    escalate-scan) cmd_escalate_scan "$@" ;;
    *)             die "usage: gate.sh {check|escalate-scan|done} ..." ;;
  esac
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/gate/run_escalate.sh`
Expected: all `ok`, then `ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add swarm/gate.sh smoketest/gate/run_escalate.sh
git commit -m "feat(gate): add escalate-scan with the three escalation triggers"
```

---

### Task 4: `gate.sh done` — run-level completion + combined test runner

Adds the run-level gate and a single entry point that runs all gate tests.

**Files:**
- Modify: `swarm/gate.sh` (add `cmd_done`, wire dispatch)
- Test: `smoketest/gate/run_done.sh`
- Create: `smoketest/gate/run_tests.sh`

**Interfaces:**
- Consumes: `validate_ledger`, `col`, `field_of`.
- Produces: `SWARM_DIR=<dir> gate.sh done` → exit 0 iff every ledger task has `status=accepted` and no unresolved flag; otherwise lists each blocker and exits 1. `run_tests.sh` runs `run_check.sh`, `run_escalate.sh`, `run_done.sh`.

- [ ] **Step 1: Write the failing test**

Create `smoketest/gate/run_done.sh`:

```bash
#!/usr/bin/env bash
set -u
. "$(dirname "$0")/_lib.sh"

# D1: all accepted, no flags -> done rc 0
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\nb\t2\tcontent\taccepted\t0\tworker-coder\t-\n'
run_gate "$sd" done; assert_rc "all accepted -> done ok" 0 $?

# D2: one task still pending -> done rc 1
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\nb\t2\tcontent\tverifying\t0\tworker-coder\t-\n'
run_gate "$sd" done; assert_rc "pending task -> done fails" 1 $?

# D3: accepted but an UNRESOLVED flag (tier<target) -> done rc 1
sd=$(newswarm)
mkledger "$sd" 'a\t1\tcontent\taccepted\t0\tworker-coder\t-\n'
printf 'TARGET_TIER: 2\nREASON: critical-glob\n' > "$sd/flags/a.flag"
run_gate "$sd" done; assert_rc "unresolved flag -> done fails" 1 $?

# D4: accepted with a RESOLVED flag (tier>=target) -> done rc 0
sd=$(newswarm)
mkledger "$sd" 'a\t2\tcontent\taccepted\t0\tworker-coder\t-\n'
printf 'TARGET_TIER: 2\nREASON: critical-glob\n' > "$sd/flags/a.flag"
run_gate "$sd" done; assert_rc "resolved flag -> done ok" 0 $?

finish
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/gate/run_done.sh`
Expected: FAILs — `done` is not a known subcommand yet (rc 2).

- [ ] **Step 3: Add `cmd_done` to `swarm/gate.sh`**

Add after `cmd_escalate_scan`:

```bash
cmd_done() {
  validate_ledger
  local row task tier status ft missing=0
  while IFS= read -r row || [[ -n "$row" ]]; do
    [[ -z "$row" || "$row" == \#* ]] && continue
    task=$(col "$row" 1); tier=$(col "$row" 2); status=$(col "$row" 4)
    [[ "$status" == accepted ]] || { echo "pending: $task (status=$status)"; missing=1; }
    if [[ -f "$FLAGS/$task.flag" ]]; then
      ft=$(field_of "$FLAGS/$task.flag" TARGET_TIER)
      (( tier < ft )) && { echo "unresolved flag: $task -> tier $ft"; missing=1; }
    fi
  done < "$LEDGER"
  (( missing == 0 )) || fail "run incomplete"
  echo "OK: all tasks accepted, no unresolved flags"
}
```

Add the dispatch case:

```bash
    done)          cmd_done "$@" ;;
```

Create `smoketest/gate/run_tests.sh`:

```bash
#!/usr/bin/env bash
# Runs every deterministic gate test (validation layer 1). No LLM calls.
set -u
d="$(dirname "$0")"; rc=0
for t in run_check.sh run_escalate.sh run_done.sh; do
  echo "== $t =="; bash "$d/$t" || rc=1
done
exit $rc
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bash smoketest/gate/run_done.sh` → all `ok`, `ALL PASS`.
Run: `bash smoketest/gate/run_tests.sh` → all three suites print `ALL PASS`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add swarm/gate.sh smoketest/gate/run_done.sh smoketest/gate/run_tests.sh
git commit -m "feat(gate): add run-level done check and combined gate test runner"
```

---

### Task 5: (reserved — folded)

Manifest-writing for workers is Task 6; checker verdict-writing is Task 7. No separate task. Skip.

---

### Task 6: Workers write file manifests

Extends both worker agents to write their manifest file before returning, so `gate.sh escalate-scan` can match changed paths against `critical.globs`.

**Files:**
- Modify: `.claude/agents/worker-coder.md`
- Modify: `.claude/agents/worker-local.md`
- Test: `smoketest/gate/agents_test.sh` (new)

**Interfaces:**
- Consumes: manifest format (repo-relative paths, one per line) from Global Constraints.
- Produces: both worker prompts instruct writing `.swarm/manifests/<task-id>.<attempt>.files`. The task block supplies `<task-id>` and `<attempt>`.

- [ ] **Step 1: Write the failing test**

Create `smoketest/gate/agents_test.sh`:

```bash
#!/usr/bin/env bash
# Structural checks that agent prompts carry the evidence-writing contracts.
set -u
root="$(cd "$(dirname "$0")/../.." && pwd)/.claude/agents"; FAILN=0
has() { if grep -q "$2" "$root/$1"; then echo "ok   - $1: $3"; else echo "FAIL - $1: $3"; FAILN=$((FAILN+1)); fi; }

has worker-coder.md '.swarm/manifests/' "writes manifest"
has worker-local.md '.swarm/manifests/' "writes manifest"

(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/gate/agents_test.sh`
Expected: both `FAIL` lines — no manifest instruction yet.

- [ ] **Step 3: Add the manifest instruction to both workers**

Append to `.claude/agents/worker-coder.md` (after the `Return format:` block):

```markdown

## Evidence — write your manifest before returning

The lead runs a mechanical gate over evidence you produce. Before you return
STATUS: DONE, record every file you created or changed:

```bash
mkdir -p .swarm/manifests
printf '%s\n' path/one path/two ... > .swarm/manifests/<task-id>.<attempt>.files
```

- Paths are repo-relative, one per line, nothing else in the file.
- `<task-id>` and `<attempt>` are given in your task block. If they are
  missing, return BLOCKED and ask — do not invent them.
- The manifest is how the gate detects critical-path changes. An omitted
  file can let a change skip escalation, so the manifest must be complete.
```

Append the identical section to `.claude/agents/worker-local.md`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/gate/agents_test.sh`
Expected: both `ok`, `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/worker-coder.md .claude/agents/worker-local.md smoketest/gate/agents_test.sh
git commit -m "feat(workers): write file manifests for the acceptance gate"
```

---

### Task 7: Checkers write verdict files + add `checker-second` (2nd family) + `checker-glm` alias

Extends the two mechanical checkers to write verdict files, adds the Tier-2 spec-compliance checker on GLM, and registers the `checker-glm` LiteLLM alias it (and `judge-glm`) run on.

**Files:**
- Modify: `.claude/agents/checker-content.md`
- Modify: `.claude/agents/checker-a11y.md`
- Create: `.claude/agents/checker-second.md`
- Modify: `litellm-config.yaml`
- Modify: `smoketest/gate/agents_test.sh`

**Interfaces:**
- Consumes: verdict format from Global Constraints; existing `worker-glm` Z.ai params as the model shape for `checker-glm`.
- Produces:
  - `checker-content` / `checker-a11y` write `.swarm/verdicts/<task>.<attempt>.<name>.verdict` with `FAMILY: anthropic`.
  - `checker-second` (model `checker-glm`, `FAMILY: glm`) verifies work against the task's acceptance criteria + `SPEC.md`/`ACCESSIBILITY.md`.
  - `litellm-config.yaml` gains a `checker-glm` model alias.

- [ ] **Step 1: Write the failing test**

Extend `smoketest/gate/agents_test.sh` — add before the final tally:

```bash
has checker-content.md '.swarm/verdicts/' "writes verdict"
has checker-a11y.md    '.swarm/verdicts/' "writes verdict"
has checker-second.md  'FAMILY: glm'      "declares glm family"
grep -q 'checker-glm' "$(cd "$(dirname "$0")/../.." && pwd)/litellm-config.yaml" \
  && echo "ok   - litellm: checker-glm alias" || { echo "FAIL - litellm checker-glm"; FAILN=$((FAILN+1)); }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/gate/agents_test.sh`
Expected: new `FAIL` lines for verdict writing, `checker-second.md`, and the alias.

- [ ] **Step 3: Implement**

Append to `.claude/agents/checker-content.md` (after its `Return format:` block):

```markdown

## Evidence — write your verdict before returning

Write your verdict to a file the gate reads; keep returning the same summary
to the lead. You may use Bash to write the file — you still never edit
project files.

```bash
mkdir -p .swarm/verdicts
cat > .swarm/verdicts/<task-id>.<attempt>.checker-content.verdict <<EOF
VERDICT: PASS
CHECKER: checker-content
FAMILY: anthropic
TASK: <task-id> ATTEMPT: <attempt>
---
<your evidence: per-block result, unified diffs for any FAIL>
EOF
```

Use `VERDICT: FAIL` when anything fails. `<task-id>`/`<attempt>` come from the
task block; if absent, return BLOCKED and ask.
```

Append the same section to `.claude/agents/checker-a11y.md`, changing both filename and `CHECKER:` to `checker-a11y` (FAMILY stays `anthropic`).

Create `.claude/agents/checker-second.md`:

```markdown
---
name: checker-second
description: Second-family Tier-2 checker. Verifies a worker's output against the task's acceptance criteria and the project constitution (SPEC.md + ACCESSIBILITY.md), independently of the Anthropic mechanical checkers. Use on Tier 2 and on the merged result of Tier 3. Read-only verifier — never fixes anything.
tools: Read, Grep, Glob, Bash, WebFetch
model: checker-glm
---

You are an independent spec-compliance checker on a different model family
from the mechanical checkers. Your job is to catch what a correlated
Anthropic-only check would miss. You never edit files.

Procedure:
1. Read the task block's acceptance criteria, plus the relevant sections of
   SPEC.md and ACCESSIBILITY.md. These are the standard — not your taste.
2. Verify the changed files satisfy every acceptance criterion and violate no
   numbered constitution point. Use Bash (grep/diff/build/lint) for anything
   mechanically checkable; do not eyeball long passages.
3. Do not defer to the other checker's conclusion — you were dispatched
   precisely to disagree when the evidence warrants it.

## Evidence — write your verdict before returning

```bash
mkdir -p .swarm/verdicts
cat > .swarm/verdicts/<task-id>.<attempt>.checker-second.verdict <<EOF
VERDICT: PASS
CHECKER: checker-second
FAMILY: glm
TASK: <task-id> ATTEMPT: <attempt>
---
<criterion-by-criterion result; cite SPEC/ACCESSIBILITY points for any FAIL>
EOF
```

Return format to the lead: VERDICT / FINDINGS (each tied to a criterion or
constitution point) / SCOPE. A worker may dispute your verdict; the judge
panel adjudicates. Report facts only.
```

Add to `litellm-config.yaml` in the checker tier — insert after the
`checker-haiku` block, before the worker tier comment:

```yaml
  # ── Checker tier: GLM as an independent second family ────────────────
  # Same Z.ai endpoint as worker-glm; separate alias so checker economics
  # and routing stay legible. Used by checker-second and judge-glm.
  - model_name: checker-glm
    litellm_params:
      model: openai/glm-5.2
      api_base: https://api.z.ai/api/paas/v4
      api_key: os.environ/GLM_API_KEY
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/gate/agents_test.sh`
Expected: all `ok`, `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/checker-content.md .claude/agents/checker-a11y.md \
        .claude/agents/checker-second.md litellm-config.yaml smoketest/gate/agents_test.sh
git commit -m "feat(checkers): write verdicts, add second-family checker + checker-glm alias"
```

---

### Task 8: The three dispute judges

Adds the judge panel that replaces solo-boss adjudication on Tier 2+ disputes: three judges, three lenses, three model families.

**Files:**
- Create: `.claude/agents/judge-claude.md`, `.claude/agents/judge-glm.md`, `.claude/agents/judge-local.md`
- Modify: `smoketest/gate/agents_test.sh`

**Interfaces:**
- Consumes: verdict format; the aliases `checker-haiku` (judge-claude), `checker-glm` (judge-glm), `worker-local` (judge-local) — all already in `litellm-config.yaml` after Task 7.
- Produces: three judge agents each writing `.swarm/verdicts/<task>.<attempt>.<judge-name>.verdict` with `VERDICT: UPHOLD|OVERRULE` and the correct `FAMILY`.

- [ ] **Step 1: Write the failing test**

Add to `smoketest/gate/agents_test.sh` before the tally:

```bash
has judge-claude.md 'FAMILY: anthropic' "judge-claude family"
has judge-glm.md    'FAMILY: glm'       "judge-glm family"
has judge-local.md  'FAMILY: local'     "judge-local family"
has judge-claude.md 'UPHOLD'            "judge writes verdict"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/gate/agents_test.sh`
Expected: new `FAIL` lines for the three judges.

- [ ] **Step 3: Create the three judges**

Create `.claude/agents/judge-claude.md`:

```markdown
---
name: judge-claude
description: Dispute judge on the Anthropic family, correctness lens. Dispatched only when a Tier 2+ verdict is contested. Reads the task, the work product, the contested verdict + evidence, and the relevant constitution, then rules UPHOLD or OVERRULE. Read-only.
tools: Read, Grep, Glob, Bash, WebFetch
model: checker-haiku
---

You are one of three dispute judges. Your lens is **correctness**: does the
work actually do what the task's acceptance criteria require, factually and
functionally? You never edit files and you do not consult the other judges.

Procedure:
1. Read the task block, the changed files, the contested verdict and its
   evidence, and the cited SPEC.md / ACCESSIBILITY.md points.
2. Decide whether the contested verdict is correct on the merits. Verify
   claims mechanically with Bash where possible.
3. Rule UPHOLD (the contested verdict stands) or OVERRULE (it does not).

## Evidence — write your ruling before returning

```bash
mkdir -p .swarm/verdicts
cat > .swarm/verdicts/<task-id>.<attempt>.judge-claude.verdict <<EOF
VERDICT: UPHOLD
CHECKER: judge-claude
FAMILY: anthropic
TASK: <task-id> ATTEMPT: <attempt>
---
<your reasoning, grounded in acceptance criteria and constitution points>
EOF
```

Use OVERRULE where the evidence warrants. Return VERDICT + reasoning to the lead.
```

Create `.claude/agents/judge-glm.md` — identical structure with these changes: frontmatter `name: judge-glm`, `model: checker-glm`; lens is **standards** ("does the work meet the letter of ACCESSIBILITY.md / SPEC.md and applicable WCAG criteria?"); verdict file `...judge-glm.verdict`, `CHECKER: judge-glm`, `FAMILY: glm`.

Create `.claude/agents/judge-local.md` — identical structure with: frontmatter `name: judge-local`, `model: worker-local`; lens is **user impact** ("would a real user of the shipped result be harmed or blocked by the disputed issue?"); verdict file `...judge-local.verdict`, `CHECKER: judge-local`, `FAMILY: local`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/gate/agents_test.sh`
Expected: all `ok`, `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add .claude/agents/judge-claude.md .claude/agents/judge-glm.md .claude/agents/judge-local.md smoketest/gate/agents_test.sh
git commit -m "feat(judges): add 3-family dispute panel for tier 2+ disputes"
```

---

### Task 9: `TIERS.md` — the risk rubric

The document the boss uses to propose a tier per task and the user approves at Phase 0.

**Files:**
- Create: `TIERS.md`
- Test: `smoketest/doc_test.sh` (new)

**Interfaces:**
- Produces: `TIERS.md` with the three diagnostic questions, a mapping table, the round-up tie-break rule, and the Phase-0 instruction to add a `Tier` column + draft `critical.globs`.

- [ ] **Step 1: Write the failing test**

Create `smoketest/doc_test.sh`:

```bash
#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"; FAILN=0
has() { if grep -qi "$3" "$root/$1"; then echo "ok   - $1: $2"; else echo "FAIL - $1: $2"; FAILN=$((FAILN+1)); fi; }

has TIERS.md "oracle question"      "oracle"
has TIERS.md "reversible question"  "reversible"
has TIERS.md "blast radius question" "blast radius"
has TIERS.md "round-up tie-break"   "round up"
has TIERS.md "critical.globs"       "critical.globs"

(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/doc_test.sh`
Expected: five `FAIL` lines — `TIERS.md` does not exist.

- [ ] **Step 3: Write `TIERS.md`**

```markdown
# TIERS.md — verification risk rubric

The lead assigns every task a tier in Phase 0. Answer three questions per task.

1. **Oracle** — is there an executable check that decides pass/fail
   objectively (a test, a diff, an axe run, a command with an expected
   output)? Or does judging the result require taste?
2. **Reversible** — if a bad result merges, is it trivially undone before any
   harm (revert a commit on a static page) — or does it touch money, auth,
   data, deploys, or anything published to real users?
3. **Blast radius** — one page/section, or a shared component / config /
   critical path that many things depend on?

## Mapping

| Oracle | Reversible | Blast radius | Tier |
|--------|-----------|--------------|------|
| strong | yes       | small        | 1 |
| weak   | yes       | small        | 2 |
| any    | yes       | shared/large | 2 |
| any    | **no** (payments, auth, deploys, migrations, external publishing) | any | 3 |

**Tie-break: round up.** If a task sits between two tiers, choose the higher.

## Critical paths

The lead also drafts `.swarm/critical.globs` — one glob per line naming files
whose modification forces escalation regardless of the assigned tier
(payment, auth, deploy, and migration paths for this project). Example:

```
src/payments/**
src/auth/**
**/deploy.config.*
db/migrations/**
```

## Phase 0 output

In SPEC.md's task table, add a **Tier** column with a one-line justification
per task (which of the three answers drove it). Draft `critical.globs`. Both
are covered by the existing user sign-off gate — the user approves or
overrides tiers there. Mid-run, tiers may only move **up** (escalation),
never down.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/doc_test.sh`
Expected: all `ok`, `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add TIERS.md smoketest/doc_test.sh
git commit -m "docs: add TIERS.md risk rubric and critical-path guidance"
```

---

### Task 10: Extend `CLAUDE.md` with tier, gate, escalation, and dispute rules

Rewrites the base kit's verification section into the tiered protocol and adds the hard gate rule the whole design hangs on.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `smoketest/doc_test.sh`

**Interfaces:**
- Consumes: `gate.sh` subcommands (Tasks 2–4); `TIERS.md` (Task 9); the evidence-writing agents (Tasks 6–8).
- Produces: orchestration rules stating (a) Phase-0 tier assignment, (b) the hard rule that a task becomes `accepted` only after `gate.sh check` exits 0 and the run completes only after `gate.sh done` exits 0, (c) the escalate-scan loop, (d) dispute-via-judges, (e) the Tier-3 protocol, (f) attempt-numbering on a Tier-3 merge.

- [ ] **Step 1: Write the failing test**

Add to `smoketest/doc_test.sh` before the tally:

```bash
has CLAUDE.md "gate.sh check hard rule"  "gate.sh check"
has CLAUDE.md "gate.sh done hard rule"   "gate.sh done"
has CLAUDE.md "escalate-scan loop"       "escalate-scan"
has CLAUDE.md "judge panel on disputes"  "judge-claude"
has CLAUDE.md "tier 3 protocol"          "tier3-setup"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/doc_test.sh`
Expected: the five new checks `FAIL`.

- [ ] **Step 3: Edit `CLAUDE.md`**

Replace the entire section that begins `## Verification rules — no unchecked work` and ends just before `## Final pass — review your own work too` with:

```markdown
## Verification — tiered and mechanically gated

Every task carries a **tier** (see TIERS.md), assigned in Phase 0 and approved
by the user. Tier decides how it is verified; a mechanical gate decides when it
is accepted. In Phase 0, also create the run directory and ledger:

```bash
mkdir -p .swarm/verdicts .swarm/manifests .swarm/flags .swarm/tier3
# ledger.tsv columns (TAB-separated):
#   task_id  tier  checks  status  attempt  worker  reason
```

Add a `Tier` column to SPEC.md's task table and draft `.swarm/critical.globs`.

### The hard rule (do not bypass)

- A task's status may become `accepted` **only after `swarm/gate.sh check
  <task>` exits 0.** Paste the gate's output into the accepting message.
- The run may be declared complete **only after `swarm/gate.sh done` exits 0.**
- After every verdict lands, run `swarm/gate.sh escalate-scan`. If it writes a
  flag, bump that task's `tier` in the ledger to the flag's `TARGET_TIER`,
  record the reason, and re-verify at the new tier. The gate refuses
  acceptance at the old tier while a flag is unresolved.

You never transcribe a verdict. Workers write manifests; checkers and judges
write verdict files. You read evidence and update ledger status only.

### Tier 1 — one checker
Worker → the mechanical checker(s) named in the ledger `checks` column
(`checker-content` and/or `checker-a11y`) → `gate.sh check` → accept.

### Tier 2 — dual family + judge panel on disputes
Worker builds once. Then two checkers run in parallel from different families:
the relevant mechanical checker (Anthropic) **and** `checker-second` (GLM).
Both must PASS. If they disagree (any FAIL), it is a dispute: dispatch all
three judges — `judge-claude`, `judge-glm`, `judge-local` — each with the task,
the work, the contested verdict + evidence, and the constitution. Majority
OVERRULE accepts; majority UPHOLD sends the task back to the worker. Record the
ruling in SPEC.md "Rulings". The gate enforces the vote count mechanically.

### Tier 3 — blind N-version, then Tier 2
1. Write **executable acceptance checks** as `.swarm/tier3/<task>/accept.sh`
   before dispatch — commands plus expected observations. This is the oracle.
2. `swarm/tier3-setup.sh <task>` creates two isolated worktrees.
3. Dispatch `worker-coder` (GLM) and `worker-local` (Qwen) with the identical
   task block, in parallel, blind to each other, one per worktree.
4. `swarm/tier3-compare.sh <task>` runs `accept.sh` in both and writes
   `.swarm/tier3/<task>/report.md` (per-check matrix + output diffs).
5. Review **only the divergences**, pick a winner or synthesize, append a
   `RESOLUTION:` line to the report, and merge into the main tree.
6. Run the Tier-2 dual-checker verification on the merged result as a **new
   attempt** (increment the ledger `attempt`; verdict files use that attempt
   number). `gate.sh check` requires both the RESOLUTION line and dual-family
   PASS at that attempt.

### Disputes at Tier 1
You adjudicate against the written documents (unchanged). Record an overrule by
writing a verdict file (`VERDICT: OVERRULE`, `CHECKER: boss`, `FAMILY:
anthropic`); an overrule is itself an escalation trigger, so the re-run happens
one tier up.

### Hard stop
Two failed attempts at Tier 3, or three at any tier, halts the task and reports
to the user. Escalation never silently loops.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/doc_test.sh`
Expected: all `ok`, `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md smoketest/doc_test.sh
git commit -m "docs(CLAUDE): tiered verification, hard gate rule, escalation and disputes"
```

---

### Task 11: `tier3-setup.sh` + `tier3-compare.sh`

The two worktree scripts for Tier 3: create the isolated worktrees, and run the boss's oracle in both and emit a divergence report.

**Files:**
- Create: `swarm/tier3-setup.sh`, `swarm/tier3-compare.sh`
- Test: `smoketest/gate/tier3_test.sh`

**Interfaces:**
- Consumes: git worktrees; the oracle `.swarm/tier3/<task>/accept.sh` (executable, prints observations); `$SWARM_DIR`.
- Produces:
  - `tier3-setup.sh <task>` → worktrees `.swarm/tier3/<task>/wt-glm` and `wt-local` on branches `tier3/<task>/glm` and `tier3/<task>/local`.
  - `tier3-compare.sh <task>` → `.swarm/tier3/<task>/report.md` with a per-check PASS/FAIL matrix and output diffs; no `RESOLUTION:` line (the boss appends that).

- [ ] **Step 1: Write the failing test**

Create `smoketest/gate/tier3_test.sh`:

```bash
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/gate/tier3_test.sh`
Expected: FAILs — the scripts do not exist.

- [ ] **Step 3: Write the scripts**

Create `swarm/tier3-setup.sh`:

```bash
#!/usr/bin/env bash
# tier3-setup.sh <task> — create two blind, isolated worktrees for N-version.
set -eu
task="${1:?usage: tier3-setup.sh <task>}"
SWARM_DIR="${SWARM_DIR:-.swarm}"
base="$SWARM_DIR/tier3/$task"; mkdir -p "$base"
head=$(git rev-parse HEAD)
for fam in glm local; do
  wt="$base/wt-$fam"; branch="tier3/$task/$fam"
  git worktree remove --force "$wt" 2>/dev/null || true
  git branch -D "$branch" 2>/dev/null || true
  git worktree add -q -b "$branch" "$wt" "$head"
  echo "worktree: $wt ($branch)"
done
```

Create `swarm/tier3-compare.sh`:

```bash
#!/usr/bin/env bash
# tier3-compare.sh <task> — run the oracle in both worktrees, emit divergence
# report. Does NOT resolve anything; the boss appends the RESOLUTION line.
set -u
task="${1:?usage: tier3-compare.sh <task>}"
SWARM_DIR="${SWARM_DIR:-.swarm}"
base="$SWARM_DIR/tier3/$task"
oracle="$base/accept.sh"; report="$base/report.md"
[[ -x "$oracle" || -f "$oracle" ]] || { echo "no oracle at $oracle" >&2; exit 2; }

run_in() { ( cd "$1" && bash "$oracle" ) 2>&1; }
og=$(run_in "$base/wt-glm");   rg=$?
ol=$(run_in "$base/wt-local"); rl=$?

{
  echo "# Tier 3 divergence report — $task"
  echo
  echo "| worktree | oracle exit |"
  echo "|----------|-------------|"
  echo "| wt-glm   | $rg |"
  echo "| wt-local | $rl |"
  echo
  if [[ "$og" == "$ol" && "$rg" == "$rl" ]]; then
    echo "## No behavioral divergence"
    echo '```'; echo "$og"; echo '```'
  else
    echo "## Divergence"
    echo "### wt-glm output"; echo '```'; echo "$og"; echo '```'
    echo "### wt-local output"; echo '```'; echo "$ol"; echo '```'
    echo "### diff (glm vs local)"
    echo '```diff'; diff <(printf '%s\n' "$og") <(printf '%s\n' "$ol"); echo '```'
  fi
  echo
  echo "<!-- Boss: after adjudicating, append a line starting 'RESOLUTION:' -->"
} > "$report"
echo "report: $report"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/gate/tier3_test.sh`
Expected: all `ok`, `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add swarm/tier3-setup.sh swarm/tier3-compare.sh smoketest/gate/tier3_test.sh
git commit -m "feat(tier3): worktree setup and behavioral divergence report scripts"
```

---

### Task 12: Document the tiers in `README.md`

Adds a tier section to the kit's front-door docs so a new user understands the extension and how to run the gate tests.

**Files:**
- Modify: `README.md`
- Modify: `smoketest/doc_test.sh`

**Interfaces:**
- Produces: a `## Verification tiers` section in `README.md` referencing `TIERS.md`, `gate.sh`, and `smoketest/gate/run_tests.sh`.

- [ ] **Step 1: Write the failing test**

Add to `smoketest/doc_test.sh` before the tally:

```bash
has README.md "documents tiers"          "Verification tiers"
has README.md "points at gate tests"     "run_tests.sh"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/doc_test.sh`
Expected: the two new checks `FAIL`.

- [ ] **Step 3: Edit `README.md`**

Append this section to the end of `README.md`:

```markdown
## Verification tiers

Rigor is chosen per task, not applied uniformly (see `TIERS.md`):

- **Tier 1** — reversible, oracle-checkable work: worker → one mechanical
  checker. Same cost as the base kit.
- **Tier 2** — shared/weak-oracle work: two checkers on different model
  families must both PASS; disputes go to a 3-judge panel (`judge-claude`,
  `judge-glm`, `judge-local`).
- **Tier 3** — irreversible / high blast radius (payments, auth, deploys,
  migrations, publishing): two workers build blind in separate git worktrees;
  `swarm/tier3-compare.sh` reports behavioral divergences; the boss adjudicates
  and the merge still gets Tier 2 checks.

A pure-bash gate enforces it: a task is accepted only when `swarm/gate.sh check
<task>` exits 0, and the run completes only when `swarm/gate.sh done` does.
`swarm/gate.sh escalate-scan` raises a task's tier on evidence (two consecutive
fails, a checker overrule, or a change to a `critical.globs` path). Every agent
writes its own evidence into `.swarm/`, so the boss cannot fabricate a check.

Run the deterministic gate tests (no API keys, no gateway):

```
bash smoketest/gate/run_tests.sh
```
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/doc_test.sh`
Expected: all `ok`, `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add README.md smoketest/doc_test.sh
git commit -m "docs(README): document verification tiers and the gate"
```

---

### Task 13: Checker-eval fixtures (validation layer 2)

Planted-fault artifacts that reproduce the known failure modes, plus clean counterparts and a runbook. Execution needs the live gateway; this task builds and structurally verifies the fixtures and records expected verdicts.

**Files:**
- Create: `smoketest/checker-evals/faults/paraphrased-quote/` (`source.txt`, `page.html`)
- Create: `smoketest/checker-evals/faults/hidden-opacity/page.html`
- Create: `smoketest/checker-evals/faults/dark-mode-invisible/page.html`
- Create: `smoketest/checker-evals/clean/` (clean counterparts of each)
- Create: `smoketest/checker-evals/expected.tsv`, `smoketest/checker-evals/RUNBOOK.md`
- Test: `smoketest/checker-evals/verify_fixtures.sh`

**Interfaces:**
- Consumes: `checker-content`, `checker-a11y` behavior.
- Produces: fixtures + `expected.tsv` (`fixture <TAB> checker <TAB> expected_verdict`) driving the manual eval, and a runbook for running it against the gateway.

- [ ] **Step 1: Write the failing test**

Create `smoketest/checker-evals/verify_fixtures.sh`:

```bash
#!/usr/bin/env bash
set -u
d="$(dirname "$0")"; FAILN=0
f(){ if [[ -e "$d/$1" ]]; then echo "ok   - $1"; else echo "FAIL - $1"; FAILN=$((FAILN+1)); fi; }
f faults/paraphrased-quote/source.txt
f faults/paraphrased-quote/page.html
f faults/hidden-opacity/page.html
f faults/dark-mode-invisible/page.html
f clean/paraphrased-quote/page.html
f clean/hidden-opacity/page.html
f clean/dark-mode-invisible/page.html
f expected.tsv
f RUNBOOK.md
# expected.tsv well-formed: 3 columns, verdict in PASS|FAIL
awk -F'\t' 'NF!=3 || ($3!="PASS" && $3!="FAIL"){bad=1} END{exit bad+0}' "$d/expected.tsv" \
  && echo "ok   - expected.tsv well-formed" || { echo "FAIL - expected.tsv"; FAILN=$((FAILN+1)); }
(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/checker-evals/verify_fixtures.sh`
Expected: all `FAIL` — fixtures not created.

- [ ] **Step 3: Create the fixtures**

`faults/paraphrased-quote/source.txt`:

```
We shipped the redesign in six weeks and conversion rose eleven percent.
```

`faults/paraphrased-quote/page.html` (quote silently reworded — must FAIL content):

```html
<blockquote>We launched the redesign in six weeks and saw conversions climb 11%.</blockquote>
```

`clean/paraphrased-quote/page.html` (character-exact — must PASS):

```html
<blockquote>We shipped the redesign in six weeks and conversion rose eleven percent.</blockquote>
```

`faults/hidden-opacity/page.html` (keyword-stuffed invisible text — must FAIL content and a11y):

```html
<main><h1>Pricing</h1><p>Simple, transparent pricing.</p>
<p style="opacity:0">cheap discount coupon free deal best price cheap</p></main>
```

`clean/hidden-opacity/page.html`:

```html
<main><h1>Pricing</h1><p>Simple, transparent pricing.</p></main>
```

`faults/dark-mode-invisible/page.html` (control invisible in dark theme — must FAIL a11y):

```html
<style>
  button{background:#ffffff;color:#f2f2f2;border:none}
  @media (prefers-color-scheme: dark){body{background:#000}}
</style>
<button>Pre-order</button>
```

`clean/dark-mode-invisible/page.html`:

```html
<style>
  button{background:#1a1a1a;color:#ffffff;border:1px solid #888}
  @media (prefers-color-scheme: dark){button{background:#e8e8e8;color:#111}}
</style>
<button>Pre-order</button>
```

`expected.tsv` (tab-separated):

```
faults/paraphrased-quote	checker-content	FAIL
faults/hidden-opacity	checker-content	FAIL
faults/hidden-opacity	checker-a11y	FAIL
faults/dark-mode-invisible	checker-a11y	FAIL
clean/paraphrased-quote	checker-content	PASS
clean/hidden-opacity	checker-content	PASS
clean/dark-mode-invisible	checker-a11y	PASS
```

`RUNBOOK.md`:

```markdown
# Checker-eval runbook (validation layer 2)

Requires the LiteLLM gateway up and API keys set (see README "Setup").

For each row in `expected.tsv`, dispatch the named checker at the fixture
directory with a minimal task block ("verify this page; source is
source.txt where present") and record the verdict it writes to
`.swarm/verdicts/`. The eval passes when every observed verdict equals the
expected verdict. A planted fault that a checker PASSes is a checker
regression; a clean fixture it FAILs is a false positive.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/checker-evals/verify_fixtures.sh`
Expected: all `ok`, `ALL PASS`. (Live checker execution is manual per `RUNBOOK.md` once the gateway is up.)

- [ ] **Step 5: Commit**

```bash
git add smoketest/checker-evals
git commit -m "test(evals): planted-fault checker fixtures with expected verdicts"
```

---

### Task 14: Live end-to-end fixture (validation layer 3)

The toy 3-page project spanning all tiers, including a Tier-1 task that touches a critical glob to prove escalation fires. Structural now; live run per the runbook once the gateway is up.

**Files:**
- Create: `smoketest/e2e/SPEC.md`, `smoketest/e2e/ACCESSIBILITY.md`, `smoketest/e2e/critical.globs`, `smoketest/e2e/RUNBOOK.md`
- Test: `smoketest/e2e/verify_fixture.sh`

**Interfaces:**
- Consumes: the full kit (tiers, gate, worktrees, escalation).
- Produces: a Phase-0-ready spec whose task table has a `Tier` column covering Tier 1, 2, and 3, plus one Tier-1 task that writes into a `critical.globs` path; a runbook to execute it end-to-end.

- [ ] **Step 1: Write the failing test**

Create `smoketest/e2e/verify_fixture.sh`:

```bash
#!/usr/bin/env bash
set -u
d="$(dirname "$0")"; FAILN=0
f(){ if [[ -e "$d/$1" ]]; then echo "ok   - $1"; else echo "FAIL - $1"; FAILN=$((FAILN+1)); fi; }
g(){ if grep -qi "$2" "$d/$1"; then echo "ok   - $1: $3"; else echo "FAIL - $1: $3"; FAILN=$((FAILN+1)); fi; }
f SPEC.md; f ACCESSIBILITY.md; f critical.globs; f RUNBOOK.md
g SPEC.md 'Tier 1' "has a tier 1 task"
g SPEC.md 'Tier 2' "has a tier 2 task"
g SPEC.md 'Tier 3' "has a tier 3 task"
g SPEC.md 'deploy' "tier1 task touches critical glob"
g critical.globs 'deploy' "glob covers deploy path"
(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash smoketest/e2e/verify_fixture.sh`
Expected: all `FAIL` — fixture not created.

- [ ] **Step 3: Create the fixture**

`smoketest/e2e/SPEC.md`:

```markdown
# Smoketest site — SPEC

A three-page marketing site to exercise every tier end-to-end.

Pages: `index.html`, `about.html`, `preorder.html`; shared `nav.html`;
`deploy.config.json`.

## Tasks

| id | task | tier | why |
|----|------|------|-----|
| t-content | Migrate the About bio verbatim from `sources/bio.txt` into `about.html`. | Tier 1 | strong oracle (diff), reversible, one page. |
| t-nav | Build the shared `nav.html` used by all three pages. | Tier 2 | shared blast radius; weak oracle for cross-page consistency. |
| t-preorder | Build the pre-order button + wire `deploy.config.json` publish flag. | Tier 3 | irreversible (publishing), critical path. |
| t-footer | Add a footer to `index.html` **and** bump the version string in `deploy.config.json`. | Tier 1 | small/oracle-checkable — but it touches a critical glob, so glob-escalation must bump it to Tier 2. |

## Rulings

(none yet)
```

`smoketest/e2e/ACCESSIBILITY.md`:

```markdown
# ACCESSIBILITY.md — smoketest constitution (WCAG 2.2 AA baseline)

1. One `<h1>` per page; no skipped heading levels.
2. All interactive controls keyboard-reachable with a visible focus indicator.
3. Text contrast ≥ 4.5:1 in every theme the page ships (light and dark).
4. No content hidden from or injected only for assistive tech.
5. `nav`, `main`, `footer` landmarks present on every page.
```

`smoketest/e2e/critical.globs`:

```
**/deploy.config.*
```

`smoketest/e2e/RUNBOOK.md`:

```markdown
# End-to-end runbook (validation layer 3)

Requires the gateway up and API keys set. From a copy of this directory as the
project root, launch the lead through the gateway (README "Setup") and prompt:

> Read CLAUDE.md and TIERS.md. Phase 0: draft SPEC.md tiers (already tabled
> here), ACCESSIBILITY.md, and .swarm/critical.globs, show me for sign-off,
> then run the build rounds.

Confirm, in order:
1. Phase 0 produces a ledger with a Tier column and the four tasks.
2. `t-content` accepts at Tier 1 (one checker PASS).
3. `t-nav` runs two different-family checkers; both PASS before accept.
4. `t-footer` (Tier 1) touches `deploy.config.json`; `gate.sh escalate-scan`
   writes a flag and the task re-verifies at Tier 2. **This is the key
   assertion — glob escalation fired.**
5. `t-preorder` creates two worktrees, produces a divergence report, gets a
   RESOLUTION line, and the merge passes Tier 2 checks.
6. `swarm/gate.sh done` exits 0 only after all four are accepted.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash smoketest/e2e/verify_fixture.sh`
Expected: all `ok`, `ALL PASS`.

- [ ] **Step 5: Final commit**

```bash
git add smoketest/e2e
git commit -m "test(e2e): live end-to-end fixture spanning all tiers with glob-escalation"
```

- [ ] **Step 6: Run the whole deterministic suite**

```bash
bash smoketest/verify_layout.sh \
 && bash smoketest/gate/run_tests.sh \
 && bash smoketest/gate/agents_test.sh \
 && bash smoketest/gate/tier3_test.sh \
 && bash smoketest/doc_test.sh \
 && bash smoketest/checker-evals/verify_fixtures.sh \
 && bash smoketest/e2e/verify_fixture.sh \
 && echo "SMOKETEST GREEN"
```
Expected: `SMOKETEST GREEN`.

---

## Self-review

**Spec coverage** — every spec section maps to a task:

- Three tiers + protocols → Tasks 6–11, documented in Task 10 (CLAUDE.md) and 9 (TIERS.md).
- Boss-proposes / user-approves tier assignment → Task 9 + Task 10 Phase-0 rules.
- Three mechanical escalation triggers → Task 3 (`escalate-scan`).
- Dual-family checkers + 3-judge panel → Tasks 7–8, enforced in Task 2 (`check_tier2`).
- Blind N-version + behavioral divergence review → Task 11 + Task 10 protocol.
- `gate.sh` enforcement core + "every agent writes its own evidence" → Tasks 2–4, 6–8.
- `checks` column drives Tier-1 checkers mechanically → ledger format + `check_tier1` (Task 2).
- Tier-3 `RESOLUTION:` line detection → `check_tier3` (Task 2), written by Task 11.
- Ledger validated every invocation → `validate_ledger` (Task 2).
- Three-layer smoke test → layer 1 Tasks 2–4, layer 2 Task 13, layer 3 Task 14.
- Kit layout (litellm `checker-glm` alias, agents, `swarm/` scripts) → Tasks 1, 7, 11.
- Out-of-scope items (sampled audits, boss pre-review, de-escalation) → not implemented, correctly.
- Resolved the three open forks flagged in review: Tier-2 dispute detected by "any FAIL among the attempt's verdicts" (Task 2 `check_tier2`); Tier-3 merge uses a new incremented attempt (Task 10 step 6, enforced by `check_tier3`→`check_tier2`); `OVERRULE` written as a boss verdict file and read by `overrule_exists` (Tasks 3, 10).

**Placeholder scan** — no TBD/TODO; every code and doc step contains complete content; tests carry real assertions.

**Type/name consistency** — `SWARM_DIR`, ledger 7-column order, verdict filename `<task>.<attempt>.<agent>.verdict`, manifest `<task>.<attempt>.files`, flag `TARGET_TIER`/`REASON`, functions `check_tier1/2/3`, `has_fail_at`, `manifest_hits_glob`, `overrule_exists` are used identically across tasks. Family strings are exactly `anthropic|glm|local` everywhere.
