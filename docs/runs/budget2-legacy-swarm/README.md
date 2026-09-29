# budget2 legacy swarm evidence

Run evidence that was committed inside the target repo (`dgallion1/simpleBudget`)
before run records moved to `docs/runs/<date>-<prefix>-run-state/` here.
Moved 2026-09-29 from simpleBudget master `3f9cbec`:

- `swarm/` ← `.swarm/` (ledger, verdicts, manifests, per-run specs, briefs,
  tier-3 oracles; last touched 2026-09-11)
- `swarm-go/` ← `.swarm-go/` (run GO; last touched 2026-09-08)

The dot-prefixes were dropped so the tree is not hidden and does not collide
with this repo's gitignored `.swarm/`. File contents are byte-identical.
Paths quoted INSIDE the files (verdicts, manifests) still read `.swarm/...` —
they describe where the files lived when written.

**Text only.** Screenshots (`*.png`), HTML page snapshots (`*.html`) and JSON
over 50 KB (axe dumps) — 476 files, 140 MB — were left out. `EXCLUDED.tsv`
lists each one; recover any with:

```bash
git -C ~/bin/ai/budget2 show 3f9cbec:<path> > <file>
```

These verdicts predate the current schema in places, so `gate.sh stats` may
read them as no-evidence. This is an archive, not a ledger — never point a
live run at it.
