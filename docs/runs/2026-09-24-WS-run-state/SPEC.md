# SPEC.md — What-if save-path integrity (WS run, "run A")

Run prefix: **WS**. Target repo: `/home/darrell/bin/ai/budget2`
(github.com/dgallion1/simpleBudget). Base commit **643fa54** (master = live
:8080, 2026-09-18, PR #119). This run's `.swarm/` lives in the agents2
worktree `.claude/worktrees/budget2-what-if-review-24ec2e` (gitignored).

## 0. Status

**Closed 2026-09-24.** All five tasks accepted at Tier 3; `gate.sh done`
exit 0; `gate.sh stats` first-attempt clean 2/5.
- WS2 (58ad664), WS4 (c0eda67), WS3 (8b02147; D3′) → simpleBudget PR #120,
  MERGED 72c7e7f, DEPLOYED :8080 2026-09-24 08:53.
- WS1 (a12477f, attempt 6) → PR #121, MERGED ba952f4 2026-09-24 (not yet
  deployed at close).
- WS5 (d9bf7ef on `fix/ws5-glide-persons`, attempt 7, after two user
  reopenings — rulings 2026-09-24g–m) → third PR pending the user.

Signed off by user 2026-09-23 ("go": D1–D8 as proposed). Worktrees `.worktrees/ws1`…`ws4` created off 643fa54 (branches `fix/ws1-value-fidelity`, `fix/ws2-start-date`, `fix/ws3-chain-guardrails`, `fix/ws4-error-display`); `.worktrees/ws5` off a12477f (`fix/ws5-glide-persons`).

Origin: the 2026-09-22 read-only review of /whatif (three reviewers on
isolated sandboxes; lead source-verified every P1 below). The user chose
"run A" = the save-path bugs: values the page rewrites or refuses to save,
schedules that drift, a crash that bricks the page, errors nobody sees. The
figure bugs (run B), a11y sweep (run C) and product questions (D) are out of
scope here (§7).

### Decisions the user confirms at sign-off

| # | Decision | Proposed |
|---|----------|----------|
| D1 | WS1 scope | **Every** stored numeric field that /whatif renders as a named input (≈30 inputs across 8 templates + Quick Adjust), not just healthcare + cost basis. Rule: an untouched input never changes the saved value and never blocks the form. |
| D2 | Manual start-date change | Every scheduled item keeps its **calendar month** — the same re-anchoring the monthly rollover already does (`shiftScheduleOffsets`), including its clamping: an income/expense that would start before the new start is "already running"; one that ended is "finished"; a one-time / big-ticket item before the new start is kept but never charged. Roth-conversion "years from now", ages and SS are untouched (same as rollover). |
| D3 | Chain step guardrails | After a transition, the **active step's own** guardrail setting governs: off/missing → living budget at plan (multiplier 1.0) for that step; on, when the earlier step had none → guardrails start at the transition, baseline = portfolio that month. |
| D4 | Failed analysis | GET /whatif still renders the inputs column (incl. the Scenario Chain card, so the user can undo) with the error shown in the results area — never a bare 500 page. |
| D5 | Error display | A rejected request shows its message **next to the form that sent it** (role=alert), not a page-top banner; a rejected Add form keeps what was typed; a browser-rejected value shows the browser's own message. |
| D6 | Glide path | Ticking the box only **reveals** the fields; nothing saves until "Apply Glide Path" with Start %, End % and Years all filled. Unticking saves immediately (safe). The live plan's leftover disabled `{0 %, 0 %, 1 yr}` config is never re-activated by a tick. |
| D7 | Removing a person | Saves immediately. If a healthcare entry is linked to that person, the removal is refused with a message naming the entry ("remove Christine's healthcare entry first"). Filing status / SS spouse fields are not auto-changed (out of scope). A new person row with a name but no birth month is not submitted (browser "required" message) — never a 500. |
| D8 | Tiers | WS1 T3, WS2 T3, WS3 T3, WS4 T2 `tests,a11y`, WS5 T2 `tests,second,a11y` (table §3). |

Foreign territory notice: `/home/darrell/bin/ai/budget2/.worktrees/apply-names`
(branch `feat/apply-button-names`) and three detached `.claude/worktrees/*`
exist in the target repo. This run never touches HEAD, branches, stash or
index of the main checkout. The live server on :8080 keeps running from the
main checkout throughout; no checker or oracle ever contacts :8080 or uses a
budget2 MCP tool (they hit :8080).

## 1. Facts (verified in code at 643fa54, 2026-09-22/23)

### Value fidelity (WS1)
- LIVE: `rate-assumptions.html:222` Cost Basis `step="1000"`, value
  `printf "%.0f"`; saved `taxable_cost_basis` = 276146.86 → renders 276147,
  stepMismatch → the whole 34-field form (`rate-assumptions.html:7`,
  `hx-post="/whatif/settings"`) fails HTML validation and htmx sends nothing.
  Reproduced on a sandbox (reviewer): Filing Status change → no POST.
- `healthcare-person.html:79,116,141` named `type=range` step=50,
  max 3000/3000/2000, value `%.0f`: the browser sanitizes the value onto the
  step grid and clamps to max, so saved 1655.30 submits 1650 and 4500 submits
  3000 on ANY change to that card. Pre/post-Medicare inflation ranges
  (`:101,126,151,164`) step 0.5 with `%.1f`. Quick Adjust mirrors at
  `quick-adjust.html:270,298,311,325,340,354` (unnamed, keyed by
  `data-quick-adjust-key`).
- Established fix pattern (W2 Part B): `portfolio-settings.html:55-79` +
  `living_expenses_snap_trap_test.go` — the range has NO name; a hidden input
  carries the exact saved value (`printf "%.2f"`) and changes only on a real
  drag; `aria-valuetext` carries the exact figure.
- Other rewrite/block sites (full enumeration by the lead, 2026-09-23):
  `portfolio-settings.html:45` portfolio_value named range step=100000;
  `:88` property tax number step=1 `%.0f`; `:96` property tax inflation
  step 0.1 `%.1f`; `rate-assumptions.html:106,117` allocation % step=1 `%.0f`
  (live saved tax_deferred_percent = 83.037 → 83); `:187` state tax step
  0.05; `:203,209,215` dividend/qualified/cap-gains; `:244` ACA credit
  step=100; `:288-382` per-account allocation step=1 `%.0f`; `:442,471,507`
  inflation / spending decline / return ranges; `healthcare-person.html:181`
  care cost step=50; `social-security.html:16,71` benefits `%.0f` step=1
  (saved 4114.90 → 4115); `:40` COLA; `guardrails.html:27-81` pct fields
  `%.0f` step=1; `roth-conversion.html:50` amount `%.0f`;
  `spending-phases.html:72` multiplier range step 0.05.

### Start date (WS2)
- Schedules are stored as month OFFSETS from `StartDate`
  (`settings_current_month.go:28-33`, `MonthOffset`).
- The monthly rollover re-anchors them: `resolveCurrentMonth`
  (`settings_current_month.go:95-107`) → `shiftScheduleOffsets` (`:49`).
