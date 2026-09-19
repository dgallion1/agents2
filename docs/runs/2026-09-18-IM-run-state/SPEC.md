# SPEC.md — Superseded pending rows drop at load; imports assign their account (IM run)

Run prefix: **IM**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **86d3a7c** (master,
2026-09-18, PR #118). Implementation worktree `.worktrees/import-superseded`
on branch `feat/import-superseded` (created at dispatch, INSIDE the repo per
the CP lesson). This run's `.swarm/` lives in the agents2 worktree
`.claude/worktrees/budget2-expense-matching-5ad85f` (gitignored).

## 0. Status — PR #119 MERGED 643fa54 + DEPLOYED :8080 2026-09-18 21:11 EDT (health `v1.4.0-1170-g643fa54`, old binary `budget2.old-2111`); run worktrees and branch removed; post-deploy live check matched the oracle (unmatched 1 = posted Membership −64.50, pinned to Groceries — BJ's; 6 live pending rows; duplicates 0 unresolved; balances unchanged). Earlier: ALL FOUR TASKS ACCEPTED, PR #119 OPEN (2026-09-18 ~20:00 EDT): IM1 dca7dfd (tier 3), IM1T 2b3bafd (tier 1), IM2 e5a92dd (tier 2), IM2F 4865cdf (tier 2, user chose menu option 1 via "continue") on `feat/import-superseded`, pushed; simpleBudget PR #119 open against master 86d3a7c. `gate.sh done`: `OK: all tasks accepted, evidence verified, no unresolved flags`; `gate.sh stats`: `first-attempt clean: 4/4 (no-evidence rows: 0)`. Merge / pull / deploy await the user's go-ahead. Final full-site a11y sweep PASS (9 pages × 2 themes, one pre-existing what-if dark-theme contrast item → backlog §7). Signed off by user 2026-09-18 ("A": D1–D6 as proposed). Standing instruction for this run: when an issue comes up, the lead offers the user a menu of options rather than deciding alone. IM1 ACCEPTED dca7dfd (attempt 1, gate `OK: IM1 accepted at tier 3 (attempt 1)`); IM1T ACCEPTED 2b3bafd (attempt 1, gate `OK: IM1T accepted at tier 1 (attempt 1)`); IM2 DISPATCHED attempt 1 (worker-coder, same worktree) 2026-09-18 ~18:20 EDT; worker returned DONE ~18:50; lead real-data check (section 4.2, `.swarm/tier3/IM2-fixture/check.py`) ALL PASS in both variants (logs `check.preupload.1.log`, `check.full.1.log`); three checker lanes dispatched ~18:55.

Origin: the 2026-09-18 re-upload. Six USAA exports landed under browser
names, matched no account, hijacked the StableIDs of every shared row,
orphaned 24 duplicate decisions and dozens of pins, and left 79 rows
"unmatched" plus balances frozen at the 09-03 anchors. Hand-renaming the
files fixed all of it. The user's two follow-up questions are this run:

1. "Maybe we should ignore pending?" — decided: **superseded-only**, not
   blanket (section 2.1).
2. "The bank always names the files the same … is there some way to avoid
   my having to rename the files?" — yes: the import step detects the
   account from the file's content and names the file itself (section 2.2).

### Decisions the user confirms at sign-off

| # | Decision | Proposed |
|---|----------|----------|
| D1 | Which pending rows drop | Only **superseded** ones: a Pending row from file F is dropped when another file for the SAME account has a later max date and covers the row's date. Pending rows in the newest export stay visible (today: 6 rows, $486.78). |
| D2 | Where the account picker lives | Import-folder scan gets a per-file `<select>` pre-filled by detection. The browser-upload path gets detection only (no picker): unique detection → renamed; otherwise saved under its original name, unassigned, with the reason spelled out. |
| D3 | Generated file name | `<account-id>_<min>_to_<max>.csv` (dates from the rows). The server verifies the account's own file patterns match that name; if not, the import is **refused** with a message naming the pattern to add. No writes to accounts.json in this run. For the three live accounts the generated names already match (`usaa-checking*`, `usaa-credit*`, `usaa-health*`). |
| D4 | Byte-identical re-uploads | Skipped with "identical to `<existing>`" and the source file is **kept** in the import folder (matches today's name-collision behaviour). Alternative: delete the source when "delete source" is ticked. |
| D5 | Out of scope (backlog) | Posted rows whose description the bank rewrote between exports (two checking twins from 08-12); a general "newest export wins" rule; cleanup of inert decisions and stale `file:` pin keys. |
| D6 | Tiers | IM1 Tier 3 (touches `internal/services/dataloader/**`, a critical path); IM2 Tier 2 `tests,a11y,second`. |

Foreign territory notice: `/home/darrell/bin/ai/budget2/.worktrees/apply-names`
(branch `feat/apply-button-names`) and three detached `.claude/worktrees/*`
exist in the target repo. This run never touches HEAD, branches, stash or
index of the main checkout; it builds only in its own worktree. The live
server on :8080 keeps running from the main checkout throughout.

## 1. Facts (verified in code at 86d3a7c and in the live data on 2026-09-18)

### Load pipeline
- `LoadDataContext` (`internal/services/dataloader/loader.go:274-372`) globs
  `*.csv` (sorted), maps each file to an account by
  `accounts.MatchFile` (filename patterns, `accounts.go:260`), parses it via
  `loadCSVFileForAccount` (`loader.go:428`), then in order:
  `assignStableIDs` (line 358) → `deduplicateTransactions` (366, by content
  `Hash`) → `classifyTransfers` (367) → `classifier.ClassifyTransactions` →
  near-duplicate detection and decision application.
- `Hash` = date + lower-cased description + amount, recomputed after the
  sign flip (`loader.go:549`), so it is stable across the two sign
  conventions only when both parses flip the same way.
- `StableID` = `<accountID>|<date>|<cents>|<occurrence>`; an unassigned
  file's rows use `file:<basename>` in the account slot
  (`stable_id.go:12`). Duplicate decisions and pins are keyed by StableID.
- A stored `kept_winner` decision only suppresses a row when the detector
  forms that pair on this load (`loader.go:1042-1078`). If one side is
  absent the decision is inert; the other side is NOT suppressed. This is
  what makes dropping pending rows safe for the 24 existing decisions that
  kept the pending side.
- `isPendingStatus` (`near_duplicates.go:358`): Status contains "pending",
  case-insensitive; empty Status is not pending. `isPostedStatus` (367).
- `GetFileInfo` / `scanCSVMetadata` (`loader.go:754-870`) already compute
  per-file `MinDate`/`MaxDate` from the Date column.

### The pending rows (live data, 2026-09-18, 16 files)
- 44 rows carry Status `Pending`. 38 are **superseded** (an older export,
  and a newer export for the same account covers the date). 6 are live
  (credit export ending 09-18, dated 09-16..09-18, $486.78).
- Of the 38: 27 have a same-amount posted twin within 5 days (the near-dup
  queue the user resolved by hand, mostly keeping the pending side); 4 are
  `Unavailable` $0.00 placeholders; 7 have no twin — `SQ *CHICK MAGNET`
  36.86 (posted 41.98), `Roam Cafe` 89.08 (posted 104.08), and five Amazon
  rows (54.98, 38.73, 22.17, −22.17) the bank re-split when posting.
- Checking exports carry Status `Posted` on every row except one (07-13
  card payment 14.95). The two 08-12 checking twins (`USAA FUNDS TRANSFER
  CR` 8571.35 / `Lucid BILL PMT` 1580.43 vs their rewritten posted
  versions) are Posted on both sides → D5, out of scope.

### Import and upload paths
- Import folder (`cfg.ImportDirectory`, default XDG Downloads, env
  `BUDGET2_IMPORT_DIR`): `GET /explorer/import/scan` → `scanImportDirectory`
  (`explorer/handlers.go:500`) lists each CSV with size, min/max date and a
  name-only `Exists` flag; `POST /explorer/import` → `importOneFile`
  (`:577-750`) copies bytes to `DataDirectory/<same name>` via
  `store.CreateExclusive`, reads back, optionally deletes the source.
- Browser upload: `POST /explorer/upload` → `uploadOneFile`
  (`:934-970`), same name, `CreateExclusive`, name-only collision skip.
- Templates: `web/templates/pages/filemanager.html` — the upload form
  (line 12), the import form (80-102) with `#import-scan-list`
  (`aria-live="polite"`) and `#import-result` (`role="status"`), and the
  `import-scan` / `import-result` defines (572-620). Outcomes are already
  spelled out in words (A-9).
- No rename/temp-file primitive in `storage.Storage` (only `CreateExclusive`,
  `WriteFile`, `Remove`, `Glob`, `Stat`). The final name must be decided
  before the single write.
- Unassigned files are surfaced on the Accounts page ("Unassigned files",
  `accounts.html:630`), the explorer banner (`handlers.go:256`,
  `loader.UnassignedCount()`), and the dashboard.
- Config env for a throwaway instance: `BUDGET_LISTEN_ADDR`,
  `BUDGET_DATA_DIR`, `BUDGET2_BACKUP_DIR`, `BUDGET2_IMPORT_DIR`
  (`config.go:96-119`). The binary parses no flags; every invocation is a
  server.

## 2. Design

### 2.1 IM1 — superseded pending rows drop at load (+ `ParseCSV` export)

New stage in `LoadDataContext`, after StableIDs are stamped and BEFORE
`deduplicateTransactions` (and before the Hash→StableID index is set):

```
dropSupersededPending(allTransactions, fileCoverage)
```

Why before dedup: two real rows (`Cybernet` 28.42 on 2025-12-30, `Chateau
Wine & Spirits` 35.63 on 2026-04-29) are Pending in the older export and
Posted in the newer one with the SAME date, description and amount, so
they share one content `Hash`. Dedup keeps the first occurrence — the
older file's pending copy. A stage placed after dedup would then drop the
only surviving copy and the purchase would vanish. Placed before dedup, the
pending copy goes and the posted copy is the one dedup keeps. Consequently
the legacy-Hash→StableID index (`assignStableIDs` builds it today in the
same call that stamps IDs) must be built from the SURVIVORS, so a
legacy-keyed pin is never rekeyed to a dropped row's StableID on the next
pins write; the worker splits stamping from index building or filters the
index by the surviving set.

`fileCoverage` is built in the per-file loop from the rows just parsed:
`{basename → accountID, minDate, maxDate}` (no second scan of the file).

Rule, exactly: a row R from file F is dropped iff
1. `isPendingStatus(R.Status)` is true, and
2. `F.accountID != ""` (unassigned files never supersede and are never
   superseded), and
3. there exists a file G ≠ F with `G.accountID == F.accountID`,
   `G.maxDate > F.maxDate`, and `G.minDate ≤ R.Date ≤ G.maxDate`.

Everything else is untouched: Posted/empty-status rows, pending rows in the
newest file for their account, pending rows a newer file does not cover, and
files with equal `maxDate`. The stage runs after `assignStableIDs`, so
surviving rows keep their occurrence index (the posted twin of a dropped
pending row keeps `|1`); decisions and pins keyed to a dropped row become
inert, exactly like a row outside the loaded date range. One summary log
line: `Dropped N superseded pending rows` with a per-file breakdown.

Also in IM1, a pure refactor with no behaviour change: split
`loadCSVFileForAccount` into open + `ParseCSV(r io.Reader, sourceFile
string, acct *models.Account) ([]models.Transaction, error)` (exported).
IM2 needs to parse an import-folder file and an in-memory upload with the
loader's own column mapping and sign rules, and it must not grow a second
parser or touch the critical path itself.

Wording sites that describe loading (enumerate with `grep -rn "merges exact
duplicates\|Deduplicate\*\* exact"`; the known ones): GLOSSARY.md load
pipeline step 5 (line 175); `internal/services/mcpsvc/admin/files.go:34`
(`list_data_files` description); any `server_test.go` pin on that wording;
the MCP server instructions if they describe loading. Each gains one clause:
"drops pending rows that a newer export for the same account supersedes".

Not in IM1: any UI. The file manager and Accounts page are unchanged.

### 2.2 IM2 — imports detect their account and name the file

A new small package `internal/services/importer` (handler-free, unit
tested) with three pure functions, used by both `importOneFile` and
`uploadOneFile`:

- `Detect(rows []models.Transaction, ledger *models.TransactionSet, accts
  []models.Account) Detection` — key every parsed row as `(date,
  normalized description, |cents|)` (sign-convention independent, since an
  unassigned parse may flip differently from the account's kind); count
  shared keys per account across the loaded ledger; `AccountID` is set when
  exactly one account shares ≥ 3 keys, else empty with `Reason` = "no
  match" or "ambiguous: A, B". A first-ever export for a new account is
  "no match" by design — the picker handles it.
- `Name(accountID string, rows) string` → `<accountID>_<min>_to_<max>.csv`
  from the rows' date range.
- `ContentIdentical(data []byte, dataDir) (existingName string)` — sha256
  over the bytes against every `*.csv` in the data directory.

Import-folder flow (`GET /explorer/import/scan`): each entry gains
`Detected` (account ID + display name), `DetectReason`, and
`IdenticalTo`. The `import-scan` partial renders, per file, a
`<select id="import-account-{{$i}}" name="account:{{$e.Name}}">` with one
`<option>` per account (value = ID, text = Name) plus `Unassigned (keep
original name)`, pre-selected to the detection; a `<label for=…>` "Account
for `<file>`"; ambiguous/no-match shown as text "(could not detect the
account — choose one)"; identical files show "(identical to `<name>`, will
be skipped)" with the checkbox disabled, replacing today's name-only
`Exists` text when both apply.

`POST /explorer/import` reads `account:<name>` per ticked file:
- account chosen → parse (`ParseCSV`), compute the name, verify
  `accounts.MatchFile(accts, newName) == accountID` else **rejected** with
  reason `account <Name> has no file pattern matching <newName>; add the
  pattern on the Accounts page`; if `newName` exists with different
  content, suffix `_2`, `_3` … before `.csv` (re-verify MatchFile);
  `CreateExclusive(newName)`, read-back verification and `delete_source`
  exactly as today. Outcome reason: `imported as <newName> (<Account
  Name>)`.
- `unassigned` → today's behaviour byte for byte (original name,
  name-collision skip).
- identical content (either choice) → `skipped`, reason `identical to
  <existing>`; source kept (D4).

Browser upload (`POST /explorer/upload`): parse the bytes; unique detection
→ same naming/verification path; otherwise original name, outcome reason
`saved unassigned: could not detect the account (use the import folder to
choose one, or rename to an account pattern)`. Identical content → skipped
as above.

Not in IM2: writing `accounts.json`; a picker on the upload form; changing
what the Accounts page does with unassigned files.

## 3. Task table

| Task | Tier | Checks | Depends on | Justification |
|------|------|--------|------------|---------------|
| IM1 — superseded pending drop + `ParseCSV` export + wording | **3** | oracle + `tests,second` (both lanes mandatory at Tier 3) | — | Oracle strong (fixture + frozen real data), reversible by revert, but every consumer of the ledger changes and the manifest sits in `internal/services/dataloader/**` (critical.globs) — the gate forces Tier 3 regardless. Assigned upfront so the oracle is written before dispatch. |
| IM2 — importer package, scan/import/upload detection + naming + identical skip, templates | **2** | `tests,a11y,second` | IM1 (`ParseCSV`) | Oracle strong (handler tests + axe), reversible (a wrong name is a rename), blast radius moderate: a wrong account silently mis-keys StableIDs, balances and transfers — a wrong figure on screen, so the adversarial lane is named. Escalates to 3 automatically if the manifest touches `dataloader/**` or `accounts.go`. |

| IM1T — test-only follow-up: AC5 assigned-vs-unassigned in both directions (promotes checker-tests F1, ruling 2026-09-18b) | **1** | `tests` | IM1 | Test file only (`superseded_pending_test.go`; test globs exempt it from the critical path); strong oracle (the test must fail under the checker's MUT-D mutation); lead-authored under the lean exception, verified by `checker-tests`. |
| IM2F — follow-up (rulings 2026-09-18c/d): `Detect` counts DISTINCT shared keys; promote the suffix-reverification and upload-no-match probes into the suite | **2** | `tests` | IM2 | One production file (`importer.go`, not a critical path) plus tests; strong oracle (three named mutations, each must be killed by exactly the new test); reversible; lead-authored under the lean exception, verified by `checker-tests`. User chose option 1 of the 2026-09-18 menu ("continue"). |

### IM2F acceptance criteria
1. `importer.Detect` counts distinct (date, normalized description, |cents|)
   keys shared with each account: a file holding one coincidental key three
   times detects "no match"; three distinct shared keys still detect (the
   threshold is unchanged). Mutation: revert to per-row counting → the new
   `TestDetect_RepeatedCoincidentalKey_DoesNotReachThreshold` fails.
2. Suffix re-verification: an account whose only pattern is the exact base
   name, with the base already present (different content) → `rejected`
   with the reason naming the `_2` name; nothing written; source kept.
   Mutation: delete the second `accounts.MatchFile` guard in
   `saveUnderDetectedName` → the new test fails.
3. Upload no-match with two accounts configured and a loaded ledger (one
   shared row each) → saved under the original name with the exact
   "saved unassigned: …" reason; neither account's generated name exists.
   Mutation: force the upload path's detection to `accts[0]` → the new
   test fails.
4. All existing importer and explorer tests unchanged and green; `go test
   -count=1 ./...` green; `gofmt -l` empty on touched files; `make check`
   passes; the lead's real-data check (`check.py`, both variants) still ALL
   PASS.

Dispatch is sequential: IM2 starts after IM1 is accepted (it imports
`ParseCSV`). IM1 and IM2 go to `worker-coder`; IM1T is lead-authored and
lands before IM2 is dispatched so the worktree holds one task's edits at
a time.

### IM1T acceptance criteria
1. A new test in `internal/services/dataloader/superseded_pending_test.go`
   covers three cases, each asserting on the loaded set (3 rows, the
   pending row present): (a) assigned file F (account A, pending row P)
   plus a newer covering file for a DIFFERENT assigned account B → P
   survives (the "SAME account" half of rule (c), untested by the
   delivered suite, which uses one account throughout); (b) assigned F
   plus an UNASSIGNED newer covering file → P survives; (c) unassigned
   older file with a pending row plus an ASSIGNED newer covering file → the
   row survives.
2. Mutation kill: with the `g.accountID != f.accountID` check removed from
   `isSupersededPending`, case (a) FAILS (the checker reproduces the
   mutation in a `cp -a` copy). Note for the record: removing rule (b)
   alone kills nothing, because the loader only records coverage for
   account-matched files — cases (b) and (c) document a property that
   the coverage construction guarantees structurally; the lead's first
   draft of this task relied on that mutation and was wrong.
3. `go test ./internal/services/dataloader/...` green; `gofmt -l` empty on
   the file; no production file in the manifest.

### IM1 acceptance criteria (each one a command the primary verifier cites)

1. **Rule.** Unit test in `internal/services/dataloader`: files F (account
   A, pending row P dated D, maxDate M1) and G (account A, minDate ≤ D ≤
   maxDate, maxDate > M1) → P absent from `LoadDataContext`'s result.
2. **Decision inertness.** Same fixture plus a stored `kept_winner`
   decision whose kept side is P and suppressed side is P's posted twin in
   G → the twin is present with `Suppressed == false`, counted by
   `SumAmount`, and `list_duplicates` reports 0 unresolved.
3. **Newest export keeps its pending rows.** A pending row in the file with
   the latest maxDate for its account survives.
4. **Uncovered pending rows survive.** G.minDate > D → P survives even
   though G is newer.
5. **Unassigned files never participate.** Two unassigned files with
   overlapping dates → nothing dropped; an unassigned file never supersedes
   an assigned one and vice versa.
6. **Equal maxDate never supersedes.** Two files, same account, same
   maxDate → nothing dropped.
7. **Only pending status.** Rows with Status `Posted`, `Cleared`, empty, or
   `Scheduled` are never dropped by this stage.
8. **StableID stability.** In fixture (2) the posted twin's StableID is
   `A|D|cents|1` before and after the change (occurrence index unchanged);
   the stage runs after StableIDs are stamped and BEFORE
   `deduplicateTransactions` and the index publication (section 2.1 —
   this line originally said "after deduplicateTransactions", a lead
   error the primary checker caught at attempt 1; ruling 2026-09-18a).
9. **Transfers unaffected.** A checking/credit paired transfer in the
   fixture remains `paired` with the same `pair_key`.
10. **Log line.** `Dropped 1 superseded pending rows` appears once per load
    with a per-file breakdown; zero drops log nothing.
11. **`ParseCSV` refactor.** `loadCSVFileForAccount` delegates to
    `ParseCSV`; every existing dataloader test passes unchanged; a new test
    parses the same bytes through both paths and gets identical slices
    (including `Hash`, `Status`, `SourceFile`, sign).
12. **Wording.** Every site found by the grep in 2.1 carries the new
    clause; `go test ./internal/services/mcpsvc/...` green.
13. **Suite.** `go build ./... && go vet ./... && go test ./...` green;
    `gofmt -l` empty on touched files; `make check` if the Makefile defines
    it.
14. **Oracle.** `.swarm/tier3/IM1/accept.sh` exits 0 with final line
    `ORACLE PASS` (section 4).

### IM2 acceptance criteria

1. **Detection unit tests** (`internal/services/importer`): unique match
   (≥ 3 shared keys, one account) → that ID; two accounts each ≥ 3 →
   ambiguous with both names; 0–2 shared keys → no match; a credit-kind
   file parsed unassigned (sign flipped the other way) still detects via
   `|cents|`; empty ledger → no match.
2. **Naming.** `Name("usaa-credit-card", rows)` →
   `usaa-credit-card_2026-07-01_to_2026-09-18.csv` for the 09-18 export's
   rows; MatchFile verification refuses when no pattern matches (test with
   an account whose only pattern is `other*.csv`), suffixing `_2` when the
   name exists with different content, and re-verifies the suffixed name.
3. **Identical skip.** Import and upload of bytes identical to an existing
   data-dir CSV → `skipped`, reason `identical to <name>`, nothing written,
   source kept.
4. **Scan partial.** Handler test renders `import-scan` with one
   `<select>` per entry, `<label for>` bound, detected option
   `selected`, identical entries disabled with the text in 2.2; existing
   scan tests (`TestHandleImportScan_*`) unchanged and green.
5. **Import outcomes.** For an entry with `account:<name>=usaa-credit-card`
   the file lands under the generated name and the outcome reason names it
   and the account; `unassigned` reproduces today's tests
   (`TestHandleImport_*` all green unchanged); `delete_source` semantics
   unchanged.
6. **Upload outcomes.** Unique detection renames; no match keeps the
   original name with the spelled-out reason; existing
   `TestHandleFileUpload_*` green unchanged.
7. **Unassigned surfaces.** After importing the three 2026-09-18 files
   (lead's real-data check, section 4.2) `loader.UnassignedCount()` is 0
   and the Accounts page's "Unassigned files" section shows none.
8. **a11y (checker-a11y, against ACCESSIBILITY.md).** axe zero violations
   on `/filemanager` with a populated scan list and a populated result
   region, both themes (A-1, A-2); every `<select>` has an accessible name
   (A-1 `select-name`); contrast of the new inline text on both themes
   (A-3); selects reachable and operable by keyboard with visible focus
   (A-4, A-5); ≥ 24×24 px targets (A-15); outcomes remain words, not colour
   (A-9); `#import-result` stays a `role="status"` live region (A-10).
9. **Suite.** As IM1-13, plus `make css` if any Tailwind class is new
   (`make check` must not report CSS drift).

## 4. Oracle for IM1 (lead-authored before dispatch, validated at both ends)

`.swarm/tier3/IM1/accept.sh` (executable) runs against the worker's
worktree at `$1`:

1. Builds the binary in the worktree (`go build -o /tmp/… ./cmd/server`).
2. Copies the frozen fixture `.swarm/tier3/IM1/fixture/` (a snapshot of the
   live data dir as of 2026-09-18 19:45Z: 16 CSVs, accounts.json,
   duplicate_decisions.json, transaction_pins.json, major_expenses.json;
   local only, never committed) to a temp dir and starts the binary with
   `BUDGET_LISTEN_ADDR=127.0.0.1:<free port>`, `BUDGET_DATA_DIR=<copy>`,
   `BUDGET2_BACKUP_DIR=<temp>`, `BUDGET2_IMPORT_DIR=<empty temp>`.
3. Asserts through the MCP JSON-RPC endpoint (`POST /mcp`), i.e. on every
   existing consumer's real response body:
   - `search_transactions` 2026-08-01..2026-08-31, type outflow: the rows
     `SQ *CHICK MAGNET −36.86` and `Roam Cafe −89.08` are absent; `Chick
     Magnet −41.98` and `Roam Cafe −104.08` present; `sum_amount` equals the
     baseline sum + 125.94 (baseline captured from the 86d3a7c build on the
     same fixture, recorded in the script).
   - `search_transactions` 2026-09-16..2026-09-18: all 6 pending rows
     present (Wegmans 218.72, Home Depot 7.00 and 56.44, YouTube Premium
     26.99, Brighton Animal Hospital 133.00, Tully's 44.63).
   - `search_transactions` 2025-11-16..2025-11-16: Amazon 54.98 absent;
     2025-12-29: Amazon 38.73 absent; 2026-03-15..2026-03-18: both 22.17
     Amazon rows absent and the window's sum unchanged from baseline.
   - `list_duplicates`: `unresolved_count` 0.
   - `get_transfers` 2026-09-01..2026-09-18: the 8448.62 pair is `paired`
     on both legs.
   - `get_accounts`: all three balances equal the baseline (the dropped
     rows are before the 09-03 anchors; the 6 kept rows are after and
     unchanged).
   - `list_major_expenses` full window: `Christine` total 474.04 / count 3
     (the 36.86 pin is inert); `Eating out — restaurants & fast food`
     4017.30 / 100 (−89.08 Roam, +59.00 and +58.00 restored posted "Five
     Guys via Grubhub" twins, which the restaurants keyword "Five guys"
     claims — as it already does for the five older rows with that
     description); `Eating out — delivery (Grubhub)` 179.52 / 2; `Amazon`
     23726.90 / 358; `Ignore` count 1; `unmatched_count` **1** — exactly
     the restored posted `Membership` −64.50 on 2026-05-01, which no keyword
     covers (its pending twin `BJS MEMBERSHIP` was the kept side).
   - `list_data_files`: `count` 16 and raw row counts unchanged (raw scan).
   - `get_transfers` 2026-07-13: one 14.95 leg (the pending checking copy
     is gone); `search_transactions` 2025-12-30 and 2026-04-29: `Cybernet`
     −28.42 and `Chateau Wine & Spirits` −35.63 present exactly once (the
     identical-key rule, section 2.1); `search_transactions` all rows:
     `total` 1606 (baseline 1616 − 10 rows that had no counted twin).
4. Stops the instance, prints `ORACLE PASS` only when every assertion held.

Both-ends validation (done 2026-09-18 before dispatch): 37 checks. On the
86d3a7c tree the script fails 18 of them (every phantom-row and count
check) and passes every invariant; against a throwaway prototype of the
rule (placed before dedup, index from survivors) it passes 37/37 — after
two hand-derivation errors in the lead's expectations were corrected
against the fixture (the label of a restored posted twin can differ from
its pending twin's; recorded in section 6). The prototype worktree was
removed. Log: `.swarm/tier3/IM1/oracle.proto-validation.log`.

### 4.2 Lead's real-data check for IM2 (at acceptance, not an oracle)
Against a copy of the data dir and a temp import folder holding the four
files from `~/budget2-backups/removed-from-data/2026-09-18-reupload/` plus
copies of the three renamed exports under their original browser names
(`bk_download (4).csv`, `bk_download (5).csv`, `creditCard24-25.csv`):
run against the **pre-upload** data variant (`.swarm/tier3/IM2-fixture/
data-preupload/` = the frozen fixture minus the three exports added on
2026-09-18), the scan must flag `bk_download.csv`, `(1)` and `(2)` as
identical to their still-present twins; detect `(3)` and `(4)` as USAA
Credit Card, `(5)` as USAA Checking and `creditCard24-25.csv` as USAA
Credit Card; and importing `(3)`, `(4)`, `(5)` and `creditCard24-25.csv`
must produce `usaa-credit-card_2026-07-01_to_2026-08-27.csv`,
`usaa-credit-card_2026-07-01_to_2026-09-18.csv`,
`usaa-checking_2026-07-06_to_2026-09-14.csv` and
`usaa-credit-card_2024-08-02_to_2025-11-18.csv` (generated names use the
account ID; the lead's hand-chosen `usaa-credit_…` prefix was a different
spelling of the same pattern match — corrected 2026-09-18). Afterwards the
Accounts page lists no unassigned files and `list_data_files` shows the
four new names. Against the FULL fixture instead, six files must be flagged
identical (`bk_download (3).csv` has no byte-twin in the data folder; it
detects as USAA Credit Card) and importing the six must write nothing.
Result 2026-09-18: ALL PASS in both variants (`check.preupload.1.log`,
`check.full.1.log`), re-run independently by checker-tests.

## 7. Backlog from IM2 verification (not in scope)
- (checker-tests F3) The identical-content scan runs outside the exclusive
  write: two concurrent uploads of identical bytes under DIFFERENT names
  both land (20/20). Master writes both too (it has no content check at
  all), and content-hash dedup at load makes the second harmless; a
  data-dir-wide lock around scan+write would close it.
- (checker-second) The browser-upload path's outcome reasons ("saved as …",
  "saved unassigned: …") are computed but the page's existing upload script
  never renders them; pre-existing, outside the manifest. The import-folder
  path — the user's actual flow — renders every outcome.
- (checker-a11y) The "(could not detect the account — choose one)" note is
  not bound to its `<select>` via `aria-describedby`; text is present (A-9
  met), binding is a nicety. That string never rendered on the real
  fixture (all four detectable exports detected), so its contrast was
  verified by class identity with the "(identical to …)" text.
- (checker-tests) No handler-level test renders the ambiguous scan branch
  or the suffix-plus-pattern-mismatch combination; both proven by code
  reading and probes. Candidates for IM2F.
- (final a11y sweep, pre-existing, `whatif.html` / `components/whatif/
  guardrails.html` byte-identical to master) the what-if page's "Adjust
  spending rules manually" `<summary>` has no text-colour class, so in dark
  theme it inherits near-black on `dark:bg-gray-800`: 1.38:1. Fix candidate
  `text-gray-800 dark:text-gray-100`. Every other page/theme: 0 violations
  (report: `.swarm/verdicts/IM-final.a11y-sweep.report`).
- `importer.Name` on a file whose rows all lack a parseable date yields
  `<id>__to_.csv`; the parser skips unparseable dates so this needs an
  all-bad file. Reject with "no transactions parsed" would be cleaner.

## 5. Rulings
- **2026-09-18a (IM1 attempt 1, caught by: primary checker `checker-tests`,
  finding F2).** SPEC.md's AC8 text said the stage runs "after
  `deduplicateTransactions`", contradicting §2.1 ("BEFORE") and the dispatch
  brief. The worker followed §2.1; the checker proved by mutation (stage
  moved after dedup) that AC1/2/8/9 fail and a purchase vanishes. Lead
  artifact defect; AC8 corrected in place. No effect on the verdict.
- **2026-09-18b (IM1 attempt 1, caught by: primary checker, finding F1).**
  The delivered AC5 test covers only the both-unassigned case; the
  "assigned vs unassigned in either direction" half of AC5 was proven by
  the checker's mutation-killed probe, not by the suite. Promoted as
  test-only follow-up **IM1T** (V3 pattern) rather than a FAIL: the
  behaviour is correct, the evidence must outlive the verdict file.
- Attribution note for the lean experiment: the second lane found nothing
  the primary lane missed at IM1; the primary lane found two lead-artifact
  defects (spec wording, criterion coverage). Zero worker defects.
- **2026-09-18c (IM2 attempt 1, caught by: primary checker, F1).** §2.2
  says "count shared keys per account"; `importer.Detect` counts matching
  ROWS against the account's key set, so one coincidental key repeated
  three times in an import file reaches the ≥ 3 threshold. Spec-wording
  deviation, not a criterion failure (no AC1 case enumerates it); the
  distinct-key count is strictly safer for the money hazard. Ruling:
  accepted at attempt 1; fix offered to the user as follow-up IM2F
  (menu), together with the two probe promotions below.
- **2026-09-18d (IM2 attempt 1, caught by: primary checker, F2 and F4).**
  Two delivered tests claim more than they assert: the suffix test's
  pattern matches both the base and the `_2` name, so the re-verification
  guard is unkilled; the upload no-match test seeds zero accounts, so
  "attribute every upload to accts[0]" survives the suite. Both behaviours
  proven correct by the checker's mutation-killed probes. Same shape as
  2026-09-18b: promote the probes (IM2F).
- **2026-09-18e (IM2, lead artifact, caught by: primary checker F5 and the
  lead's own harness).** §4.2 said all seven fixture files are identical
  against the full fixture; six are — `bk_download (3).csv` has no
  byte-twin there (it was set aside on 2026-09-18, not renamed). §4.2
  corrected; `check.py` already encoded six.
- Attribution at IM2: every lane PASS; the primary lane produced all five
  findings (one implementation-vs-wording deviation, two test-strength
  gaps, one pre-existing TOCTOU, one lead spec error); the adversarial
  lane's wrong-account attack on the real transfer legs did not land; the
  a11y lane found nothing in the diff. Three lanes, zero FAILs, 3/3
  first-attempt clean — recorded for the lean-verification decision rule.

## 6. Backlog observations (not in scope; carried to NEXT.md)
- **Curation follow-up after IM1 lands (user, via MCP or the page):** the
  posted `Membership` −64.50 (2026-05-01) becomes visible and unmatched;
  it is the BJ's membership (its pending twin read `BJS MEMBERSHIP`) — pin
  it to "Groceries — BJ's". The two restored "Five Guys via Grubhub" rows
  (59.00, 58.00) land under restaurants, not delivery, because the
  restaurants keyword "Five guys" wins; five older rows with the same
  description already sit there, so this is consistent, but the delivery
  group's history shrinks by two. Both are labelling choices, not defects.
- Two checking twins from the 08-12 export whose posted description the
  bank rewrote (`USAA FUNDS TRANSFER CR` 8571.35 and the 14.95 card
  payment 08-12/08-13) double-count transfer totals and balance history
  before the 08-27 anchor. Needs a "newest export wins for the dates it
  covers" rule or a Transfer-aware near-dup shape.
- Amazon 38.73 (2025-12-29 pending) has no posted twin at any amount;
  probably re-split. Dropped by IM1 as superseded; if it was real spending
  the posted rows already carry it.
- ~120 stale `file:bk_download (N).csv|…` StableID keys in
  `transaction_pins.json` from before the 2026-08-29 rename. Inert, but a
  future upload that reuses the same browser name can resurrect one onto an
  unrelated row. IM2 makes such names rare; a prune is a separate task.
- 24 duplicate decisions whose kept side is a pending row become inert
  after IM1. They stay in the file (undo semantics unchanged); a prune is
  the same separate task.
- (checker-tests F3) A CSV record shorter than the Date column index keeps
  a row with a zero Date (`loader.go:522` on master); `coverageOf`'s
  `IsZero()` guard makes it harmless for IM1. Latent parser wart,
  pre-existing.
- (checker-tests F4 / checker-second) The AC12 grep is split across two
  source lines in `files.go` (pre-existing), so it never matched there;
  `README.md:136,431` and `server.go`'s `serverInstructions` describe the
  raw-vs-loaded mismatch only generically and were left alone. Consider
  one sentence each in a docs pass.
