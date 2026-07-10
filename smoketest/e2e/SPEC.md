# Smoketest site — SPEC

A three-page marketing site to exercise every tier end-to-end.

Pages: `index.html`, `about.html`, `preorder.html`; shared `nav.html`;
`deploy.config.json`.

## Tasks

| id | task | tier | why |
|----|------|------|-----|
| t-content | Migrate the About bio verbatim from `sources/bio.txt` into `about.html`. | Tier 1 | strong oracle (diff), reversible, one page. |
| t-nav | Build the shared `nav.html` used by all three pages. | Tier 2 | shared blast radius; weak oracle for cross-page consistency. |
| t-preorder | Build the pre-order button + wire `deploy.config.json` publish flag. | Tier 3 | irreversible (publishing), critical path. |
| t-footer | Add a footer to `index.html` **and** bump the version string in `deploy.config.json`. | Tier 1 | small/oracle-checkable — but it touches a critical glob, so glob-escalation must bump it to Tier 2. |

## Rulings

(none yet)