- A manual edit does not: `UpdateSettingsWithPersons`
  (`settings.go:1435-1449`) sets `settings.StartDate = startDate` with no
  shift → every schedule moves by the delta (reviewer: 2026-09 → 2027-01
  moved every item +4 months).
- Start date input is `readonly` while "Use current month" is on
  (`rate-assumptions.html:19`).

### Chain crash (WS3)
- `engine/stepper.go:188-189` creates `st.Guardrails` from the PRIMARY
  settings; `:303-306` evaluates with the ACTIVE step's `s.Guardrails`;
  `:330-335` derives triggers from `s.Guardrails`. A step whose settings
  have `Guardrails == nil` → nil deref (`guardrails.go:47`) → panic →
  "analysis computation failed".
- Live: Current Plan has guardrails enabled; Job loss (`whatif_job-loss.json`)
  has none and chains into Current at age 70 (no crash in that direction —
  guardrails simply never start). Current → Job loss crashes.
- `handleWhatIf` (`handlers.go:1319-1332`) renders only
  `renderError("Analysis failed…", 500)` on analysis error → the whole page
  is replaced; the chain card is unreachable (reviewer recovered with a
  direct `DELETE /whatif/chain/0`).

### Error display (WS4)
- `base.js:12-19`: a 4xx with `HX-Retarget` is swapped AND marked
  `isError = false` → htmx reports `successful` → the add forms'
  `hx-on::after-request="if(event.detail.successful) this.reset()"`
  (`income-sources-list.html:201`, `expense-sources-list.html:135`,
  `onetime-card.html:69`, `bigticket-card.html:114`, `healthcare-card.html:25`)
  wipe the user's input under the error.
- 106 `renderError` call sites in `internal/handlers/whatif/*.go`, 48 via
  `renderRetargetedError` (`handlers.go:1122`); the rest are not swapped by
  htmx 2 (error responses don't swap by default) and only reach
  `console.error` (`base.js:31-33`).
- Browser-invalid values (e.g. property tax −500) are never sent and nothing
  is shown (htmx validation halts silently).
- `renderError` markup (`handlers.go:1110`) has no `role="alert"` (backlog).

### Glide path + persons (WS5)
- `rate-assumptions.html:400-404`: the checkbox does
  `onchange="this.form.requestSubmit()"`; fields render only when enabled, so
  the first tick posts `enabled=on` alone. `handleWhatIfGlidePath`
  (`handlers_rates.go:425-459`) keeps any existing config. LIVE plan has
  `glide_path {enabled:false, start 0, end 0, transition_years 1}` → a tick
  runs 0 % stocks after year 1 (reviewer: End Balance $3.05M → $0.71M).
- `whatif-rate-assumptions.js:22-29` `removePersonRow` removes the DOM row
  only — no change event, nothing saved; the person returns on reload.
- `prepare/validate.go:72-76` rejects a healthcare person whose `person_id`
  is not in `Persons` → a removal of a linked person would fail validation.
- A new person row posts on the name's change event before a birth month
  exists → 500 (should never be a server error).

## 2. Tasks

Common rules for every task: work only in the task's worktree; run
`go test ./internal/handlers/whatif/... ./internal/services/retirement/...`
plus any package you touch, `make check`; any Tailwind class added → `make
css` + `make check`; permanent tests must KILL the named mutations; never
start a server on :8080, never run the repo-root `./budget2`, any sandbox
server uses `BUDGET_DATA_DIR`/`BUDGET2_BACKUP_DIR`/`BUDGET2_IMPORT_DIR` on a
`cp -rL` copy and `BUDGET_LISTEN_ADDR=127.0.0.1:<free port>`. Write the
manifest `.swarm/manifests/<task>.<attempt>.files` (one repo-relative path per
line, every file changed).

### WS1 — Untouched inputs never rewrite or block the saved plan (Tier 3)
Scope: every named `input`/`select` in the /whatif forms that carries a
stored numeric value (enumeration §1), plus Quick Adjust's mirrors.
Acceptance:
1. Round-trip identity: for a plan whose every stored numeric field is
   off-grid / fractional / above the old slider max, submitting any /whatif
   form exactly as the browser would (FormData of the untouched rendered
   form) leaves every stored value unchanged (float-equal).
2. No stored value makes a form invalid: `form.checkValidity()` is true for
   every rendered /whatif form on that plan.
3. Touched path still works: moving each healthcare cost slider (and the
   portfolio slider) to a new value — directly and via its Quick Adjust
   mirror — saves exactly that value.
4. Each visible figure next to a converted slider shows the exact saved
   value (e.g. "$1,655.30" or "$1,655" per the existing display formatter —
   no new formatter), and the range's `aria-valuetext` carries it.
5. Permanent Go tests: at least one off-grid round-trip test per template
   family touched, killing: (a) restoring `name=` on a healthcare range,
   (b) restoring `step="1000"` on cost basis, (c) `%.0f` on an allocation %.

### WS2 — A manual start-date change keeps every schedule on its calendar month (Tier 3)
Acceptance:
1. Changing Projection Start Date (use-current-month off) from S to S' leaves
   every income source's Starts/Through, every expense's Starts/Through,
   every one-time expense's month and every big-ticket item's month
   rendering the SAME calendar month as before, except items D2 clamps.
2. Saved offsets move by exactly −delta via the SAME `shiftScheduleOffsets`
   the rollover uses (one conversion rule, not two); both directions
   (later and earlier start).
3. Unchanged start date → zero shift; a use-current-month plan is untouched
   by this path.
4. Permanent test killing: (a) removing the shift call, (b) shifting by
   +delta instead of −delta.

### WS3 — A chain step never crashes the projection; a failed analysis never bricks the page (Tier 3)
Acceptance:
1. A → B chain where A has guardrails enabled and B has none: GET /whatif is
   200, Year-by-Year renders, and no "×" guardrail multiplier appears in any
   year after the transition year.
2. B → A (guardrails only in the later step): guardrails can act after the
   transition (D3); none before.
3. D4: when analysis fails for any reason, GET /whatif returns the page with
   the inputs column and Scenario Chain card rendered and the error in the
   results area.
4. Permanent tests killing: (a) removing the nil guard, (b) evaluating with
   the primary settings' config instead of the active step's.

### WS4 — Request errors are visible and never wipe input (Tier 2, `tests,a11y`)
Acceptance:
1. A rejected Add (income/expense/one-time/big-ticket/healthcare) keeps every
   typed value and shows the server message next to that form; an accepted
   Add still clears the form.
2. A non-retargeted 4xx/5xx from any /whatif request shows its message next
   to the triggering form (role=alert); a later success from that form
   clears it. Example: income Through before Starts → "Through month cannot
   be before the start month" visible on screen.
3. A browser-invalid value shows the browser's validity message
   (`reportValidity`) instead of silently not saving.
4. `renderError` output carries `role="alert"`.
5. JS tests (node, like `busy-banner.test.cjs`) for 1–3 + Go test for 4;
   checker-a11y confirms announcement and focus are sane.

### WS5 — Glide path and person removal (Tier 2, `tests,second,a11y`)
Acceptance: D6 and D7 exactly. Tests kill: (a) re-adding
`requestSubmit()` on the checkbox, (b) accepting an enable with missing
fields, (c) `removePersonRow` without a save, (d) linked-person removal
reaching a 500 instead of the named refusal.

### Reopened after hard stops — user decision 2026-09-23 ("Option 1": WS1 1, WS3 1, F1 1)

**F1:** kept as signed (D2 clamp). Round-trip loss for items before a new,
later start → backlog.

**WS1 attempt 3 contract (rewrite of criteria 4 and 7, additions to 6):**
- R-FMT. ONE whole-dollar rounding rule for every surface that shows a
  stored value in whole dollars: Go `formatNumber`'s (`%.0f`, round-half-even
  at an exact .50). Every such surface uses it — slider display spans, their
  aria-valuetext, Quick Adjust displays and aria, Coverage Timeline entries,
  and the JS live formatter (`formatWholeDollars` / formatQuickAdjustDisplay
  currency paths) must produce byte-identical strings (half-even at .5). The
  served HTML and the post-load DOM show the same string. This also fixes a
  pre-existing split on master: living expenses at an exact .50 showed
  half-up on its slider/QA and half-even elsewhere.
