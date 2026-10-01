#!/usr/bin/env bash
set -u
root="$(cd "$(dirname "$0")/.." && pwd)"; FAILN=0
has() { if grep -qi "$3" "$root/$1"; then echo "ok   - $1: $2"; else echo "FAIL - $1: $2"; FAILN=$((FAILN+1)); fi; }

has TIERS.md "oracle question"      "oracle"
has TIERS.md "reversible question"  "reversible"
has TIERS.md "blast radius question" "blast radius"
has TIERS.md "round-up tie-break"   "round up"
has TIERS.md "critical.globs"       "critical.globs"
has TIERS.md "test-code exemption glob" "test.globs"
has TIERS.md "lean checks-column guidance" "checks column at tier 2"

has CLAUDE.md "gate.sh check hard rule"  "gate.sh check"
has CLAUDE.md "gate.sh done hard rule"   "gate.sh done"
has CLAUDE.md "escalate-scan loop"       "escalate-scan"
has CLAUDE.md "judge panel on disputes"  "judge-claude"
has CLAUDE.md "tier 3 oracle contract"   "accept.sh"
has CLAUDE.md "tier 3 oracle pass marker" "ORACLE PASS"
has CLAUDE.md "points at the smoketest suite" "smoketest/gate/run_tests.sh"
has CLAUDE.md "lean experiment stats hook" "gate.sh stats"
has CLAUDE.md "lean dispute default"       "CONCEDE"
has CLAUDE.md "fingerprint contract"        "MANIFEST_SHA256"
has CLAUDE.md "inline escalation triggers"  "recompute the triggers inline"
has CLAUDE.md "tier 3 named checkers"       "PASS from EVERY"
has CLAUDE.md "phase 0 scales with scope"   "only when a task can touch markup"
has TIERS.md  "blank checks fails at every tier" "hard-fails at every tier"
has CLAUDE.md "surface census before dispatch" "surface-census"
has CLAUDE.md "census kept from checkers"  "Never hand the census report to checkers"
hasnot() { if grep -qi "$3" "$root/$1"; then echo "FAIL - $1: $2"; FAILN=$((FAILN+1)); else echo "ok   - $1: $2"; fi; }
hasnot CLAUDE.md "no blank-column-accepts footgun text" "accept the row with zero verdicts"
hasnot CLAUDE.md "no legacy report.md bypass text"      "flips the gate"
hasnot README.md "no legacy divergence-report text"     "legacy divergence-report"

# --- CD4: the Codex lane (run CD). Wrap-tolerant: the docs wrap mid-phrase, so
# these read a whitespace-normalised copy (hasw / hasnotw take an ERE).
norm() { tr '\n\t' '  ' < "$root/$1" | tr -s ' '; }
hasw()    { if norm "$1" | grep -qiE -- "$3"; then echo "ok   - $1: $2"; else echo "FAIL - $1: $2"; FAILN=$((FAILN+1)); fi; }
hasnotw() { if norm "$1" | grep -qiE -- "$3"; then echo "FAIL - $1: $2"; FAILN=$((FAILN+1)); else echo "ok   - $1: $2"; fi; }
hasw CLAUDE.md "codex is named beside second"            'name .codex. beside .second.'
hasw CLAUDE.md "codex trial rule: a FAIL counts, a PASS never does" 'a Codex FAIL counts, a Codex PASS never does'
hasw CLAUDE.md "codex-check.sh run by the lead with the criteria file" 'swarm/codex-check\.sh <t> <a>.*\.swarm/codex/<t>\.<a>\.criteria\.md|\.swarm/codex/<t>\.<a>\.criteria\.md.*swarm/codex-check\.sh <t> <a>'
hasw CLAUDE.md "codex never receives the census"         'never the census'
hasw CLAUDE.md "the lead never writes a Codex verdict or skip record" 'never writes a Codex verdict or skip record'
hasw CLAUDE.md "codex evidence: one outcome at the current attempt" 'missing checker-codex evidence \(attempt N\)'
hasw CLAUDE.md "codex is never a named checker at Tier 2/3" 'PASS from EVERY named checker \(.codex. is never one\)'
hasw CLAUDE.md "a codex-only checks column is refused like a blank one" 'only .codex. is refused exactly like a blank one'
hasw CLAUDE.md "crossvendor is a valid FAMILY" 'Valid .FAMILY. values are .anthropic., .adversarial., .impact. and .crossvendor.'
hasw CLAUDE.md "codex joins the attribution mechanisms"   'second checker / codex / judge / gate'
hasw CLAUDE.md "the codex: stats line is reported verbatim" 'report the .codex:. line verbatim'
hasw CLAUDE.md "phase 0 writes codex.exclude"             'every run writes it, even an empty one'
hasw CLAUDE.md "budget2 excludes PLANNING_LOG.md"         'budget2 runs list .PLANNING_LOG\.md.'
hasw CLAUDE.md "agents2 excludes docs/runs/ and *.png"    'agents2 runs list .docs/runs/. and .\*\.png.'
has  CLAUDE.md "phase 0 mkdir creates .swarm/codex"       '^mkdir -p .*\.swarm/codex$'
hasw CLAUDE.md "codex evidence is never archived verbatim" 'Never archive .\.swarm/codex/\*\*. to .docs/runs/. verbatim'
hasw CLAUDE.md "re-run codex-check.sh when it cannot record" 'exit 1, or a killed run\), re-run it'
hasw CLAUDE.md "unreadable globs fail closed"             'critical-glob-unreadable'
hasnotw CLAUDE.md "no unqualified all-on-Claude claim"    'all (lanes|agents|roles)( run)? on Claude'
hasnotw CLAUDE.md "the Tier-1 qualifier does not cover the dispute path, escalation and stats alike" 'at Tier 1 only when named\), it opens the dispute path'
hasw CLAUDE.md "an unnamed Tier-1 Codex FAIL still counts toward two consecutive fails and in stats" 'at Tier 1 only a named one blocks acceptance.*counts toward two consecutive fails and in .stats.*unnamed Tier-1 Codex FAIL is ignored by acceptance only'
hasnotw TIERS.md "no blanket 'at Tier 1 when named' on a Codex FAIL" 'at Tier 1 when named'
hasw TIERS.md "an unnamed Tier-1 Codex FAIL still counts toward two consecutive fails and in stats" 'only a named one blocks acceptance, but at every tier it counts toward two consecutive fails and in .stats.'
hasw TIERS.md "codex lane and trial rule"                 'Codex FAIL counts.*Codex PASS never does'
hasw TIERS.md "codex is never a named checker"            'PASS from every one named \(.codex. is never one'
hasw TIERS.md "unreadable critical globs fail closed"     'fails CLOSED.*critical-glob-unreadable'
hasnotw README.md "no second-vendor denial"               'no second vendor|not a second vendor'
hasw README.md "readme names the codex trial lane"        'Codex lane \(a trial, run CD\)'
hasw README.md "readme: codex login is the exception to claude auth" 'authenticates the same way your .claude. CLI normally does\. The Codex check is the exception'
hasnotw README.md "no unqualified all-on-Claude claim"    'all (lanes|agents|roles)( run)? on Claude'
hasnotw README.md "dashboard escalation triggers are mirrored" 'not mirrored.{0,200}escalation trigger'

has README.md "documents tiers"          "Verification tiers"
has README.md "points at gate tests"     "run_tests.sh"
has README.md "documents the census"     "surface-census"

(( FAILN==0 )) && { echo "ALL PASS"; exit 0; } || { echo "$FAILN FAILED"; exit 1; }
