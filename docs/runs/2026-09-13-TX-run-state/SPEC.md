# SPEC.md — Federal tax tables: add the tax-year-2026 statutory record (TX run)

Run prefix: **TX**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **ff4ff34** (master,
2026-09-13, PR #111). Implementation worktree
`.worktrees/tax-tables-2026` on branch `feat/tax-tables-2026`.
All manifest paths and globs are budget2-repo-relative. This run's
`.swarm/` lives in THIS agents2 worktree (gitignored).

## 0. Status — signed off by user 2026-09-13 ("go")

Origin: user asked whether budget2 handles a "fill the 22% bracket to the
penny" Roth-conversion strategy. It does (bracket-fill optimizer,
§86 torpedo, IRMAA lookback, taxable-first tax funding), but the bundled
federal tables are tax-year 2024 (Rev. Proc. 2023-34) inflated by the
plan's rate, so the 2026 ceiling and standard deduction miss the IRS
figures. The user asked: "Update the tax tables to 2026."

Explicitly OUT of scope (user accepted the recommendation):
- a tax-year-2025 record (plan starts 2026-09; nothing resolves 2025);
- the OBBBA §70103 senior deduction ($6,000 per filer 65+, 2025–2028,
  MAGI phase-out) — new engine logic, not a table update.

## 1. Facts the design rests on (verified in code, 2026-09-13)

- `internal/services/retirement/engine/taxyears.go` is a versioned
  registry: `federalTaxYears []TaxYearRecord`, ascending by (year, month).
  `ResolveTaxYear(calendarYear, month)` returns the statutory record when
  one exists for that year, otherwise the LATEST statutory record scaled by
  `InflationFactor(calendarYear − latest.Year)` and labelled
  `BasisProjected`. Its own doc comment says: "Later statutory years are a
  data entry, not a code change — append a record with its own Provenance
  and every consumer picks it up."
- Every engine consumer (`GetAdjustedBrackets`, `GetAdjustedLTCGBrackets`,
  `GetAdjustedStandardDeduction`) resolves through the registry via
  `resolveForYearsFromBase(yearsFromBase)` → `ResolveTaxYear(taxBaseYear +
  yearsFromBase, 1)`. `taxBaseYear = 2024` is the OFFSET origin, not the
  figure source. It stays 2024: `YearsFromTaxBase`, the IRMAA rescale
  (`irmaaBaseYear = 2026`, rescaled onto 2024 offsets), and many tests key
  on it.
- **Split source found (defect class 1, ruling 2026-08-29a):**
  `internal/services/retirement/analysis/tax_optimizer_strategies.go`
  `bracketTopFor` hardcodes 2024 bracket tops (Single 47,150 / 100,525 /
  191,950; MFJ 94,300 / 201,050 / 383,900; plus HoH/MFS) and
  `inflatedBracketTopForYear` inflates them by
  `InflationFactor(YearsFromTaxBase)`. With a 2026 statutory record the
  engine's 2026 MFJ 22% ceiling is 211,400 while the optimizer would size
  to 201,050 × (1.039)² ≈ 217,000 — overshooting into 24%. Both surfaces
  must read ONE source. (Note `bracketFillIncomeForYear` already calls the
  registry for the standard deduction — the ceiling was the only stray.)
- `analysis/tax.go constantsBasis` surfaces `LatestStatutoryFederalProvenance()`
  (year, source, verified-on) plus first/last projected year to the UI; it
  needs no change and is a consumer whose output the checkers must observe.
- Social Security §86 thresholds (25k/34k, 32k/44k) and NIIT thresholds are
  unindexed by statute — unchanged. IRMAA already carries CMS 2026 tiers.
- Existing test `TestResolveTaxYear_ProjectsFromTheLatestStatutoryYear`
  (engine/taxyears_test.go ~L165) appends a synthetic record at
  `taxBaseYear+2` = 2026 and asserts `LatestStatutoryFederalTaxYear() ==
  taxBaseYear+2`. A real 2026 record collides with it (two 2026 month-1
  records; `statutoryRecordFor` returns whichever it meets first). The
  test must be rewritten relative to `LatestStatutoryFederalTaxYear()`.
- Repo gotchas: worktree `data/` symlinks LIVE data — never run the binary
  ([[budget2-binary-no-flags]]). `cmd/server` tests rewrite tracked
  `testdata/settings/whatif.json`; restore with
  `git checkout -- testdata/settings/whatif.json` after a full run.

## 2. Verified figures — tax year 2026