- R-EXACT. A stored value renders into an input as its shortest round-trip
  decimal (`strconv.FormatFloat(v,'f',-1,64)`) — never re-rounded. A derived
  or scaled value (e.g. COLA ×100) renders at 15 significant digits, trailing
  zeros trimmed, with no exponent. No float artifacts anywhere.
- R-TEST. The generic render→submit test's fixture is fractional in EVERY
  stored float field, renders an enabled glide path and an employer-coverage
  healthcare person, and asserts structural invariants for every named
  stored-value number input (step="any"; max ≥ the stored value; min ≤ it).
  Kills, one at a time, the 14 attempt-2 mutations plus: dropping step="any"
  on any one field, narrowing a max below the stored value, %.0f on a field
  whose fixture value is fractional, reverting formatExact to
  `math.Round(v*1e10)/1e10`, and a half-up JS or Go formatter on any one
  whole-dollar surface.
- Oracle v3 (`.swarm/tier3/WS1/`): fixture adds exact .50 values (portfolio
  2437512.50, living 10736.50, Medicare-coverage cost 612.50, Medicare cost
  2150.50, employer ACA cost 3450.50), cost basis 388354.59, glide path on,
  an employer-coverage person; new E6 (for each .50 value the half-up string
  appears nowhere, served or live, and the half-even string appears);
  MIN_FORMS 18. Validated: base FAIL (original defects + living-expenses
  split), attempt-2 tree FAIL (E6 ×5, E2 cost basis), crude prototype PASS.
- Dispatch: fresh worker (hard stop + contract rewrite), same worktree,
  keeping attempt-2 work.

- **2026-09-23m — WS1 attempt 3: a11y PASS, second FAIL (conceded) → second
  hard stop.** The worker implemented formatExact as `FormatFloat(v,'g',15)`
  for ALL values, against R-EXACT's explicit split (stored → shortest
  round-trip; scaled → 15 sig): a 17-significant-digit stored cost basis
  (232777.48988888797) renders re-rounded and an untouched save rewrites it.
  The oracle's 1e-9 identity tolerance hid it (drift 9.7e-10), and the same
  tolerance hid a 1-ulp COLA drift (render "1.45", server ÷100 →
  0.014499999999999999). Oracle v4: identity EXACT (no tolerance); fixture cost
  basis 232777.48988888797, Roth amount 388354.59. Validated: attempt-3 tree
  FAIL (exactly those 2 fields), R-EXACT' prototype PASS (90 checks), base
  FAIL. R-EXACT' for attempt 4: stored values `FormatFloat(v,'f',-1)`; the one
  scaled site (COLA ×100) renders at 15 sig with no exponent AND the server's
  ÷100 on save rounds to 15 significant digits so a ≤15-digit stored COLA
  round-trips exactly. Proposed attempt 4: resume the attempt-3 worker
  (narrow). Mechanism: second checker; oracle gap (tolerance) is a lead
  artifact.

- **2026-09-23n — WS1 attempt 3 checker-tests FAIL (conceded; same stop).**
  Adds: 16–17-digit stored values re-rounded (7 fields), exponent output
  ("5e-05"), five surviving single-surface half-up mutations (Coverage
  Timeline branches, QA phase-dollar label, two JS call sites), step="0.25"
  and %.1f mutations survive; living-expenses hidden input still %.2f (loses
  $0.004); min_monthly_spending_real step 0.01 blocks the guardrails form (also
  base); investment-return display "~6.2%" → "~6.1%" at load. Oracle v5 found
  the same class on one-decimal PERCENTS: Go %.1f (exact decimal half-even:
  7.25 → "7.2") vs JS toFixed (ties up: "7.3") — served ≠ live for
  pre-Medicare inflation and investment return; and the load-time sync
  rewrites server-rendered aria (investment return → raw "6.25").
  Oracle v5: second fixture variant "exact" (living 10736.504,
  tax_deferred_percent 83.03712345678912, dividend yield 0.00005, guardrail
  floor 6000.555, investment return 0) + E7 served == live for every Quick
  Adjust display + E2 flags exponent notation. Validated: attempt-3 tree FAIL
  (15), base FAIL (85), prototype PASS (276). Mechanism: primary checker +
  oracle v5.

**WS1 attempt 4 contract (supersedes R-EXACT; extends R-FMT and R-TEST):**
- R-EXACT'. Every stored value rendered into an input (incl. the
  living-expenses hidden input) is `FormatFloat(v,'f',-1)` — never
  re-rounded, never exponent. The one scaled site (COLA ×100) renders at 15
  significant digits via 'f' (no exponent), and the server's ÷100 on save
  rounds the result to 15 significant digits, so a stored COLA with ≤15
  significant digits round-trips exactly. Identity is EXACT (no tolerance).
- R-FMT'. Server-rendered display text and aria-valuetext are authoritative at
  load and after an htmx swap: the Quick Adjust load/after-swap sync must not
  rewrite any display text or aria-valuetext (it may still sync mirror
  values/min/max/step). Live updates on user input must produce exactly the
  string the server would render: whole dollars = Go formatNumber
  (half-even); one-decimal percents = Go %.1f, i.e. exact-decimal half-even
  (JS must round the exact binary value — not toFixed, not x*10 — e.g.
  7.25 → "7.2", 4.35 → "4.3", 3.85 → "3.9"); a derived figure (expected
  return) is never recomputed client-side at load.
- R-TEST'. Structural invariant over EVERY named stored-value number input
  (not a list): step="any", min ≤ value ≤ max. Go/node tests kill, one at a
  time: half-up on each individual whole-dollar surface (every Coverage
  Timeline branch, in-card and QA phase-dollar labels, each JS call site),
  toFixed/x*10 in the JS percent path, 'g',15 for a stored value, %.2f on the
  living-expenses hidden input, step="0.25"/step="0.01" on any stored field,
  %.1f on any stored field, exponent output, a load-time display/aria
  rewrite. Plus everything R-TEST required before.
