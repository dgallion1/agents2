# Run TY — tax-year-2025 federal record (2026-09-13)

Target: simpleBudget PR #113 `feat/tax-tables-2025` (9a531e0 over master
686a5a5). MERGED d6c554f + DEPLOYED :8080 2026-09-13 (health v1.4.0-1149-gd6c554f). Follow-on to run TX (#112). One task, Tier 2 with `tests,second`.

Outcome: accepted at attempt 1. `gate.sh stats`:
`first-attempt clean: 1/1 (no-evidence rows: 0)`.

Catches: none. Both lanes PASSed first time — literal-by-literal against
Rev. Proc. 2024-40 and Rev. Proc. 2025-32 §3.01 (OBBBA standard
deduction), three invariant-test mutations killed, removing the 2025
record flips exactly the two 2025-specific tests repo-wide, optimizer
file byte-identical to base, shuffle clean.

Process: checker briefs named every git state command as forbidden;
both checkers confirmed sha256 identity of the live tree before and
after. No breach.

Promoted from the TX backlog (V3 pattern): a shipped invariant test for
`federalTaxYears` (strict ascending, all filing statuses, contiguous
brackets).

Backlog observation: stale prose in the `financegaps`-tagged
`engine/finance_concerns_gaps_test.go` ("2025 itself was never seeded",
"two statutory years"); compiles under the tag, excluded from default
runs.

Deliberately out of scope: the OBBBA senior deduction (§70103).