Source: **IRS Rev. Proc. 2025-32** (fetched 2026-09-13 from
irs.gov/pub/irs-drop/rp-25-32.pdf, text extracted with pdftotext; §4.01
Tables 1–4, §4.03, §4.14). VerifiedOn = `2026-09-13`. These are the exact
numbers the record must carry; a checker verifies them against the same
source, not against this file.

Ordinary brackets (taxable income; upper edge of each rate):

| Rate | MFJ | Single | HoH | MFS |
|---|---|---|---|---|
| 10% | 24,800 | 12,400 | 17,700 | 12,400 |
| 12% | 100,800 | 50,400 | 67,450 | 50,400 |
| 22% | 211,400 | 105,700 | 105,700 | 105,700 |
| 24% | 403,550 | 201,775 | 201,750 | 201,775 |
| 32% | 512,450 | 256,225 | 256,200 | 256,225 |
| 35% | 768,700 | 640,600 | 640,600 | 384,350 |
| 37% | ∞ | ∞ | ∞ | ∞ |

Long-term capital gains (§4.03; 0% ceiling = "maximum zero rate amount",
15% ceiling = "maximum 15% rate amount", 20% above):

| Status | 0% up to | 15% up to |
|---|---|---|
| MFJ | 98,900 | 613,700 |
| Single | 49,450 | 545,500 |
| MFS | 49,450 | 306,850 |
| HoH | 66,200 | 579,600 |

Standard deduction (§4.14(1)): MFJ 32,200; HoH 24,150; Single 16,100;
MFS 16,100. Aged/blind additional (§4.14(3), §63(f)): **1,650** per
qualifying person; **2,050** if also unmarried and not a surviving spouse.
Mapping to the existing `AdditionalDeductionAge65` map (same shape as the
2024 map): Single 2,050; HoH 2,050; MFJ 1,650; MFS 1,650.

## 3. Task table

| Task | Tier | Checks | Summary |
|---|---|---|---|
| TX1 | 2 | tests, second | Append the 2026 statutory record; make the optimizer read bracket tops from the registry; tests |

Tier 2 + `second` because a wrong bracket edge or deduction is a money
figure on screen (bracket-fill conversion sizes, tax summary, the
"figures rest on tax year N" note) — a defect-history surface.

## 4. TX1 — contract

### 4.1 Changes
1. `internal/services/retirement/engine/tax.go`: add package-level
   `TaxBrackets2026`, `LongTermCapitalGainsBrackets2026`,
   `StandardDeduction2026`, `AdditionalStandardDeduction2026Age65` with the
   §2 figures, same types/shapes as the 2024 vars, each with a comment
   citing Rev. Proc. 2025-32 and the section. Do NOT touch the 2024 vars,
   `taxBaseYear`, SS/NIIT thresholds, or IRMAA.
2. `internal/services/retirement/engine/taxyears.go`: append a
   `TaxYearRecord{Jurisdiction: JurisdictionUS, Year: 2026,
   EffectiveFromMonth: 1, Provenance: {Source: "IRS Rev. Proc. 2025-32
   (tax year 2026); §4.01 rate tables, §4.03 capital gains, §4.14 standard
   deduction and §63(f) aged addition", VerifiedOn: "2026-09-13"}, ...}`
   to `federalTaxYears` AFTER the 2024 record (ascending order is a stated
   invariant). Rewrite the "Only 2024 is seeded" doc comment truthfully.