- Oracle v5 must PASS (both variants). Dispatch: resume the attempt-3 worker
  (narrow, spec-driven) once the user approves.

- **2026-09-23p — WS1 attempt 4: a11y PASS; second FAIL (lead would
  OVERRULE → judge panel pending checker-tests).** The FAIL: the new JS
  exact-decimal formatter returns "0.0" where Go %.1f returns "-0.0" for
  negative values in (-0.05, 0) (1,014 of 32,465 swept values; all others
  byte-identical). Lead's reachability evidence: every range feeding that
  formatter — inflation-rate-slider, spending-decline-slider,
  healthcare-{pre,post}-medicare-inflation-{ID} and their qa-* mirrors — has
  min="0", so user input can never hand it a negative; at load and after
  swaps the sync is mirror-only (R-FMT') and never rewrites the served
  "-0.0%". R-FMT' constrains live updates ON USER INPUT, which cannot reach the
  divergent domain. Pre-existing: Go renders a stored -0.03 as "-0.0%" (base
  too) → backlog.

- **2026-09-23q — WS1 attempt 4: checker-tests FAIL (conceded) → third hard
  stop.** Product behaviour meets every criterion (oracle v5 276/0; COLA exact
  over 211,000 values; a11y PASS), but R-TEST' is unmet: 35 named-class mutants
  survive the full go+node suite — %.1f on 19 of 42 exact-render sites (test
  fixtures hold ≤1 decimal there; proven real: 5.55 → 5.5 and 1655.35 → 1655.3
  on an untouched save), a load-time investment-return rewrite placed outside
  whatif-quick-adjust.js (node harness never loads whatif-rate-assumptions.js),
  JS call sites P5 (toFixed on expected return) and J6 (half-up aria currency),
  and the never-rendered Medicare-coverage branch. Lead ruling on the primary's
  O1: dragging investment return to 0 shows a client-recomputed "(~6.1%
  expected)" vs the server's "(~6.2%)" — a live update that differs from the
  server string → IN scope under R-FMT' (pre-existing on base, now required).
  Same class for the third time (tests that do not generalise) → the contract
  must name the kill list explicitly and the fixture shape (≥2 decimals or
  16–17 digits on EVERY exact-render field; a Medicare-coverage person) rather
  than the class. The second checker's "-0.0" FAIL is moot (task fails anyway);
  cheapest resolution is a one-line JS sign fix in attempt 5. Mechanism:
  primary checker.

**WS1 attempt 5 contract (user: "1 and 2", 2026-09-23 — reopen WS1 AND ship
WS2/WS3/WS4 as PR #120 now):** attempt-4 code stands; this attempt is
- two code fixes: (C1) the live investment-return display at 0 shows the
  SERVER's expected-return figure (server-provided, e.g. a data attribute
  rendered with the same %.1f as the served text) — never
  calculateExpectedReturnFromAllocation's client recompute (its `|| 10` /
  `|| 60` fallbacks treat a 0 allocation as missing); (C2) the JS
  exact-decimal formatter keeps the sign exactly as Go %.1f does (negative
  values rounding to zero render "-0.0", as the server does), closing the
  WS1.4 second-checker dispute;
- tests with an EXPLICIT kill list (each applied alone must fail the go+node
  suite): %.1f on each of the 19 surviving exact-render sites listed in
  WS1.4.checker-tests.verdict (guardrails.html:27/47/54/67/73;
  healthcare-person.html:84/135/211; rate-assumptions.html:117/209/289/320/
  329/374/383/411/487; roth-conversion.html:51; social-security.html:17);
  R5 (DOMContentLoaded recompute in whatif-rate-assumptions.js) and R6
  (syncAll re-calling updateInvestmentReturnDisplay) — the node harness must
  load whatif-rate-assumptions.js; P5 (toFixed on expected return) and J6
  (half-up in syncQuickAdjustAriaValueTexts currency path); U12 (name= on the
  Medicare-branch post_medicare_inflation range) and %.1f on its hidden
  input; the C1 regression (client recompute on a drag to 0) and the C2 sign
  (negative → "-0.0"); plus every mutation previously killed stays killed.
  Fixture rule: EVERY exact-render field holds ≥2 decimals or 16–17
  significant digits in at least one generic-test fixture, and a
  Medicare-coverage person is rendered.
- Oracle v6: E8 (investment return dragged back to 0 shows the served text;
  exact variant now has zero allocation fields as on the live plan).
  Validated: attempt-4 tree FAIL (E8 only), prototype PASS, base FAIL (86).
- Dispatch: resume the attempt-4 worker.

- **2026-09-23r — WS1 attempt 5: a11y PASS; second FAIL — lead would OVERRULE
  (panel pending checker-tests).** The FAIL: with investment return 0, typing
  into an account allocation no longer live-updates "(~X% expected)" (it
  updates after the debounced save's OOB swap); master updated per keystroke
  via calculateExpectedReturnFromAllocation. Lead's position: attempt 5's C1
  is the later, specific ruling for this reopened attempt ("never
  calculateExpectedReturnFromAllocation's client recompute") and controls over
  WS1's earlier general C5 ("existing behaviour kept") — precedent 2026-08-29c/d;
  master's live figure was WRONG on zero allocations (the live plan has
  them), so the per-keystroke preview was showing a false figure; the served
  figure arrives after the save. C2 verified fixed (0 mismatches over 113,012
  values). Backlog candidate: an accurate client preview computed by the
  server's formula (would need one-formula parity tests).

- **2026-09-23s — WS1 attempt 5: checker-tests FAIL (conceded) → fourth hard
  stop.** Code correct everywhere (oracle v6 277/0, C1 correct on the live-data
  copy incl. after swaps, C2 0 mismatches over 88,343 values, fixture rule on
  all 43 sites, 27/27 named mutations killed), but the kill-list item "the C1
  regression" survives in its Quick Adjust form (C1k: client recompute on the
  QA display only) — the node fake DOM's closest() always returns null so the
  QA branch never runs; no Go test pins data-expected-return. The second
  checker's allocation-typing FAIL (2026-09-23r) is moot for acceptance but
  needs a user product ruling. Oracle v7: E8b — every investment-return
  display (in-card AND Quick Adjust) equals the served text after a drag back
  to 0. Validated: attempt-5 tree PASS, C1k mutant FAIL ("~6.1%" vs "~6.2%" on
  the QA display). Mechanism: primary checker.

- **2026-09-24a — user ruling ("a, go"): WS1 attempt 6, test-only.** With
  investment return at 0, the "(~X% expected)" figure updating when an
  allocation edit SAVES (the served figure after the OOB swap), not per
  keystroke, is ACCEPTED product behaviour — this settles the WS1.5
  second-checker finding (no panel needed; the user's explicit scope for the
  reopened attempt controls, precedent 2026-08-29c/d). Attempt 6 scope,
  nothing else: (1) a node test that runs the Quick Adjust branch of
  updateInvestmentReturnDisplay (a DOM where closest('#quick-adjust-panel')
  resolves) and kills C1k; (2) a Go render test pinning data-expected-return
  on both displays to the served "%.1f" figure; production code unchanged.
  Oracle v7 must PASS. Resume the attempt-5 worker.

