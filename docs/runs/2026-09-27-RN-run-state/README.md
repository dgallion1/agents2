# Run RN — correct the phaseBasisRecords comment (2026-09-27)

Target: simpleBudget branch `fix/rn-comment`, commit 93050fc over master
e58598c. One task, Tier 1 with `tests`, lead-authored. PR #125 MERGED
3f9cbec + DEPLOYED :8080 2026-09-27 (health v1.4.0-1184-g3f9cbec; old
binary budget2.old-1322). Release built in `.worktrees/release-RN`
(vcs.modified=false), then removed; branch deleted locally and on origin.

Source: run RB backlog F2. The comment above `phaseBasisRecords()` said the
map is made lazily because "this file can be re-executed when its component
is swapped"; the script loads once per page from `pages/whatif.html`,
outside the swapped card. Comment-only fix.

## Outcome (gate.sh, verbatim)

```
OK: RN1 accepted at tier 1 (attempt 1)
OK: all tasks accepted, evidence verified, no unresolved flags
stats: RN1 tier=1 first-attempt=1 clean (now: status=accepted attempt=1)
first-attempt clean: 1/1 (no-evidence rows: 0)
```

## Evidence, by mechanism

- **Primary checker:** comment-stripped token streams identical to e58598c
  under acorn (2734 tokens) and esprima (2709), with a mutant proving the
  comparison detects code changes; the new sentence holds against the
  templates; node tests 84/84; `make check` green.
- **Final a11y pass:** the same token identity proves no runtime change, so
  the RB full-site sweep of e58598c stands; no servers started.

## Record correction (ruling 2026-09-27f)

The RB README listed "`/explorer` has no `<footer>` landmark
(ACCESSIBILITY.md point 1)" as backlog, copied from the RB sweep. It is not
a defect: point 1 requires `<main>`, `<nav>`, `<header>` only; WCAG 2.2 AA
requires no contentinfo landmark; the footer is hidden on explorer by
design (viewport-height `<main>`), as runs BL/BK/RF had recorded. The RB
README line is corrected in place; both sweep reports (RB, and this run's
`final-a11y-sweep.md`) keep the checkers' wording verbatim as evidence.
User decision: dropped.

Lesson: before copying a checker's "point N" attribution into a record,
read point N.