3. `internal/services/retirement/analysis/tax_optimizer_strategies.go`:
   replace `bracketTopFor`'s literal table + `inflatedBracketTopForYear`'s
   manual inflation with a lookup through
   `engine.NewTaxCalculator(s.TaxConfig, s.InflationRate)
   .GetAdjustedBrackets(engine.YearsFromTaxBase(s, projectionYear))`:
   find the bracket whose `Rate` equals `target` (compare with a small
   epsilon or exact float equality on the 0.12/0.22/0.24 literals — pick
   one and say which) and return its `MaxIncome`. `ok=false` when no
   bracket has that rate or `MaxIncome` is unbounded. Keep the function
   names/signatures used by callers; update the stale comments ("Values are
   2024 IRS thresholds"). `taxOptimizerBracketFillTargets` stays
   {0.12, 0.22, 0.24}.
4. Tests (Go, `go test`, no new fixtures on disk):
   - engine: `ResolveTaxYear(2026, 1)` is `BasisStatutory`,
     `DerivedFromYear == 2026`, `InflationFactor == 1`, and the record's
     MFJ 22% `MaxIncome == 211400`, MFJ standard deduction `== 32200`,
     MFJ age-65 addition `== 1650`, Single age-65 addition `== 2050`, MFJ
     LTCG 0% ceiling `== 98900`. `ResolveTaxYear(2027, 1)` is
     `BasisProjected`, `DerivedFromYear == 2026`, and its MFJ 22% top
     equals `211400 × (1 + rate/100)` for a non-zero rate.
     `ResolveTaxYear(2025, 1)` must still return a non-error result (the
     registry's documented gap behaviour) — assert only that it does not
     error and that its `Basis` is `BasisProjected`.
   - engine: `LatestStatutoryFederalTaxYear() == 2026`;
     `EarliestFederalTaxYear() == 2024`.
   - engine: fix `TestResolveTaxYear_ProjectsFromTheLatestStatutoryYear` so
     the synthetic record is `LatestStatutoryFederalTaxYear()+2` (or
     equivalent) and the assertions are relative, not `taxBaseYear+2`.
   - analysis: for a MFJ settings fixture with `StartDate` "2026-01" and
     inflation 3.9, `inflatedBracketTopForYear(s, 0.22, 0)` returns
     `211400` exactly, and for projection year 1 returns the SAME value
     `engine.NewTaxCalculator(...).GetAdjustedBrackets(YearsFromTaxBase(s,1))`
     reports for the 0.22 bracket. Also a Single-filer case for 0.12
     (`50400` at 2026). And one `ok=false` case for target 0.32... only if
     0.32 is absent from the resolved table — it is PRESENT in the real
     tables, so instead assert `ok=false` for a rate not in the table
     (e.g. 0.99).
   - The full `go test ./...` in the worktree must pass (restore
     `testdata/settings/whatif.json` afterwards if `cmd/server` dirtied it).

### 4.2 Acceptance criteria (checkers cite the command for each)
- AC1 `go build ./... && go vet ./...` clean in the worktree.
- AC2 `go test ./internal/services/retirement/... ./internal/handlers/...
  ./internal/models/... ./cmd/...` passes; `git status --short` shows only
  intended files (testdata restored).
- AC3 The 2026 record's figures match Rev. Proc. 2025-32 §4.01/§4.03/§4.14
  EXACTLY (checker re-derives from the PDF text at
  `irs.gov/pub/irs-drop/rp-25-32.pdf`, not from this SPEC): every bracket
  edge for all four statuses, all eight LTCG ceilings, four standard
  deductions, the two aged amounts mapped as in §2.
- AC4 The 2024 record is byte-identical to master (`git diff ff4ff34 --
  internal/services/retirement/engine/tax.go` shows only additions of
  2026 vars/comments; no edit inside the 2024 literals).
- AC5 `federalTaxYears` remains ascending by (year, month) and
  `LatestStatutoryFederalTaxYear() == 2026`; provenance strings and
  VerifiedOn `2026-09-13` present.
- AC6 **Single source:** `grep -n "201_050\|201050\|100_525\|94_300\|47_150\|191_950\|383_900" internal/services/retirement/analysis/*.go`
  returns nothing outside `_test.go`; `inflatedBracketTopForYear` derives
  the ceiling from `GetAdjustedBrackets`. For a MFJ plan starting 2026 the
  optimizer's 0.22 ceiling for projection year 0 is 211,400 and for year
  1 equals the engine's inflated 0.22 `MaxIncome` (checker proves it with a
  throwaway `go test -run` probe or the shipped test).
- AC7 Consumer surfaces observed, not assumed: a `go test` (existing or a
  probe) that runs `analysis.BuildTax`/`constantsBasis` on a 2026-start
  plan reports `StatutoryYear == 2026`, `FirstProjectedYear == 2027`, and
  the Source names Rev. Proc. 2025-32. The `/whatif` tax-summary render
  test suite (`internal/handlers/whatif/tax_summary_render_test.go`) still
  passes.
- AC8 Behaviour preservation off the changed surface: `ResolveTaxYear(2024,
  1)` unchanged; a 2024-start fixture in the existing engine tests still
  passes (the projected-year cache key includes `baseYear`, so 2025
  projections now derive from 2026 — expected and documented in the
  taxyears.go comment).
- AC9 Manifest at `.swarm/manifests/TX1.1.manifest` listing every changed
  file (budget2-relative), commands run, and their final lines.

### 4.3 Not acceptable
- Moving `taxBaseYear` off 2024.
- Any change to IRMAA, §86, NIIT constants, or to the 2024 literals.
- A 2025 record, a senior-deduction field, or any new user-facing setting.
- Sizing constants copied into a second table anywhere.

## 5. Rulings
(Recorded as they happen, with the mechanism that caught each.)

## 6. Landing
Commit on `feat/tax-tables-2026` → push → PR → merge → deploy per the
systemd recipe in memory [[budget2-open-items]] → `gate.sh done` →
`gate.sh stats` reported verbatim → run record to
`docs/runs/2026-09-13-TX-run-state/`.

- **2026-09-13 TX1 attempt 1 — caught by PRIMARY CHECKER (checker-tests).**
  AC9: manifest `TX1.1.manifest` listed all 14 files (set-identical to
  `git status`) but recorded no verification commands. AC1–AC8 PASS with
  cited commands; six fixture recalibrations all traced to the 2026 record
  (two by reverting only the registry record in a scratch copy). Lead
  ruling: CONCEDE — documentary defect, in scope, real. Attempt 2 = same
  code plus a complete manifest (and any checker-second findings).
  Mutation-kill evidence worth keeping: with the old private table, the
  MFJ 22% ceiling for a 2026-start plan read 213,293.94 vs the engine's
  211,400 (≈$1,894 of overstated conversion room).
  Backlog observations from the checker: (1) `failure_bounds_test.go`
  now probes one rounding step past the threshold and
  `calculator_expense_test.go` widened its band to (0.1, 7.5) — traced but
  looser than master; (2) the `-2.1` render golden is traced only via the
  fixture-input change; (3) no shipped test asserts the `federalTaxYears`
  ascending invariant (V3 promotion candidate).
  Tooling: `rtk proxy git diff` dropped an entire hunk on a second run —
  compare trees with sha256sum, not rtk-filtered diffs.
- **2026-09-13 TX1 attempt 1 — caught by SECOND CHECKER (checker-second,
  adversarial).** `TestInflatedBracketTopForYear_GrowsWithCalendarYear`
  computes its expected year-10 ceiling through the same
  `NewTaxCalculator(...).GetAdjustedBrackets(...)` chain as the code under
  test. Proven by mutation: a 5% mis-scale injected into
  `GetAdjustedBrackets` left the test green while the engine package's own
  literal-derived test caught it. Lead ruling: CONCEDE. Attribution note
  for the experiment: SPEC §4.1 test bullet itself asked for "the SAME
  value the engine reports" for year 1 — the lead's contract invited the
  tautology; the checker caught the lead's error, not only the worker's.
  Fix for attempt 2: derive the expected figure from the 2026 literal
  (211,400 × (1 + rate/100)^n) and keep the engine-agreement assertion as
  a second, non-load-bearing check. checker-second also causally traced the
  three largest fixture recalibrations by reverting only the 2026 record
  (14.3, the 75k/100k split, 1,049,524.80 all return) — no laundering.
- **2026-09-13 process breach (attempt 1 → 2 window).** The feature
  worktree's reflog shows two `reset: moving to HEAD` entries (the
  signature of `git stash push`) and `taxyears.go` left staged; stash list
  empty afterwards. checker-second's report mentions capturing `git stash`
  text. Tree content verified intact (all 14 files still modified, index ==
  worktree, worker's attempt-2 full suite green, tax.go 0 deletions vs
  base). No harm this time, but it is the same class as the TC-run
  worktree-checkout breach: checkers MUST NOT run any git state command in
  the live tree. Attempt-2 checker briefs now say so in capitals, and the
  lead snapshots by sha256 (`TX1.2.sha256`), not by rtk-filtered diff.
- **2026-09-13 TX1 attempt 2 — ACCEPTED.** checker-tests PASS (all nine
  ACs re-run, tree identity by sha256, attempt-1 reconstructed from the
  patch and byte-compared: only the one test file changed) and
  checker-second PASS (5% mis-scale and a wrong 211,400 literal both
  killed by shipped tests; shuffle runs clean; production files
  byte-identical to attempt 1). `gate.sh check TX1` → `OK: TX1 accepted at
  tier 2 (attempt 2)`. Backlog observations carried from both checkers:
  no shipped test for the `federalTaxYears` ascending invariant; two
  weakened fixture bands (failure_bounds, calculator_expense); manifest
  item 6 ran without `-count=1`; plain `diff` under the rtk hook returned
  a false "identical" on a 623 vs 709-line pair — use python difflib.