- **2026-09-24b — WS1 accepted at Tier 3, attempt 6 (92178c1).** Test-only
  attempt (QA-branch C1 node test; Go pin of data-expected-return on both
  displays). checker-a11y PASS, checker-second PASS, checker-tests PASS on a
  throttled re-run (the first tests checker was stopped at the user's
  request: its parallel 327-mutation harness drove load to 173 on 32 cores;
  its "oracle failed" note was a load-induced timeout — the quiet re-run
  passed 278/0). 22 targeted mutations killed. Backlog (primary O1–O3): the Go
  test pins the attribute's value not its element; the node test does not
  assert the QA range's aria text; the in-card sentinel "6.2" is a plausible
  real figure. Process lesson → memory throttle-heavy-verification. Mechanism:
  primary + second checkers across attempts; oracle v1–v7.

- **2026-09-24c — WS5 attempt 1: checker-second FAIL — lead would OVERRULE
  (premise false).** Claim: the new `required` birth month on a fresh person
  row blocks every unrelated save in the Rate Assumptions form ("newly
  introduced regression"; its control run had NO added row). Lead reproduced
  the same sequence on the pre-WS5 base (fix/whatif-save-path-2) on a
  live-data copy: "+ Add Person" then edit tax_deferred_percent → POST
  /whatif/settings 500 "Failed to save settings: persons: name is required",
  edit NOT saved (83.037 unchanged). The blocking predates WS5; WS5 turns the
  500 into the browser's required-field message on the missing field, exactly
  as D7 specified ("not submitted (browser 'required' message) — never a
  500"). Panel pending the other two WS5 checkers. Evidence:
  scratchpad/checkers/WS5.1-second/p-base.mjs (lead run, base build).

- **2026-09-24d — WS5 attempt 1: a11y FAIL + tests FAIL (both conceded).**
  checker-a11y (ACCESSIBILITY.md 6 / WCAG 3.3.2): the revealed glide fields
  are required by the server but carry no required indication. checker-tests
  4(b): omitting only Start % or only End % survives the suite (live copy
  saved {enabled, 70, 0, 10}). Also pulled into scope ("never a 500"): a
  birth-month-less person row posted directly still returns 500. The second
  checker's FAIL is settled by 2026-09-24c (pre-existing; D7 as specified) and
  is NOT a basis for attempt 2. Backlog: a removal clicked during an in-flight
  save is silently dropped (base too); Remove buttons' accessible name lacks
  the person's name; focus after a SUCCESSFUL removal falls to <body> (base
  too). Mechanism: checker-a11y + primary checker.

- **2026-09-24e — WS5 attempt 2: second FAIL (conceded); gate escalated WS5
  to Tier 3 (two consecutive fails).** personsSaveErrorMessage matched any
  "birth_month" text, so "birth_month X is after start_date Y" became the false
  "Each person needs a birth month". Oracle `.swarm/tier3/WS5/accept.sh`
  written (G1 tick sends nothing / leftover untouched / revealed fields
  required + instruction; G2 each single missing field → 400 via direct POST;
  G3 Apply saves; G4 untick saves; P1 unlinked removal persists; P2 linked
  removal → 400 naming the entry, row kept; P3 name-only row sends nothing,
  direct birth-month-less row → 400 naming the birth month, birth month after
  start → 400 with an accurate message). Validated: base FAIL 14 (incl. the
  live hazard: one tick saved {enabled:true,0,0,1}), attempt-2 tree FAIL 1
  (exactly P3c), prototype (classifier distinguishes "is after start_date" from
  "month is required") PASS 16. Mechanism: second checker + gate.

- **2026-09-24f — WS5 attempt 3: checker-tests FAIL (conceded) → hard stop
  (three failed attempts).** a11y PASS, second PASS (naming logic sound under
  duplicates/reordering/escaping), all oracles PASS (WS5 16, WS1 278, WS2 85),
  31 mutations killed. The miss: prepare.ValidatePersons returns "invalid
  birth_month for %q" for BOTH an empty and an unparseable month; the handler
  maps both to "Each person needs a birth month" — false when a value was
  entered (reachable: a five-digit year in a type=month field gives
  "19711-08"); start_date errors come back as "Invalid person data". Same
  class as attempt 2 (persons message accuracy) → spec defect: the contract
  said "enumerate every error class" but ValidatePersons' classes are not 1:1
  with user situations; the message must be worded from the SUBMITTED value
  (empty vs present-but-invalid), not from the error text alone. Mechanism:
  primary checker.

- **2026-09-24g — WS5 reopened by the user ("1"): attempt 4 contract.** Word
  every persons/start-date 400 from the SUBMITTED value: a person whose
  submitted birth month is empty → "<Name> needs a birth month"; present but
  unparseable → "<Name>'s birth month "<value>" isn't a valid month" (or
  equivalent — must name the person and must not say it is missing); birth
  month after the start → the attempt-3 message; an invalid projection start
  date → a message about the START DATE (never "Invalid person data"); other
  persons errors stay truthful. Oracle v2 adds P3d (unparseable month) and P3e
  (invalid start date). Validated: attempt-3 tree FAIL (exactly P3d, P3e),
  prototype PASS 18, base FAIL 16. Resume the attempt-3 worker.

- **2026-09-24h — WS5 attempt 4: second FAIL; lead would OVERRULE; panel
  UPHELD 2–1 → second hard stop.** tests PASS, a11y PASS, oracle v2 PASS 18.
  checker-second: rePersonsInvalidBirthMonth captures the name as `[^"]*` out
  of a %q-formatted error, so a name containing `"` misses and falls back to
  "Invalid person data: …" (empty month → no "needs a birth month"). Lead's
  overrule premise ("truthful, only polish") was REFUTED: judge-claude showed
  the escaped capture is compared with raw names, so `Pat\X` "19711-08" beside
  `Pat\\X` "1990-01" (browser-reachable) says `Pat\\X's birth month "1990-01"
  isn't a valid month` — a FALSE message about the wrong person; `\`, tab and
  NBSP names garble too. judge-standards: the empty-month clause has no "or
  equivalent" latitude. judge-impact OVERRULE (truthful for `"`, no real name
  affected). Gate: "judges upheld the FAIL (1 overrule / 2 uphold)". Third
  failure of one class (attempts 2, 3, 4: persons message accuracy) → spec
  defect: every contract so far let the handler recover WHICH person failed
  by parsing prepare.ValidatePersons' error text. Mechanism: second checker +
  judge panel (judge-claude found the false message the lead missed).

