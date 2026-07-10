# Checker-eval runbook (validation layer 2)

Requires the LiteLLM gateway up and API keys set (see README "Setup").

For each row in `expected.tsv`, dispatch the named checker at the fixture
directory with a minimal task block ("verify this page; source is
source.txt where present") and record the verdict it writes to
`.swarm/verdicts/`. The eval passes when every observed verdict equals the
expected verdict. A planted fault that a checker PASSes is a checker
regression; a clean fixture it FAILs is a false positive.
