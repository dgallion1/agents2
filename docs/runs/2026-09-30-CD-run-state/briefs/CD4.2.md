# CD4 attempt 2 — fix the attempt-1 findings (Tier 3, LAST attempt before a hard stop)

This AMENDS `.swarm/briefs/CD4.1.md`; everything there still holds. SPEC.md
ruling CD-w lists the findings. Attempt 1 held everywhere else under heavy
attack (both lanes: oracle PASS, 543 smoketests, 119 dashboard tests, ~1,000
fuzzed scenarios with 0 mismatches outside the items below). Fix exactly these
items; change nothing else in behaviour.

## 1. Skip-record headers are parsed identically under every locale (rule 3/8)
Pinned rule, for the gate AND `parse.mjs`: a header's value is the text after
`KEY:` on the FIRST line starting with `KEY:`, with LEADING ASCII whitespace
(space, `\t`, `\n`, `\v`, `\f`, `\r`) removed — and nothing else removed:
no trailing whitespace, and never a non-ASCII character (U+00A0, U+2003,
U+3000 … stay in the value). The gate's answer must not depend on the
caller's locale: today `skip_field` runs `grep` under `LC_ALL=C` but its
`sed [[:space:]]` in the caller's locale, which under UTF-8 strips U+2003 etc.
Consequences under the pinned rule: `DETAIL:<U+2003>` is a non-empty DETAIL
(valid); `REASON:<U+2003>quota` and `TASK:<U+2003><t>` do not match (invalid).
The gate, under `LC_ALL=C`, `C.UTF-8` and `en_US.UTF-8`, and the dashboard
must agree on every skip record.

## 2. A non-regular or unreadable verdict entry is an INVALID verdict, on both sides
(a) Gate, tier 1: when `codex` is named, ANY directory entry named
`<t>.<a>.checker-codex.verdict` that is not a valid verdict — a dangling
symlink, a symlink loop, a directory, a FIFO, a mode-000 file — refuses the
row with `invalid verdict checker-codex` (the gate's existing wording), as
tiers 2/3 already do. Never open a FIFO. A valid skip record beside it does
not rescue the row. Unnamed at tier 1: still ignored (rule 6).
(b) Dashboard (census CD4.2 — the draft wrongly said it already behaved):
today `parseAllVerdicts` opens EVERY `*.verdict` entry with
`fs.readFileSync` and swallows only ENOENT, so a directory, a symlink loop
or a mode-000 entry makes `parse()` THROW, and a FIFO makes it HANG — for
any task, any checker. `parse()` must never open a non-regular `*.verdict`
entry and never throw or hang on one: such an entry, or one it cannot read,
is an invalid verdict file (reported in `errors`, excluded from quorum,
blocking at tiers 2/3 exactly as the gate's `walk_verdicts` does; at tier 1
it is never a PASS). This is the module's own contract ("must never throw
on malformed input") and rule 8's.

## 3. The CLAUDE.md sentence (criterion f)
The first bullet of "The Codex lane — trial" (CLAUDE.md ~277-280) puts "(at
Tier 1 only when named)" over the dispute path, two-consecutive-fails AND
stats. The code (brief rule 5, and any unnamed checker FAIL) counts an
unnamed Tier-1 Codex FAIL toward two consecutive fails and in `stats`; only
acceptance ignores it. Correct the sentence to say exactly that — that an
unnamed Tier-1 Codex FAIL still counts toward two consecutive fails and in
`stats` — and fix the same imprecision in TIERS.md (~49-51, "at Tier 1 when
named") and the `parse.mjs` comment (~1122-1123). Add a `doc_test.sh` pin.

## 4. Shipped tests that kill the attempt-1 mutation survivors
Add tests (names mention codex) so that EACH of these mutations, applied
alone, makes the shipped suites fail:
- M-a: `gate.sh stats` counts (row, attempt) pairs from attempt 1 instead of
  attempt 0 (needs a Codex outcome at attempt 0).
- M-b: `parse.mjs` drops its NUL-byte check (needs a NUL outside REASON, e.g.
  inside DETAIL, and on a line that is no header at all).
- M-c: `gate.sh stats` treats an INVALID `checker-second` verdict beside a
  Codex outcome as valid.
- M-d: tier 1, `codex` named, an INVALID Codex verdict plus a valid skip
  record is accepted (gate or dashboard).
- M-e: `skip_field`'s `sed` runs in the caller's locale (as it does in
  attempt 1). The test must SET a UTF-8 locale itself for its gate call
  (`LC_ALL=C.UTF-8`, falling back to `en_US.UTF-8`), with a U+2003 fixture
  built from ASCII bytes (`printf '\xe2\x80\x83'`), so the mutant dies on any
  host with a UTF-8 locale, not only under a UTF-8 caller.
- M-f: `parseAllVerdicts` opens a non-regular `*.verdict` entry again (a
  directory entry must make a test fail, not throw the suite).
Pin the worker's attempt-1 addition while at it: a NUL byte ANYWHERE in a
skip record makes it invalid (gate and dashboard).

## Out of scope (backlog, do not touch)
VERDICT-header parsing differences are pre-existing (SPEC ruling CD-h
class, present in the pre-CD4 gate for every checker): the gate's
`field_of` uses the caller's locale and first-match, the dashboard's
`parseHeaderAndEvidence` a Unicode `.trim()` and last-match, so e.g.
`FAMILY:<U+2003>crossvendor` or `FAMILY: x ` can split. Do not change
`field_of` or `parseHeaderAndEvidence`. Also out: the trailing-comma
checks-column split (pre-existing); `swarm/codex-check.sh` and
`swarm/start.sh` (outside the territory).

## Acceptance
(a) `.swarm/tier3/CD4/accept.sh` ends `ORACLE PASS` — its differential now
    runs the gate under `C`, `C.UTF-8` and `en_US.UTF-8`, runs `parse()` in
    a child process with a timeout (a hang or a throw is a failure), and adds
    the scenarios for items 1–2 and the NUL rule; the stats fixture adds an
    attempt-0 Codex outcome, an invalid `checker-second` and a U+2003 skip;
    F25/F26 check item 3's sentence.
(b)–(h) as in CD4.1, plus item 4's mutations each killed by the shipped
    suites.

## Evidence
`.swarm/manifests/CD4.2.files` and `.swarm/manifests/CD4.2.sha256` (every
territory file you changed in attempts 1–2, written after your last edit).