- **2026-09-24i — WS5 reopened by the user ("1 and 2"): attempt 5 contract
  (rewrite — identify the failing person by ID, never by error text).**
  Keep every attempt-4 glide (D6) and person-removal (D7) change; only the
  persons error-message path changes.
  - I1. prepare.ValidatePersons returns an exported typed error (errors.As)
    for each per-person birth-month failure — unparseable/empty AND after the
    start date — carrying the failing person's ID (and, for after-start, the
    start date it compared against). The ID is always unique there:
    parsePersonsForm gives every new row a UUID, and ValidatePersons checks
    ID uniqueness before birth months. The invalid-start-date case is typed
    too (type or errors.Is sentinel).
  - I2. The handler finds the failing row ONLY by that ID in its own
    submitted slice. No regexp, strings.Contains/HasPrefix, Sscanf or other
    parsing of error text may identify the person or choose between the
    empty / unparseable / after-start / start-date cases;
    rePersonsInvalidBirthMonth and rePersonsBirthMonthAfterStart go. (The
    remaining ValidatePersons shapes — no persons, id/name required,
    duplicate id, role, primary/spouse count, healthcare link — may keep the
    truthful "Invalid person data: <text>" 400 fallback.)
  - I3. Wording, from that row's SUBMITTED Name and BirthMonth printed
    VERBATIM (no %q or other Go escaping — html/template escapes at render):
    empty → `<Name> needs a birth month`; present but unparseable →
    `<Name>'s birth month "<value>" isn't a valid month (use YYYY-MM)`;
    after start → `<Name>'s birth month (<value>) is after the plan's start
    date (<start>)`; invalid start date → attempt 4's start-date message.
  - I4. The Error() text of EVERY ValidatePersons return stays byte-identical
    — its consumers read the text: saveInternal → every UpdateSettings*
    caller incl. MCP apply_changes; the load-time pass (settings.go:475);
    prepare.From's "prepare.From: validate: %w". errors.As must see through
    that wrap.
  - I5. Permanent Go tests: (a) through the real POST handler, names plain,
    `Robert "Bob" Smith`, `Pat\X`, `Ann<TAB>Lee`, `Ann<NBSP>Lee`, `Sam": X` ×
    {empty, "19711-08", after-start "2030-01"} → 400 + exact text; (b)
    `Pat\X` "19711-08" beside `Pat\\X` "1990-01", and two rows named "Pat
    Twin" (valid, then "19711-08") → the failing row's name and value only;
    (c) Error() text pinned for every ValidatePersons shape + errors.As
    through prepare.From. Named mutations that must die: identify by Name
    instead of ID; %q on name or value; changed Error() text; swapped
    empty/unparseable branches; the after-start case left untyped.
  - Oracle v3 adds P3f (quoted name, empty month; the `Pat\X`/`Pat\\X`
    pair; the "Pat Twin" duplicate). Validated: attempt-4 tree FAIL exactly
    P3f ×3 (the judges' reproductions), prototype (typed error + ID lookup)
    PASS 21, base FAIL 19; prototype discarded. The judge's strconv.Unquote
    patch would still fail the duplicate-name check — intended.
  - Dispatch: fresh worker (hard stop + contract rewrite), same worktree
    `.worktrees/ws5` (attempt-4 work uncommitted there).

- **2026-09-24j — WS5 attempt 5: behaviour PASS everywhere; checker-tests
  FAIL on I5 only (conceded) → third failed Tier-3 attempt, halted for the
  user.** Oracle v3 PASS 21 (lead run), second PASS (duplicate-ID order,
  resolveCurrentMonth timing, nil safety, Error() byte-identity), a11y PASS,
  tests criteria 1–4, 6, 7 PASS (Error() text for 196 inputs byte-identical to
  base; 63 handler + 21 Chromium cases exact). The I5 gaps: (1) M2 "%q on the
  VALUE" survives — every test value (`19711-08`, `2030-01`, empty) is
  %q-invariant, so `1971\08` would render escaped unnoticed; the lead's I5
  wording "%q on name or value" let the worker read "or" as either-one; (2)
  I5(a)'s `Ann<NBSP>Lee` case is an ordinary space (bytes 41 6e 6e 20). Also
  the handler comment at handlers_rates.go:84-91 still says "plain, untyped
  error" and "prepare/validate.go … untouched" — both now false.
  Observations (not in contract): sibling S1 (after-start row found by
  position) and S2 (Unwrap removed) survive. Different class from attempts
  2–4 (test coverage, not message accuracy). Mechanism: primary checker.

- **2026-09-24k — user ruling ("1"): WS5 attempt 6, TEST-ONLY.** Resume the
  attempt-5 worker. Scope: (1) a test that fails when %q is applied to the
  submitted VALUE in the unparseable-month message (values %q changes, e.g.
  `1971\08` and `19"71-08`); (2) the I5(a) NBSP name written as a real
  U+00A0, with a guard asserting the byte is present; (3) the stale comment
  at handlers_rates.go:84-91 corrected. No other product-code change; oracle
  v3 unchanged; all three checkers fresh at attempt 6.

- **2026-09-24l — WS5 attempt 6: tests FAIL + second FAIL (both conceded) →
  fourth failed Tier-3 attempt, halted for the user.** a11y PASS; oracle PASS
  21; item (1) PASS (M2-on-value now killed by
  ..._UnparseableValueSpecialChars); scope PASS (comment-only token streams
  identical); regressions M1–M5 still killed; make check / node PASS.
  Failures: (a) the NBSP name and the guard's rune are RAW U+00A0 bytes
  (`c2 a0`, lead-verified with od -c), not the `\u00a0` escape the worker
  reported — the escape was almost certainly decoded to the raw character in
  the tool-call JSON, so the guard compares the file with itself and a
  NBSP→space normalisation passes every test; (b) the new comment says all
  three typed errors carry the failing row's ID — InvalidStartDateError has
  none. NBSP encoding failed twice (attempts 5, 6) → brief defect: "write it
  as a Go escape" is not transmissible through tool JSON. Contract fix: build
  the name from ASCII only (`"Ann" + string(rune(0x00A0)) + "Lee"`), guard
  with the integer literal 0x00A0, and the test file must contain no raw
  c2 a0 byte (lead checks with od/grep before dispatching checkers).
  Mechanism: primary checker + second checker.

- **2026-09-24m — user ruling ("7"): WS5 attempt 7, test + comment only.**
  Resume the attempt-6 worker with ruling l's contract fix: NBSP name built
  from ASCII (`string(rune(0x00A0))`), guard against the integer 0x00A0, no
  raw c2 a0 byte anywhere in the test file; comment clause corrected
  (InvalidStartDateError carries no ID). Lead verifies the bytes before
  checkers; oracle v3 unchanged; all three checkers fresh.

**WS3 attempt 3 contract (D3 replaced by D3'):**
- D3'. The VIEWED (primary) scenario's guardrail setting governs the whole
  chain; a chained step's own guardrail config is ignored (other step settings
  still apply). One predicate, evaluated on the primary settings, decides
  whether guardrails govern — used by the stepper (evaluation, cut/raise
  triggers), the spending floor, and Monte Carlo adaptive spending; every UI
  surface (chart trigger lines, summary caption, "next yearly check" anchors,
  events, verdict) already reads the primary settings and stays consistent.
  No nil dereference is possible for any step. D4 (failed analysis renders the
  full page) unchanged — keep attempts 1–2's D4 work.
- Tests kill: evaluating with the active step's config (A→Y must equal A);
  the spending floor from the active step; MC adaptive spending decided from
  the active step; restoring the nil deref; restoring the bare renderError
  page. Unchained plans stay byte-identical to base.
- Oracle v2 (`.swarm/tier3/WS3/`): variants a-alone (control), a-to-b, a-to-y
  (step guardrails very different), b-to-a, missing; per-year multipliers of
  a-to-b and a-to-y must EQUAL the unchained control; chart trigger lines
  present and never $0 (and no "$0.00" trigger text); b-to-a no multiplier
  and no trigger lines; D4 as before. Validated: base FAIL (a-to-b crash,
  a-to-y per-step, missing bricked), attempt-2 tree FAIL (per-step
  multipliers, $0 triggers, b-to-a cuts), D3' prototype PASS.
- Dispatch: fresh worker (hard stop + contract rewrite), same worktree.
- **2026-09-23l — WS3 attempt 3: second PASS, tests FAIL (conceded) → second
  hard stop.** Behaviour correct (both checkers; unchained plans byte-identical
  to base at MC seed 424242 incl. the live-data copy; A→B→Y and a scenario
  switch follow D3'; the pre-existing TestFloorActiveChainReplacement edit is
  exactly D3'). Gap: taking the spending floor from the chained step at the two
  guardrail-EVENT call sites (stepper.go:338-339) survives the suite and the
  oracle while making the Events list/caption disagree with the Year-by-Year
  table. Oracle extended (v3): events-list and caption equality with the
  control for a-to-b/a-to-y, plus a2-alone/a2-to-y where the primary's floor
  (9000) binds after the transition. Validated: attempt-3 tree PASS, that
  mutant FAIL (4 checks, "10 cuts" vs "1 cut"), base FAIL (12). Proposed
  attempt 4: test-only (resume the attempt-3 worker). Mechanism: primary
  checker.
- **2026-09-23o — WS3 accepted at Tier 3, attempt 4 (8b02147).** User
  approved ("go"). Test-only: engine + handler tests pin GuardrailEvents,
  the rendered Events list and the chart caption when the primary's floor
  binds after a transition; only the two test files changed vs attempt 3.
  Oracle v3 PASS; checker-tests PASS (16 single mutations killed incl. each
  event site alone; unchained plans byte-identical to base on 8 plans at MC
  seed 424242); checker-second PASS. Backlog: events template "% of plan"
  arithmetic has no absolute-value test (pre-existing); stale comments noted
  by the primary. Mechanism: primary checker (attempt 3) + oracle v3.

## 3. Tiers and dispatch

| Task | Tier | checks | Why (oracle / reversible / blast) | Wave |
|------|------|--------|-----------------------------------|------|
| WS1 | 3 | tests,second,a11y | rewrites the persisted plan (not reversible once saved); ~8 templates + JS | 1 |
| WS2 | 3 | tests,second | rewrites persisted schedule offsets; critical glob `settings.go` | 1 |
| WS3 | 3 | tests,second | critical glob `engine/**`; money figures after a transition | 1 |
| WS4 | 2 | tests,a11y | strong oracle, reversible, but `base.js` is sitewide | 1 |
| WS5 | 2 | tests,second,a11y | changes a projection-driving save (glide) + persons; after WS1+WS4 | 2 |

Worktrees: wave 1 = one worktree per task off 643fa54 (`.worktrees/ws1`…
`ws4`, branches `fix/ws<N>-…`) so each worker and checker has a clean tree;
the lead merges accepted tasks into `fix/whatif-save-path`; WS5 starts from
that branch after WS1+WS4 merge. Tier-3 oracles (`.swarm/tier3/WS<N>/
accept.sh`) are written and validated at both ends BEFORE each dispatch.

## 4. Rulings

- **2026-09-23a — oracle calibration (lead artifacts, caught by the both-ends rule).**
  (1) WS2 probe waited for a POST that the form never sends while typing:
  `hx-trigger="… input delay:500ms from:find input[type=number]"` watches only
  the FIRST number field; others save on change (blur) → probe now presses Tab.
  (2) WS1 fixture used a wrong JSON key (`taxable_capital_gains_distribution_rate`;
  the tag is `taxable_cap_gains_distribution_rate`) → a phantom "removed" diff.
  (3) WS1 fixture lacked `social_security.cola_rate_set` (F-026 bookkeeping the
  SS form sets on any explicit submit) → a phantom "added" diff.
  (4) WS1 probe's `waitForLoadState('networkidle')` resolves immediately after
  the first navigation, so a late results-full swap wiped a delayed form →
  two false "not sent" results; replaced by an in-flight request counter.
  Mechanism: oracle calibration (fail-end check that each failure is the
  defect). All four were in the lead's own oracle, none in the product.
- **2026-09-23b — calibration finding for WS1 brief.** The portfolio slider's
  step/max are rewritten by `updatePortfolioRange()` at load and on range-select
  change (whatif-portfolio-settings.js:10-20) — markup alone cannot fix it; added
  to the WS1 brief. Mechanism: oracle prototype (pass-end).
- **2026-09-23c — WS2 accepted attempt 1 (58ad664).** Both checkers PASS; the
  primary's F1 (the rollover clamp makes a later-then-back round trip lossy —
  an income running now can come back starting later) is a consequence of D2
  as signed, not a criterion failure → put to the user as a menu (keep /
  commit-on-blur + clamp warning / lossless negative offsets). F3 (rejected
  save leaks into the in-memory settings copy) and F4 (unparseable start date
  → 500) are pre-existing → backlog. Mechanism: primary checker.
- **2026-09-23d — WS3 attempt 1 sent back before checkers.** Oracle PASS, but
  the worker's own out-of-scope note was in scope: monte_carlo.go:439 decided
  "guardrails active" as `st.Guardrails != nil` while the stepper now uses the
  active step's config — after an on→off chain transition MC would suppress
  adaptive spending in an unguarded step (split classification, class 1).
  Resumed the same worker (attempt 2) to route both through one predicate.
  Mechanism: lead review of the worker report (the oracle could not see MC
  adaptive spending — oracle gap noted).
- **2026-09-23e — WS4 attempt 1 checker-a11y FAIL (conceded).** renderError's
  new role="alert" nests inside the four Add-form slots that already carried
  role="alert" → the same error is announced twice. Real, introduced by the
  diff (the worker had flagged the risk). Mechanism: checker-a11y.
- **2026-09-23f — WS4 attempt 1 checker-tests FAIL (conceded).** AC2's
  "nearest form/card" fallback used the triggering element's parent: a failing
  GET /whatif/poll (hidden sentinel, every 2 s) inserted a new alert as the
  first grid item of the page layout each poll (results pushed ~10,650 px
  down); a body-sourced htmx.ajax (spending trajectory) inserted into <html>
  before <head>. Lead ruling for attempt 2: inline display only for requests a
  user initiated from a form/control; sentinels (load/every/revealed) and
  body-sourced htmx.ajax keep existing handling; never insert into html/body/
  main/layout grid; no re-insert of a displayed message; text/plain bodies
  shown via textContent (observation O2). Mechanism: primary checker (real
  server errors via a crashing chain step from a second client).
- **2026-09-23g — WS3 HARD STOP (attempt 2, checker-second FAIL).**
  buildGuardrailChartSummary / buildProjectionChartData (handlers.go:570,650,
  844) gate trigger lines and the summary caption on the PRIMARY settings:
  on→off chains draw "Cut if balance ≤ $0.00" lines after the transition;
  off→on chains draw none although guardrails act. Same defect class as
  2026-09-23d (per-step guardrail governance decided in more than one place)
  → per CLAUDE.md this is a lead/spec defect: D3 made governance per-step but
  the contract never enumerated the renderers of guardrail state, and the
  oracle asserted only the Year-by-Year table. Two Tier-3 failures → halted
  and reported to the user with options (contract rewrite vs changing D3 to
  "the viewed scenario's guardrail setting governs the whole chain").
  Mechanism: second checker.
  WS3.2 checker-tests (landed after the stop) also FAIL on 5(b): the
  "primary config instead of active" mutation is killed only by a nil-config
  crash; with two steps that both have guardrails ON but different configs it
  survives the suite (as does deriving triggers from the primary). Same
  finding F-1 as checker-second (A→B "Next cut … $0.00"). Positive evidence to
  carry forward: unchained plans are byte-identical to base (full analysis,
  MC seed 424242, 6 fixtures). Any attempt 3 must add the two-configs test.
  Mechanism: primary checker.
- **2026-09-23h — WS4 attempt 2: a11y PASS, tests FAIL; gate escalated to
  Tier 3.** Behaviour correct on every path, but two single-guard R2 mutants
  (drop the user-initiated check; drop the forbidden-host check) survived the
  suite — the worker's tests placed their sentinels under hosts BOTH guards
  reject. Conceded. `escalate-scan` flagged two-consecutive-fails → tier 3
  (checks tests,second,a11y). Oracle `.swarm/tier3/WS4/accept.sh` written and
  validated: base 643fa54 FAIL (input wiped, no edit message, no
  reportValidity, no dedupe/plain-text display), attempt-2 tree PASS, M1
  mutant FAIL on "no background-failure message inserted anywhere". Attempt 3
  (same worker, resumed) = the two independent guard tests only.
  Mechanism: primary checker + gate.
- **2026-09-23i — WS1 attempt 1: a11y PASS, second PASS, tests FAIL
  (conceded).** Oracle 37/37 PASS, but the primary found: C6 — the
  "round-trip" Go tests never render a template (8 pass on base); named
  mutations killed only by single-field markup tests; 11 same-class mutations
  on sibling fields/families survive; C5 — three Quick Adjust regressions
  (portfolio range select no longer resizes the QA slider; QA investment-return
  drag no longer updates the display; QA portfolio drag no longer updates the
  per-account amounts); C4 — investment-return slider has no aria-valuetext;
  D4 — exact rendering exposes float artifacts (COLA 0.028 → "2.8000000000000003").
  The oracle missed all of these → extended with E1 (every converted slider and
  its QA mirror: aria-valuetext == own display), E2 (no float artifacts in
  values/aria/displays), E3–E5 (the three QA behaviours) and fixture COLA
  0.0145 (off the %.1f grid AND ×100 = 1.4500000000000002). Re-validated: base
  FAIL on the original defects only (E1–E5 PASS = existing behaviour kept),
  attempt-1 tree FAIL on exactly the primary's findings, crude prototype PASS.
  Attempt 2 is WS1's last Tier-3 attempt. Mechanism: primary checker; the
  second checker's dual-formatter note (.50 ties: formatNumber vs
  formatDollars, JS-reconciled) folds into E1/C4.
