# ACCESSIBILITY.md — the standard every check runs against

WCAG 2.2 AA is the baseline. The numbered points below are the *test cases*:
`checker-a11y` treats each as pass/fail, and no worker task is accepted while
any point it touches is violated. "It looks fine" is not evidence — the axe run
and a walk of these points is.

## Baseline

**A-1. Automated audit is clean.** `npx @axe-core/cli` reports zero violations
on every page that changed, run against the server-rendered HTML (not a JS-only
render).

**A-2. Both themes are audited.** The dashboard ships light and dark via
`prefers-color-scheme`. Every point below holds in **both**. A control readable
in one theme and invisible in the other is a FAIL, not a nitpick.

**A-3. Contrast.** Text and meaningful UI meet AA: 4.5:1 for body text, 3:1 for
large text (≥ 18.66px bold / 24px) and for icons/borders that carry meaning.
Family colors and tier badges are text-on-fill pairs that meet this in both
themes — verified against the actual computed colors, not assumed.

**A-4. Keyboard.** Every interactive element (links, the task-drawer trigger,
any future action button) is reachable and operable by keyboard alone, in a
logical tab order. No keyboard trap. The SSE live-reload must not steal or reset
focus.

**A-5. Visible focus.** A clearly visible focus indicator (≥ 3:1 against its
background) on every focusable element in both themes. Never `outline: none`
without an equal-or-better replacement.

**A-6. Structure and landmarks.** Exactly one `<h1>`; heading levels never skip.
`<header>`, `<main>`, and `<footer>` (or ARIA landmarks) are present. A
skip-to-content link is the first focusable element.

**A-7. The ledger is a real table.** Task data uses `<table>` with `<th
scope="col">` headers — not a grid of `<div>`s. Row/column relationships are
programmatically determinable.

**A-8. Images and icons.** Decorative icons are `aria-hidden="true"`;
meaningful icons have an accessible name (`aria-label` or adjacent text). No
icon is the *only* carrier of information (see A-9).

**A-9. Never color-only.** Status, verdict, tier, and family are conveyed by
**text and/or icon in addition to** color. A red dot alone is a FAIL; "FAIL"
with a red dot is fine. This is the load-bearing rule for a verification tool —
a colorblind operator must read the same verdict everyone else does.

## Project-specific

**A-10. Live updates are announced, not disruptive.** The SSE refresh region
uses `aria-live="polite"` (or an equivalent status message) so assistive tech
notes a change, but focus and scroll position are preserved across a reload.
No content flashes more than 3×/second.

**A-11. Reduced motion is honored.** Any transition or spinner respects
`prefers-reduced-motion: reduce` and drops to no motion.

**A-12. Evidence is verbatim and legible.** Verdict evidence and gate output
render in a monospace block, unmodified, with a visible-focus, keyboard-
scrollable container if they overflow (`tabindex="0"`, `role="region"`,
accessible name). Never truncate evidence silently.

**A-13. Empty states are states, not errors.** A missing `spend.jsonl`, an
empty flags strip, or a task with no verdicts yet renders a calm, labelled
empty state — never a stack trace, a raw exception, or a blank region with no
explanation.

**A-14. Self-contained and CSP-clean.** No external origins for fonts, styles,
scripts, or images (system font stack; inline SVG or the existing icon
approach). The page must render fully offline. No inline event-handler
attributes (`onclick=` etc.) — behavior attaches from the one script file.

**A-15. Target size.** Interactive targets are at least 24×24 CSS px (WCAG 2.2
2.5.8), with adequate spacing; the task-row trigger and any control meet this.
