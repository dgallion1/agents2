# SPEC.md — Federal tax tables: add the tax-year-2025 statutory record (TY run)

Run prefix: **TY**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **686a5a5** (master,
2026-09-13, PR #112 = the TX run's 2026 record). Implementation worktree
`.worktrees/tax-tables-2025` on branch `feat/tax-tables-2025`. This run's
`.swarm/` lives in the agents2 worktree
`.claude/worktrees/tax-tables-2025` (gitignored).

## 0. Status — signed off by user 2026-09-13 ("go")

Follow-on to run TX (docs/runs/2026-09-13-TX-run-state). The user asked:
"add the 2025 record too". Design point accepted: the 2025 standard
deduction uses the OBBBA §63(c)(7) amounts (Rev. Proc. 2025-32 §3.01
removed the original Rev. Proc. 2024-40 §2.15(1) figures); the §63(f)
aged addition was not changed by OBBBA. Still OUT of scope: the OBBBA
senior deduction (§70103), any engine/optimizer logic change.

## 1. Facts (verified in code at 686a5a5)

- `engine/taxyears.go` `federalTaxYears` now holds 2024 and 2026 records
  (ascending by year, month). `ResolveTaxYear(2025, 1)` currently returns
  the 2026 record labelled `BasisProjected` with `InflationFactor` 1 (the
  registry doc comment documents this gap explicitly — that paragraph
  must be rewritten).
- TX1 shipped tests in `engine/taxyears_test.go` that assert
  `ResolveTaxYear(2025,1)` does not error AND is `BasisProjected`; the
  second half of that assertion flips to statutory.
- `LatestStatutoryFederalTaxYear()` stays 2026; `EarliestFederalTaxYear()`
  stays 2024; `taxBaseYear` stays 2024. `projectedYear` extrapolates from
  the LAST record, so 2027+ behaviour is unchanged by inserting 2025.
- `analysis/tax_optimizer_strategies.go` reads bracket tops through
  `GetAdjustedBrackets` (TX1) — no change needed; the 2025 figures flow
  through automatically for a plan whose calendar year 2025 is in range.
- `models.DefaultWhatIfSettings()` anchors StartDate to today (2026-09);
  fixtures that pin an explicit 2025 StartDate (or earlier, with 2025 in
  their horizon) will see the 2025 standard deduction move from the
  projected 32,200 to the statutory 31,500 etc. Each such shift must be
  traced by reverting only the 2025 record.
- Repo gotchas unchanged: never run the binary (data/ symlinks LIVE data);
  `cmd/server` tests may rewrite `testdata/settings/whatif.json`; rtk
  hook falsifies `git diff` and plain `diff` — compare with sha256sum or
  python difflib.

## 2. Verified figures — tax year 2025

Sources (both fetched 2026-09-13, text via pdftotext, copies in this
run's `.swarm/`): **IRS Rev. Proc. 2024-40** §2.01 Tables 1–4, §2.03,
§2.15(3); **IRS Rev. Proc. 2025-32 §3.01** for the OBBBA standard
deduction. VerifiedOn = `2026-09-13`.

Ordinary brackets (upper edge of each rate):

| Rate | MFJ | Single | HoH | MFS |
|---|---|---|---|---|
| 10% | 23,850 | 11,925 | 17,000 | 11,925 |
| 12% | 96,950 | 48,475 | 64,850 | 48,475 |
| 22% | 206,700 | 103,350 | 103,350 | 103,350 |
| 24% | 394,600 | 197,300 | 197,300 | 197,300 |
| 32% | 501,050 | 250,525 | 250,500 | 250,525 |
| 35% | 751,600 | 626,350 | 626,350 | 375,800 |
| 37% | ∞ | ∞ | ∞ | ∞ |

Long-term capital gains (§2.03):

| Status | 0% up to | 15% up to |
|---|---|---|
| MFJ | 96,700 | 600,050 |
| Single | 48,350 | 533,400 |
| MFS | 48,350 | 300,000 |
| HoH | 64,750 | 566,700 |

Standard deduction (OBBBA §63(c)(7), Rev. Proc. 2025-32 §3.01): MFJ
31,500; HoH 23,625; Single 15,750; MFS 15,750. (NOT the 30,000 / 22,500 /
15,000 printed in Rev. Proc. 2024-40 §2.15(1), which was removed.)
Aged addition (Rev. Proc. 2024-40 §2.15(3), §63(f)): 1,600 per person;
2,000 if unmarried → Single 2,000; HoH 2,000; MFJ 1,600; MFS 1,600.

## 3. Task table

| Task | Tier | Checks | Summary |
|---|---|---|---|
| TY1 | 2 | tests, second | Insert the 2025 statutory record between 2024 and 2026; tests |

Tier 2 + `second`: money figures on screen (same rationale as TX1).

## 4. TY1 — contract

### 4.1 Changes
1. `engine/tax.go`: add `TaxBrackets2025`, `LongTermCapitalGainsBrackets2025`,
   `StandardDeduction2025`, `AdditionalStandardDeduction2025Age65`, same
   shapes as the 2024/2026 vars, comments citing the sections above and
   stating that the standard deduction is the OBBBA amount. No edits to
   the 2024 or 2026 literals, `taxBaseYear`, §86/NIIT/IRMAA.
2. `engine/taxyears.go`: insert a 2025 `TaxYearRecord` (EffectiveFromMonth
   1, Provenance Source "IRS Rev. Proc. 2024-40 (tax year 2025); §2.01
   rate tables, §2.03 capital gains, §2.15(3) aged addition; standard
   deduction per OBBBA §63(c)(7) as restated in Rev. Proc. 2025-32
   §3.01", VerifiedOn "2026-09-13") BETWEEN the 2024 and 2026 records.
   Rewrite the doc comment: three seeded years, no gap paragraph.
3. Tests:
   - `ResolveTaxYear(2025,1)` is `BasisStatutory`, `DerivedFromYear ==
     2025`, factor 1; MFJ 22% top == 206700, MFJ std ded == 31500, MFJ
     aged == 1600, Single aged == 2000, MFJ LTCG 0% == 96700, MFS 35% top
     == 375800. Flip the TX1 "2025 is projected" assertion.
   - `LatestStatutoryFederalTaxYear() == 2026` and `EarliestFederalTaxYear()
     == 2024` still hold; `ResolveTaxYear(2027,1)` still derives from 2026.
   - NEW shipped test (V3 promotion from TX backlog): `federalTaxYears` is
     strictly ascending by (Year, EffectiveFromMonth) and every record's
     four maps are populated for all four filing statuses with brackets
     whose `MinIncome` equals the previous `MaxIncome`.
   - Full `go test -count=1 ./...` green; any golden that moves is traced
     to the 2025 record and the tracing recorded in the manifest.
### 4.2 Acceptance criteria (checkers cite commands)
- AC1 `go build ./... && go vet ./...` clean.
- AC2 `go test -count=1 ./...` all packages ok; `git status --short`
  shows only intended files (testdata clean).
- AC3 2025 figures match the sources exactly (checker re-derives from the
  Rev. Proc. 2024-40 text in `.swarm/rp-24-40.txt` for brackets, LTCG and
  aged, and from Rev. Proc. 2025-32 §3.01 for the standard deduction).
- AC4 2024 and 2026 literals untouched (`git diff 686a5a5 -- engine/tax.go`
  additions only).
- AC5 Record order 2024, 2025, 2026; provenance strings + VerifiedOn;
  Latest == 2026; Earliest == 2024; the new ascending-invariant test is
  shipped and passes.
- AC6 No new bracket literal anywhere outside `engine/tax.go` and
  `_test.go` (grep the 2025 values 206_700/206700, 96_950, 48_475,
  103_350, 31_500 across internal/ cmd/ web/).
- AC7 `analysis` constants-basis for a 2026-start plan is unchanged
  (StatutoryYear 2026, FirstProjectedYear 2027); for a 2025-start MFJ
  fixture the bracket-fill 22% ceiling at projection year 0 is 206,700.
- AC8 Manifest `TY1.1.manifest`: every changed file, every command with
  its final lines, and each golden shift traced.
### 4.3 Not acceptable
`taxBaseYear` moved; any engine/optimizer logic change; the 30,000 /
22,500 / 15,000 pre-OBBBA deduction; a senior-deduction field; edits to
2024/2026 literals.

## 5. Rulings
(Recorded as they happen, with the mechanism.)

## 6. Landing
Commit on `feat/tax-tables-2025` → push → PR → (user) merge → deploy via
systemd recipe → `gate.sh done` / `stats` verbatim → run record
`docs/runs/2026-09-13-TY-run-state/`.

- **2026-09-13 TY1 attempt 1 — ACCEPTED, first attempt clean.** checker-tests
  PASS (AC1–AC8 with commands; literal-by-literal against both Revenue
  Procedures; invariant test mutation-killed two ways; removing the 2025
  record in a copy flips exactly the two 2025-specific tests repo-wide).
  checker-second PASS (three invariant mutations caught; resolver probed
  independently; optimizer file byte-identical to base; shuffle clean).
  `gate.sh check TY1` → `OK: TY1 accepted at tier 2 (attempt 1)`.
  No catches this run. Backlog: stale prose in the `financegaps`-tagged
  `finance_concerns_gaps_test.go` ("2025 itself was never seeded"; "two
  statutory years") — compiles under the tag, excluded from default runs.
  The TX-backlog "ascending invariant" probe was promoted to a shipped
  test here (V3 pattern).