- **2026-09-23j — WS4 accepted at Tier 3, attempt 3 (c0eda67).** Test-only
  attempt; oracle PASS, checker-tests / checker-second / checker-a11y PASS.
  Backlog from the primary: exact-string role assertion (attribute order
  survives), healthcare slot role untested, `make check` never runs the node
  tests, `reportValidityOfForms` is sitewide; from the second: dropping
  hasOwnHxVerb() survives (no live call site reaches it). Mechanism: gate
  escalation + oracle.
- **2026-09-23k — WS1 HARD STOP (attempt 2, checker-second FAIL, conceded).**
  To make display == aria-valuetext, attempt 2 switched 8 slider display spans
  from formatNumber (half-even) to formatDollars (half-up); the Coverage
  Timeline and Total Monthly Healthcare still use formatNumber, so a stored
  1800.50 shows "$1,801" on the slider and "$1,800" in the timeline on the same
  card. Lead verified the premise in Chromium: base shows "$1,800" on both
  (server and after JS load). Same class as attempt 1's D4/.50-tie findings →
  two Tier-3 failures in one class = spec defect: the contract said "the
  existing formatter" but never pinned ONE whole-dollar rounding rule for Go
  AND JS, nor enumerated every surface that shows each converted value.
  Reported to the user with options. The value-fidelity core (no rewrites, no
  blocked forms, QA behaviours, aria, no float artifacts, generic Go test)
  passed the extended oracle 71/71. Mechanism: second checker.
  WS1.2 checker-a11y PASS (29 sliders + mirrors, aria == display, both
  themes); new pre-existing observation: QA investment-return display
  `.text-gray-200` in light mode (whatif-rate-assumptions.js:256) → backlog.
  WS1.2 checker-tests FAIL: (C7) formatExact's `math.Round(v*1e10)/1e10` —
  the implementation MY re-issued brief invited ("rounded to 10 decimal
  places") — manufactures artifacts on large values (388354.59 →
  "388354.5900000001"; ~1.9 % of cent values in $262K–$900K), a lead spec
  defect; the oracle's E2 missed it because only the fixture's values were
  probed. (C6) generic test gaps: dropping step="any", narrowing max, %.0f on
  fields whose fixture value is whole, glide-path inputs never rendered.
  Contract for any attempt 3: stored values render with shortest round-trip
  (strconv 'f', -1) — never re-rounded; scaled/derived values (percent ×100)
  render at 15 significant digits trimmed; ONE whole-dollar rounding rule in
  Go and JS for every surface showing a value (slider display, aria, QA,
  timeline, totals); generic test fixtures fractional in EVERY field incl. an
  enabled glide path, plus structural invariants (every named stored number
  input step="any", max ≥ stored value); oracle E2 extended with a sampled
  value sweep. Mechanism: primary checker.

## 7. Out of scope (runs B/C/D, from the 2026-09-22 review)
Spousal 50 % sentence, year-N RMD balance, living-expense breakdown, PV basis,
formatter sweep, age labels, guardrail "next cut" wording, MC seeding, FRA
months, a11y sweep (labels, chart tones, focus, 320 px, aria-valuetext),
headline/verdict redesign, healthcare Remove undo, phase-age ordering.
