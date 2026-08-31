import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { parse } from '../lib/parse.mjs';

// ---------------------------------------------------------------------------
// fixture helpers — every test builds its own throwaway `.swarm`-shaped dir
// so this suite never depends on any other task's fixtures.
// ---------------------------------------------------------------------------

function makeSwarmDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dash-parse-test-'));
}

function writeFile(swarmDir, relPath, content) {
  const full = path.join(swarmDir, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

function writeLedger(swarmDir, rows) {
  // rows: array of either a raw string line (for malformed-line tests) or
  // an array of 7 field values.
  const lines = rows.map((r) => (typeof r === 'string' ? r : r.join('\t')));
  writeFile(swarmDir, 'ledger.tsv', lines.join('\n') + '\n');
}

function verdictBody({ verdict, checker, family, task, attempt, evidence = 'ok' }) {
  return (
    `VERDICT: ${verdict}\n` +
    `CHECKER: ${checker}\n` +
    `FAMILY: ${family}\n` +
    `TASK: ${task}\n` +
    `ATTEMPT: ${attempt}\n` +
    `---\n${evidence}`
  );
}

function writeVerdict(swarmDir, { task, attempt, checker, ...rest }) {
  writeFile(
    swarmDir,
    `verdicts/${task}.${attempt}.${checker}.verdict`,
    verdictBody({ task, attempt, checker, ...rest })
  );
}

// ---------------------------------------------------------------------------
// (a) derived.state === 'accepted' only when a PASS-quorum exists
// ---------------------------------------------------------------------------

test('tier-1 task: accepted ledger status + matching checker PASS -> accepted', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t1-ok', '1', 'a11y', 'accepted', '1', 'worker-local', 'clean pass'],
  ]);
  writeVerdict(dir, { task: 't1-ok', attempt: 1, checker: 'checker-a11y', verdict: 'PASS', family: 'anthropic' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't1-ok');
  assert.equal(task.derived.state, 'accepted');
  assert.equal(state.summary.accepted, 1);
});

test('negative case: ledger says accepted but quorum is absent -> blocked + errors entry', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t1-lie', '1', 'a11y', 'accepted', '1', 'worker-local', 'claims accepted, no evidence'],
  ]);
  // No verdict file at all for t1-lie.

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't1-lie');
  assert.equal(task.derived.state, 'blocked');
  const hit = state.errors.find(
    (e) => e.file === 'ledger.tsv' && e.message.includes('t1-lie') && e.message.includes('ledger says accepted but')
  );
  assert.ok(hit, 'expected an errors[] entry surfacing the discrepancy');
});

test('tier-2 task: ledger says accepted, only one family PASS -> blocked + errors entry', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-lie', '2', 'content,second', 'accepted', '1', 'worker-coder', 'only one family passed'],
  ]);
  writeVerdict(dir, { task: 't2-lie', attempt: 1, checker: 'checker-content', verdict: 'PASS', family: 'anthropic' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-lie');
  assert.equal(task.derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.message.includes('t2-lie')));
});

// ---------------------------------------------------------------------------
// (b) a FAIL from one family flips isDispute; majority OVERRULE -> accepted
// ---------------------------------------------------------------------------

test('one family FAIL flips isDispute; dispute stays open under 3 judges', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-dispute', '2', 'content,second', 'checking', '1', 'worker-coder', 'awaiting judges'],
  ]);
  writeVerdict(dir, { task: 't2-dispute', attempt: 1, checker: 'checker-content', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-dispute', attempt: 1, checker: 'checker-second', verdict: 'FAIL', family: 'glm' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-dispute');
  assert.equal(task.derived.isDispute, true);
  assert.equal(task.derived.state, 'disputed');
  assert.equal(state.summary.disputed, 1);
  assert.equal(state.summary.inVerification, 1);
});

test('majority OVERRULE with 2-family PASS + accepted ledger status -> accepted', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-overruled', '2', 'content,second', 'accepted', '1', 'worker-coder', 'judges overruled the FAIL'],
  ]);
  writeVerdict(dir, { task: 't2-overruled', attempt: 1, checker: 'checker-content', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-overruled', attempt: 1, checker: 'checker-second', verdict: 'FAIL', family: 'glm' });
  writeVerdict(dir, { task: 't2-overruled', attempt: 1, checker: 'judge-claude', verdict: 'OVERRULE', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-overruled', attempt: 1, checker: 'judge-glm', verdict: 'OVERRULE', family: 'glm' });
  writeVerdict(dir, { task: 't2-overruled', attempt: 1, checker: 'judge-local', verdict: 'UPHOLD', family: 'local' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-overruled');
  assert.equal(task.derived.isDispute, true);
  assert.equal(task.derived.state, 'accepted');
});

test('majority UPHOLD with 3 judges -> blocked (sent back), even without accepted ledger status', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-upheld', '2', 'content,second', 'checking', '2', 'worker-coder', 'judges upheld the FAIL'],
  ]);
  writeVerdict(dir, { task: 't2-upheld', attempt: 2, checker: 'checker-content', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-upheld', attempt: 2, checker: 'checker-second', verdict: 'FAIL', family: 'glm' });
  writeVerdict(dir, { task: 't2-upheld', attempt: 2, checker: 'judge-claude', verdict: 'UPHOLD', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-upheld', attempt: 2, checker: 'judge-glm', verdict: 'UPHOLD', family: 'glm' });
  writeVerdict(dir, { task: 't2-upheld', attempt: 2, checker: 'judge-local', verdict: 'OVERRULE', family: 'local' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-upheld');
  assert.equal(task.derived.state, 'blocked');
});

// ---------------------------------------------------------------------------
// (c) malformed lines/values land in errors[] and never throw
// ---------------------------------------------------------------------------

test('malformed ledger lines are skipped and reported, well-formed lines still parse', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    '# a comment line, ignored',
    '',
    'too-few-fields\t1\t-\taccepted',
    ['bad-tier', '9', '-', 'checking', '1', 'worker-local', 'bad tier value'],
    ['bad-attempt', '1', '-', 'checking', 'NaN', 'worker-local', 'bad attempt value'],
    ['good-task', '1', '-', 'building', '0', 'worker-local', 'this one is fine'],
  ]);

  let state;
  assert.doesNotThrow(() => {
    state = parse(dir);
  });

  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].id, 'good-task');
  assert.equal(state.errors.filter((e) => e.file === 'ledger.tsv').length, 3);
});

test('invalid VERDICT value lands in errors[] and the verdict is excluded', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t1-bad-verdict', '1', 'a11y', 'checking', '1', 'worker-local', 'has a garbage verdict file'],
  ]);
  writeFile(
    dir,
    'verdicts/t1-bad-verdict.1.checker-a11y.verdict',
    'VERDICT: MAYBE\nCHECKER: checker-a11y\nFAMILY: anthropic\nTASK: t1-bad-verdict\nATTEMPT: 1\n---\nnonsense'
  );

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't1-bad-verdict');
  assert.equal(task.verdicts.length, 0);
  assert.ok(state.errors.some((e) => e.file.includes('t1-bad-verdict') && e.message.includes('invalid VERDICT')));
});

test('incomplete verdict headers (no CHECKER/TASK/---) are excluded and cannot form quorum', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-incomplete', '2', 'content,second', 'accepted', '1', 'worker-coder', 'forged incomplete files'],
  ]);
  writeFile(dir, 'verdicts/t2-incomplete.1.a.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');
  writeFile(dir, 'verdicts/t2-incomplete.1.b.verdict', 'VERDICT: PASS\nFAMILY: glm\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-incomplete');
  assert.equal(task.verdicts.length, 0);
  assert.equal(task.derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.file.includes('t2-incomplete') && e.message.includes('missing')));
  assert.ok(state.errors.some((e) => e.message.includes('ledger says accepted')));
});

test('CHECKER/filename mismatch is excluded from quorum', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-mismatch', '2', 'content,second', 'accepted', '1', 'worker-coder', 'header mismatch'],
  ]);
  writeFile(
    dir,
    'verdicts/t2-mismatch.1.checker-content.verdict',
    'VERDICT: PASS\nCHECKER: other\nFAMILY: anthropic\nTASK: t2-mismatch\nATTEMPT: 1\n---\nok'
  );
  writeVerdict(dir, {
    task: 't2-mismatch',
    attempt: 1,
    checker: 'checker-second',
    verdict: 'PASS',
    family: 'glm',
  });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-mismatch');
  assert.equal(task.verdicts.length, 1);
  assert.equal(task.derived.state, 'blocked');
  assert.ok(
    state.errors.some(
      (e) => e.file.includes('checker-content') && e.message.includes('CHECKER')
    )
  );
});

test('invalid FAMILY enum is excluded from quorum', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-fam', '2', 'content,second', 'accepted', '1', 'worker-coder', 'bad family'],
  ]);
  writeVerdict(dir, {
    task: 't2-fam',
    attempt: 1,
    checker: 'checker-content',
    verdict: 'PASS',
    family: 'anthropic',
  });
  writeFile(
    dir,
    'verdicts/t2-fam.1.checker-second.verdict',
    'VERDICT: PASS\nCHECKER: checker-second\nFAMILY: forged\nTASK: t2-fam\nATTEMPT: 1\n---\nok'
  );

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-fam');
  assert.equal(task.verdicts.length, 1);
  assert.equal(task.derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.message.includes('invalid FAMILY')));
});

test('duplicate judge family blocks dispute resolution quorum', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-dup-judge', '2', 'content,second', 'accepted', '1', 'worker-coder', 'dup judges'],
  ]);
  writeVerdict(dir, {
    task: 't2-dup-judge',
    attempt: 1,
    checker: 'checker-content',
    verdict: 'PASS',
    family: 'anthropic',
  });
  writeVerdict(dir, {
    task: 't2-dup-judge',
    attempt: 1,
    checker: 'checker-second',
    verdict: 'FAIL',
    family: 'glm',
  });
  writeVerdict(dir, {
    task: 't2-dup-judge',
    attempt: 1,
    checker: 'judge-claude',
    verdict: 'OVERRULE',
    family: 'anthropic',
  });
  writeVerdict(dir, {
    task: 't2-dup-judge',
    attempt: 1,
    checker: 'judge-glm',
    verdict: 'OVERRULE',
    family: 'glm',
  });
  // Third judge reuses anthropic family — not a unique identity.
  writeVerdict(dir, {
    task: 't2-dup-judge',
    attempt: 1,
    checker: 'judge-extra',
    verdict: 'OVERRULE',
    family: 'anthropic',
  });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-dup-judge');
  assert.notEqual(task.derived.state, 'accepted');
  assert.equal(task.derived.state, 'blocked');
  assert.ok(
    state.errors.some(
      (e) => e.message.includes('t2-dup-judge') && e.message.includes('duplicate judge family')
    )
  );
});

test('malformed spend.jsonl lines are reported and do not throw; valid lines still counted', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['solo', '1', '-', 'building', '0', 'worker-local', 'n/a']]);
  const lines = [
    '{not valid json',
    JSON.stringify({ ts: 1, alias: 'worker-local', family: 'local' }), // missing numeric fields
    JSON.stringify({
      ts: 1, alias: 'worker-local', family: 'local', tier: 1, task: 'solo',
      prompt_tokens: 100, completion_tokens: 50, cost_usd: 0,
    }),
  ];
  writeFile(dir, 'spend.jsonl', lines.join('\n') + '\n');

  let state;
  assert.doesNotThrow(() => {
    state = parse(dir);
  });
  assert.equal(state.errors.filter((e) => e.file === 'spend.jsonl').length, 2);
  assert.ok(state.spend);
  assert.equal(state.spend.total, 0);
  assert.equal(state.spend.perAlias.length, 1);
  assert.equal(state.spend.perAlias[0].tokens, 150);
});

// ---------------------------------------------------------------------------
// (d) ledger field values round-trip character-faithfully
// ---------------------------------------------------------------------------

test('ledger fields (incl. weird-but-legal chars in reason) round-trip verbatim', () => {
  const dir = makeSwarmDir();
  const weirdReason = 'résumé: "quoted", semi;colon, path/like:this, br{ackets} & <angles> — em-dash';
  writeLedger(dir, [
    ['weird-id_42', '3', 'a11y,second,content', 'checking', '7', 'worker-coder’s-alias', weirdReason],
  ]);

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 'weird-id_42');
  assert.ok(task, 'task should be parsed');
  assert.equal(task.tier, 3);
  assert.deepEqual(task.checks, ['a11y', 'second', 'content']);
  assert.equal(task.status, 'checking');
  assert.equal(task.attempt, 7);
  assert.equal(task.worker, 'worker-coder’s-alias');
  assert.equal(task.reason, weirdReason);
});

// ---------------------------------------------------------------------------
// additional coverage: missing spend.jsonl, flags, tier3, old-attempt verdicts
// ---------------------------------------------------------------------------

test('missing spend.jsonl -> spend is null, not an error', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['solo', '1', '-', 'building', '0', 'worker-local', 'n/a']]);

  const state = parse(dir);
  assert.equal(state.spend, null);
  assert.equal(state.errors.filter((e) => e.file === 'spend.jsonl').length, 0);
});

test('open flag (ledger tier < target tier) appears in task.flag and summary.flagsOpen', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-flagged', '2', 'content,second', 'checking', '1', 'worker-coder', 'critical glob hit'],
  ]);
  writeFile(dir, 'flags/t2-flagged.flag', 'TARGET_TIER: 3\nREASON: critical-glob\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-flagged');
  assert.deepEqual(task.flag, { targetTier: 3, reason: 'critical-glob' });
  assert.equal(state.summary.flagsOpen, 1);
  assert.equal(task.derived.state, 'flagged');
});

test('resolved flag (ledger tier >= target tier) -> flag is null, not counted open', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-resolved-flag', '3', '-', 'checking', '1', 'worker-coder', 'escalated and now at tier 3'],
  ]);
  writeFile(dir, 'flags/t3-resolved-flag.flag', 'TARGET_TIER: 3\nREASON: critical-glob\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-resolved-flag');
  assert.equal(task.flag, null);
  assert.equal(state.summary.flagsOpen, 0);
});

// ---------------------------------------------------------------------------
// (R-2 regression) accepted + full quorum + OPEN flag must NOT read
// 'accepted' — gate.sh cmd_check checks the flag before tier acceptance, so
// parse() must mirror that precedence or the dashboard lies.
// ---------------------------------------------------------------------------

test('R-2: accepted ledger + 2-family PASS quorum + OPEN flag -> flagged, not accepted, with errors entry', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['esc-task', '2', 'a11y,second', 'accepted', '1', 'worker-coder', 'reason'],
  ]);
  writeVerdict(dir, { task: 'esc-task', attempt: 1, checker: 'checker-a11y', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 'esc-task', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'glm' });
  writeFile(dir, 'flags/esc-task.flag', 'TARGET_TIER: 3\nREASON: critical-glob\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 'esc-task');
  assert.notEqual(task.derived.state, 'accepted');
  assert.equal(task.derived.state, 'flagged');
  const hit = state.errors.find(
    (e) =>
      e.file === 'ledger.tsv' &&
      e.message.includes('esc-task') &&
      e.message.includes('ledger says accepted but escalation flag open')
  );
  assert.ok(hit, 'expected an errors[] entry surfacing the accepted-vs-open-flag discrepancy');
});

test('R-2: accepted ledger + 2-family PASS quorum + RESOLVED flag (target <= tier) -> still accepted, no discrepancy', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['esc-task-resolved', '2', 'a11y,second', 'accepted', '1', 'worker-coder', 'reason'],
  ]);
  writeVerdict(dir, { task: 'esc-task-resolved', attempt: 1, checker: 'checker-a11y', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 'esc-task-resolved', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'glm' });
  writeFile(dir, 'flags/esc-task-resolved.flag', 'TARGET_TIER: 2\nREASON: critical-glob\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 'esc-task-resolved');
  assert.equal(task.flag, null);
  assert.equal(task.derived.state, 'accepted');
  assert.ok(
    !state.errors.some((e) => e.message.includes('esc-task-resolved')),
    'a resolved flag must not trigger the accepted-vs-open-flag discrepancy'
  );
});

test('tier3 report with RESOLUTION line -> hasResolution true, resolution text captured, matrix parsed', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-resolved', '3', '-', 'accepted', '1', 'worker-coder', 'merged after divergence'],
  ]);
  writeVerdict(dir, { task: 't3-resolved', attempt: 1, checker: 'checker-content', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't3-resolved', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'glm' });
  writeFile(
    dir,
    'tier3/t3-resolved/report.md',
    [
      '# Divergence report',
      '',
      '| Check | Worktree A | Worktree B | Agree? |',
      '|-------|-----------|-----------|--------|',
      '| axe violations | PASS | PASS | Yes |',
      '| keyboard nav | PASS | FAIL | No |',
      '',
      'RESOLUTION: merged worktree A, re-verified.',
    ].join('\n')
  );

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-resolved');
  assert.equal(task.tier3.hasResolution, true);
  assert.equal(task.tier3.resolution, 'merged worktree A, re-verified.');
  assert.equal(task.tier3.matrix.length, 2);
  assert.deepEqual(task.tier3.matrix[0], { check: 'axe violations', a: 'PASS', b: 'PASS', agree: true });
  assert.deepEqual(task.tier3.matrix[1], { check: 'keyboard nav', a: 'PASS', b: 'FAIL', agree: false });
  assert.equal(task.derived.state, 'accepted');
});

test('tier3 report without RESOLUTION line -> hasResolution false, resolution null, ledger accepted is blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-unresolved', '3', '-', 'accepted', '1', 'worker-local', 'claims accepted but no resolution yet'],
  ]);
  writeVerdict(dir, { task: 't3-unresolved', attempt: 1, checker: 'checker-content', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't3-unresolved', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'glm' });
  writeFile(
    dir,
    'tier3/t3-unresolved/report.md',
    '# Divergence report\n\nStill investigating a mismatch. No resolution yet.\n'
  );

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-unresolved');
  assert.equal(task.tier3.hasResolution, false);
  assert.equal(task.tier3.resolution, null);
  assert.equal(task.derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.message.includes('t3-unresolved')));
});

test('tier3 is null for tasks with no tier3/<task>/ dir', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['t1-plain', '1', '-', 'building', '0', 'worker-local', 'no tier3 dir at all']]);

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't1-plain');
  assert.equal(task.tier3, null);
});

test('old-attempt verdicts are excluded from the current-attempt verdicts array', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t1-retried', '1', 'a11y', 'checking', '2', 'worker-local', 'second attempt in flight'],
  ]);
  // attempt 1 (old) had a FAIL — must not leak into attempt 2's verdicts.
  writeVerdict(dir, { task: 't1-retried', attempt: 1, checker: 'checker-a11y', verdict: 'FAIL', family: 'anthropic' });
  // attempt 2 (current) has no verdicts yet.

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't1-retried');
  assert.equal(task.verdicts.length, 0);
  assert.equal(task.derived.isDispute, false);
  assert.equal(task.derived.state, 'building');
});

test('manifest is null when absent, and populated only for the current attempt', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t-no-manifest', '1', '-', 'building', '0', 'worker-local', 'nothing built yet'],
    ['t-manifest', '1', 'a11y', 'checking', '2', 'worker-local', 'attempt 2 manifest present'],
  ]);
  writeFile(dir, 'manifests/t-manifest.1.files', 'stale/attempt-one/file.txt\n');
  writeFile(dir, 'manifests/t-manifest.2.files', 'dashboard/lib/parse.mjs\ndashboard/test/parse.test.mjs\n');

  const state = parse(dir);
  const noManifestTask = state.tasks.find((t) => t.id === 't-no-manifest');
  const manifestTask = state.tasks.find((t) => t.id === 't-manifest');

  assert.equal(noManifestTask.manifest, null);
  assert.deepEqual(manifestTask.manifest, ['dashboard/lib/parse.mjs', 'dashboard/test/parse.test.mjs']);
});

// ---------------------------------------------------------------------------
// spend.derived arithmetic
// ---------------------------------------------------------------------------

test('spend.derived computes perAcceptedTask, verificationSharePct, disputeOverhead, localTokens', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t1-accepted', '1', 'a11y', 'accepted', '1', 'worker-local', 'accepted'],
  ]);
  writeVerdict(dir, { task: 't1-accepted', attempt: 1, checker: 'checker-a11y', verdict: 'PASS', family: 'anthropic' });

  const rows = [
    { ts: 1, alias: 'worker-local', family: 'local', tier: 1, task: 't1-accepted', prompt_tokens: 1000, completion_tokens: 200, cost_usd: 0 },
    { ts: 2, alias: 'checker-a11y', family: 'anthropic', tier: 1, task: 't1-accepted', prompt_tokens: 500, completion_tokens: 100, cost_usd: 0.01 },
    { ts: 3, alias: 'judge-claude', family: 'anthropic', tier: 2, task: null, prompt_tokens: 300, completion_tokens: 50, cost_usd: 0.02 },
  ];
  writeFile(dir, 'spend.jsonl', rows.map((r) => JSON.stringify(r)).join('\n') + '\n');

  const state = parse(dir);
  assert.ok(state.spend);
  assert.equal(state.spend.total, 0.03);
  assert.equal(state.spend.derived.localTokens, 1200);
  assert.equal(state.spend.derived.disputeOverhead, 0.02);
  // verification cost = checker (0.01) + judge (0.02) = 0.03 of total 0.03 -> 100%
  assert.equal(state.spend.derived.verificationSharePct, 100);
  // 1 accepted task, total 0.03 -> perAcceptedTask = 0.03
  assert.equal(state.spend.derived.perAcceptedTask, 0.03);

  const tier1 = state.spend.perTier.find((t) => t.tier === 1);
  assert.equal(tier1.tasks, 1);
  assert.equal(tier1.avgCost, 0.01); // (0 + 0.01) / 1 task
});

test('spend.derived.perAcceptedTask is null when there are zero accepted tasks', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['t1-building', '1', '-', 'building', '0', 'worker-local', 'n/a']]);
  writeFile(
    dir,
    'spend.jsonl',
    JSON.stringify({ ts: 1, alias: 'worker-local', family: 'local', tier: 1, task: 't1-building', prompt_tokens: 10, completion_tokens: 5, cost_usd: 0 }) + '\n'
  );

  const state = parse(dir);
  assert.equal(state.spend.derived.perAcceptedTask, null);
});

// ---------------------------------------------------------------------------
// lean Tier-2 contract (gate.sh 2026-08-31): PASS from every checker named in
// the ledger checks column; empty checks hard-fails; the two-lane span applies
// only when `second` is among the named checks.
// ---------------------------------------------------------------------------

test('lean tier-2: single named checker PASS in one lane -> accepted (no second, no span rule)', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-lean-solo', '2', 'tests', 'accepted', '1', 'worker-coder', 'lean single-checker tier 2'],
  ]);
  writeVerdict(dir, { task: 't2-lean-solo', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-lean-solo');
  assert.equal(task.derived.state, 'accepted');
  assert.ok(!state.errors.some((e) => e.message.includes('t2-lean-solo')));
});

test('lean tier-2: empty checks column is a hard error even with 2-family PASSes -> blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-lean-empty', '2', '-', 'accepted', '1', 'worker-coder', 'blank checks at tier 2'],
  ]);
  writeVerdict(dir, { task: 't2-lean-empty', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-lean-empty', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'adversarial' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-lean-empty');
  assert.equal(task.derived.state, 'blocked');
  assert.ok(
    state.errors.some((e) => e.message.includes('t2-lean-empty') && e.message.includes('named checkers')),
    'expected the empty-checks hard error to be surfaced'
  );
});

test('lean tier-2: checks include second, both PASSes in one lane -> blocked on lane span', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-lean-onelane', '2', 'tests,second', 'accepted', '1', 'worker-coder', 'second in same lane'],
  ]);
  writeVerdict(dir, { task: 't2-lean-onelane', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-lean-onelane', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'anthropic' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-lean-onelane');
  assert.equal(task.derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.message.includes('t2-lean-onelane')));
});

test('lean tier-2: checks include second, PASSes span anthropic+adversarial lanes -> accepted', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-lean-twolane', '2', 'tests,second', 'accepted', '1', 'worker-coder', 'proper two-lane pair'],
  ]);
  writeVerdict(dir, { task: 't2-lean-twolane', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-lean-twolane', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'adversarial' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-lean-twolane');
  assert.equal(task.verdicts.length, 2, 'adversarial FAMILY must be a valid lane');
  assert.equal(task.derived.state, 'accepted');
});

test('lean tier-2: missing PASS from a named checker -> blocked, even with an extra unnamed PASS', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-lean-missing', '2', 'tests,second', 'accepted', '1', 'worker-coder', 'named checker never ran'],
  ]);
  writeVerdict(dir, { task: 't2-lean-missing', attempt: 1, checker: 'checker-a11y', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-lean-missing', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'adversarial' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-lean-missing');
  assert.equal(task.derived.state, 'blocked');
  assert.ok(
    state.errors.some((e) => e.message.includes('t2-lean-missing') && e.message.includes('checker-tests')),
    'expected the missing named-checker PASS to be surfaced'
  );
});

test('lean tier-2 dispute: judge quorum in anthropic/adversarial/impact lanes replaces the named-checker rule', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-lean-judged', '2', 'tests', 'accepted', '1', 'worker-coder', 'FAIL overruled by panel'],
  ]);
  writeVerdict(dir, { task: 't2-lean-judged', attempt: 1, checker: 'checker-tests', verdict: 'FAIL', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-lean-judged', attempt: 1, checker: 'judge-claude', verdict: 'OVERRULE', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-lean-judged', attempt: 1, checker: 'judge-standards', verdict: 'OVERRULE', family: 'adversarial' });
  writeVerdict(dir, { task: 't2-lean-judged', attempt: 1, checker: 'judge-impact', verdict: 'UPHOLD', family: 'impact' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-lean-judged');
  assert.equal(task.verdicts.length, 4, 'impact FAMILY must be a valid lane');
  assert.equal(task.derived.isDispute, true);
  assert.equal(task.derived.state, 'accepted');
});

// ---------------------------------------------------------------------------
// tier-3 oracle contract (gate.sh 2026-08-26/31): no report.md -> accept.sh
// must exist and be executable, and oracle.<attempt>.log must end with the
// exact line ORACLE PASS. A report.md flips the dir to the legacy contract.
// ---------------------------------------------------------------------------

function writeOracle(dir, task, { executable = true } = {}) {
  writeFile(dir, `tier3/${task}/accept.sh`, '#!/usr/bin/env bash\necho ORACLE PASS\n');
  fs.chmodSync(path.join(dir, `tier3/${task}/accept.sh`), executable ? 0o755 : 0o644);
}

function writeDualLanePasses(dir, task, attempt) {
  writeVerdict(dir, { task, attempt, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task, attempt, checker: 'checker-second', verdict: 'PASS', family: 'adversarial' });
}

test('tier-3 oracle: executable accept.sh + ORACLE PASS log + dual-lane PASSes -> accepted', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-oracle-ok', '3', 'tests,second', 'accepted', '1', 'worker-coder', 'oracle green'],
  ]);
  writeDualLanePasses(dir, 't3-oracle-ok', 1);
  writeOracle(dir, 't3-oracle-ok');
  writeFile(dir, 'tier3/t3-oracle-ok/oracle.1.log', 'check 1 ok\ncheck 2 ok\nORACLE PASS\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-oracle-ok');
  assert.equal(task.tier3.hasReport, false);
  assert.equal(task.tier3.oracle.scriptExists, true);
  assert.equal(task.tier3.oracle.scriptExecutable, true);
  assert.equal(task.tier3.oracle.logExists, true);
  assert.equal(task.tier3.oracle.oraclePass, true);
  assert.equal(task.derived.state, 'accepted');
});

test('tier-3 oracle: accept.sh not executable -> blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-oracle-noexec', '3', 'tests,second', 'accepted', '1', 'worker-coder', 'chmod forgotten'],
  ]);
  writeDualLanePasses(dir, 't3-oracle-noexec', 1);
  writeOracle(dir, 't3-oracle-noexec', { executable: false });
  writeFile(dir, 'tier3/t3-oracle-noexec/oracle.1.log', 'ORACLE PASS\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-oracle-noexec');
  assert.equal(task.tier3.oracle.scriptExecutable, false);
  assert.equal(task.derived.state, 'blocked');
  assert.ok(
    state.errors.some((e) => e.message.includes('t3-oracle-noexec') && e.message.includes('executable'))
  );
});

test('tier-3 oracle: log at an old attempt does not satisfy the current attempt', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-oracle-stale', '3', 'tests,second', 'accepted', '2', 'worker-coder', 'log never re-run'],
  ]);
  writeDualLanePasses(dir, 't3-oracle-stale', 2);
  writeOracle(dir, 't3-oracle-stale');
  writeFile(dir, 'tier3/t3-oracle-stale/oracle.1.log', 'ORACLE PASS\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-oracle-stale');
  assert.equal(task.tier3.oracle.logExists, false);
  assert.equal(task.derived.state, 'blocked');
});

test('tier-3 oracle: log whose final line is not ORACLE PASS -> blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-oracle-fail', '3', 'tests,second', 'accepted', '1', 'worker-coder', 'oracle actually failed'],
  ]);
  writeDualLanePasses(dir, 't3-oracle-fail', 1);
  writeOracle(dir, 't3-oracle-fail');
  writeFile(dir, 'tier3/t3-oracle-fail/oracle.1.log', 'ORACLE PASS\ncheck 3 FAILED\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-oracle-fail');
  assert.equal(task.tier3.oracle.oraclePass, false);
  assert.equal(task.derived.state, 'blocked');
});

test('tier-3 oracle: valid oracle but PASSes in one lane only -> blocked (dual-lane quorum unconditional)', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-oracle-onelane', '3', 'tests,second', 'accepted', '1', 'worker-coder', 'lanes collapsed'],
  ]);
  writeVerdict(dir, { task: 't3-oracle-onelane', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't3-oracle-onelane', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'anthropic' });
  writeOracle(dir, 't3-oracle-onelane');
  writeFile(dir, 'tier3/t3-oracle-onelane/oracle.1.log', 'ORACLE PASS\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-oracle-onelane');
  assert.equal(task.derived.state, 'blocked');
});

test('tier-3: no tier3 dir at all -> ledger accepted is blocked (no oracle, no legacy report)', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-nodir', '3', 'tests,second', 'accepted', '1', 'worker-coder', 'nothing on disk'],
  ]);
  writeDualLanePasses(dir, 't3-nodir', 1);

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-nodir');
  assert.equal(task.tier3, null);
  assert.equal(task.derived.state, 'blocked');
});

test('tier-3 legacy footgun: report.md without RESOLUTION bypasses a valid oracle -> blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-legacy-trap', '3', 'tests,second', 'accepted', '1', 'worker-coder', 'stale report.md in dir'],
  ]);
  writeDualLanePasses(dir, 't3-legacy-trap', 1);
  writeOracle(dir, 't3-legacy-trap');
  writeFile(dir, 'tier3/t3-legacy-trap/oracle.1.log', 'ORACLE PASS\n');
  writeFile(dir, 'tier3/t3-legacy-trap/report.md', '# stale blind-arm report, no resolution line\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-legacy-trap');
  assert.equal(task.tier3.hasReport, true);
  assert.equal(task.derived.state, 'blocked');
});

// ---------------------------------------------------------------------------
// invalid verdict files block tiers 2/3 (gate.sh walk_verdicts parity).
// gate.sh globs `<task>.<attempt>.*.verdict` and hard-FAILs the task when ANY
// matching file cannot be loaded as that exact task+attempt's valid verdict —
// so a full valid quorum plus one malformed extra file must NOT read
// 'accepted' (the anti-lie property). Tier 1 loads only the named checkers'
// files, so unnamed malformed files never block there.
// ---------------------------------------------------------------------------

test('tier-2: full valid quorum + one malformed extra verdict at the current attempt -> blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-extra-junk', '2', 'tests,second', 'accepted', '1', 'worker-coder', 'quorum plus junk file'],
  ]);
  writeVerdict(dir, { task: 't2-extra-junk', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-extra-junk', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'adversarial' });
  writeFile(dir, 'verdicts/t2-extra-junk.1.checker-rogue.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-extra-junk');
  assert.deepEqual(task.invalidVerdicts, ['t2-extra-junk.1.checker-rogue.verdict']);
  assert.equal(task.derived.state, 'blocked');
  assert.ok(
    state.errors.some(
      (e) => e.message.includes('t2-extra-junk') && e.message.includes('invalid verdict file(s)')
    ),
    'expected the accepted-vs-invalid-file discrepancy in errors[]'
  );
});

test('tier-2: malformed verdict at an OLD attempt does not block the current attempt', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-old-junk', '2', 'tests', 'accepted', '2', 'worker-coder', 'junk only at attempt 1'],
  ]);
  writeFile(dir, 'verdicts/t2-old-junk.1.checker-tests.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');
  writeVerdict(dir, { task: 't2-old-junk', attempt: 2, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-old-junk');
  assert.deepEqual(task.invalidVerdicts, []);
  assert.equal(task.derived.state, 'accepted');
});

test('tier-1: named checker PASS + unnamed malformed file at the same attempt -> still accepted', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t1-stray-junk', '1', 'a11y', 'accepted', '1', 'worker-local', 'stray junk file'],
  ]);
  writeVerdict(dir, { task: 't1-stray-junk', attempt: 1, checker: 'checker-a11y', verdict: 'PASS', family: 'anthropic' });
  writeFile(dir, 'verdicts/t1-stray-junk.1.checker-rogue.verdict', 'garbage, no headers at all\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't1-stray-junk');
  // The stray file is still tracked, but tier 1 does not block on it —
  // gate.sh check_tier1 never opens files outside the named checkers'.
  assert.deepEqual(task.invalidVerdicts, ['t1-stray-junk.1.checker-rogue.verdict']);
  assert.equal(task.derived.state, 'accepted');
});

test('unparseable filename matching the task glob blocks at tier 2 (empty checker segment)', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-empty-checker', '2', 'tests', 'accepted', '1', 'worker-coder', 'empty checker in filename'],
  ]);
  writeVerdict(dir, { task: 't2-empty-checker', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  // Matches gate.sh's glob `t2-empty-checker.1.*.verdict` with `*` = '' but
  // the filename regex cannot parse it (no checker segment).
  writeFile(dir, 'verdicts/t2-empty-checker.1..verdict', 'whatever\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-empty-checker');
  assert.deepEqual(task.invalidVerdicts, ['t2-empty-checker.1..verdict']);
  assert.equal(task.derived.state, 'blocked');
});

test('filename shorter than the glob can match does not block (t.1.verdict has no checker slot)', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-short-name', '2', 'tests', 'accepted', '1', 'worker-coder', 'short stray filename'],
  ]);
  writeVerdict(dir, { task: 't2-short-name', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  // gate.sh's glob `t2-short-name.1.*.verdict` needs `.verdict` AFTER the
  // star, so this file is invisible to walk_verdicts and must not block.
  writeFile(dir, 'verdicts/t2-short-name.1.verdict', 'whatever\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-short-name');
  assert.deepEqual(task.invalidVerdicts, []);
  assert.equal(task.derived.state, 'accepted');
});

test('dot-prefix sibling: a VALID verdict for task a.1.b lands in task a attempt 1\'s glob and blocks it', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-sib', '2', 'tests', 'accepted', '1', 'worker-coder', 'prefix-collision victim'],
    ['t2-sib.1.b', '2', 'tests', 'accepted', '2', 'worker-coder', 'sibling with colliding id'],
  ]);
  writeVerdict(dir, { task: 't2-sib', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  // Perfectly valid for its OWN task+attempt, but its filename
  // t2-sib.1.b.2.checker-tests.verdict matches t2-sib attempt 1's glob and
  // fails header agreement there — gate.sh fails t2-sib on it.
  writeVerdict(dir, { task: 't2-sib.1.b', attempt: 2, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });

  const state = parse(dir);
  const victim = state.tasks.find((t) => t.id === 't2-sib');
  const sibling = state.tasks.find((t) => t.id === 't2-sib.1.b');
  assert.deepEqual(victim.invalidVerdicts, ['t2-sib.1.b.2.checker-tests.verdict']);
  assert.equal(victim.derived.state, 'blocked');
  assert.equal(sibling.derived.state, 'accepted');
});

test('tier-3: green oracle + dual-lane PASSes + one malformed extra verdict -> blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-extra-junk', '3', 'tests,second', 'accepted', '1', 'worker-coder', 'quorum plus junk file'],
  ]);
  writeDualLanePasses(dir, 't3-extra-junk', 1);
  writeOracle(dir, 't3-extra-junk');
  writeFile(dir, 'tier3/t3-extra-junk/oracle.1.log', 'ORACLE PASS\n');
  writeFile(dir, 'verdicts/t3-extra-junk.1.checker-rogue.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-extra-junk');
  assert.equal(task.derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.message.includes('t3-extra-junk') && e.message.includes('invalid verdict file(s)')));
});

test('dispute overruled by a full judge panel + one malformed extra verdict -> still blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t2-judged-junk', '2', 'tests', 'accepted', '1', 'worker-coder', 'panel quorum plus junk file'],
  ]);
  writeVerdict(dir, { task: 't2-judged-junk', attempt: 1, checker: 'checker-tests', verdict: 'FAIL', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-judged-junk', attempt: 1, checker: 'judge-claude', verdict: 'OVERRULE', family: 'anthropic' });
  writeVerdict(dir, { task: 't2-judged-junk', attempt: 1, checker: 'judge-standards', verdict: 'OVERRULE', family: 'adversarial' });
  writeVerdict(dir, { task: 't2-judged-junk', attempt: 1, checker: 'judge-impact', verdict: 'OVERRULE', family: 'impact' });
  writeFile(dir, 'verdicts/t2-judged-junk.1.checker-rogue.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't2-judged-junk');
  assert.equal(task.derived.state, 'blocked');
});

// ---------------------------------------------------------------------------
// differential run against swarm/gate.sh — the anti-lie property, tested
// mechanically: for every fixture below (all rows ledgered 'accepted'),
// `gate.sh check <task>` exits 0 exactly when derived.state === 'accepted'.
// ---------------------------------------------------------------------------

const GATE_SH = fileURLToPath(new URL('../../swarm/gate.sh', import.meta.url));

function gateCheck(swarmDir, taskId) {
  const res = spawnSync('bash', [GATE_SH, 'check', taskId], {
    env: { ...process.env, SWARM_DIR: swarmDir },
    encoding: 'utf8',
  });
  assert.notEqual(res.status, null, `gate.sh did not run: ${res.error}`);
  assert.notEqual(res.status, 2, `gate.sh usage/corruption error: ${res.stdout} ${res.stderr}`);
  return res.status === 0;
}

// Each scenario ledgers its tasks as 'accepted' and returns the task ids to
// differentially check. Scenario names describe the disk state, not the
// expected outcome — the expectation is agreement, whichever way it falls.
const DIFFERENTIAL_SCENARIOS = [
  ['tier-1 named checker PASS', (dir) => {
    writeLedger(dir, [['d1', '1', 'a11y', 'accepted', '1', 'w', 'r']]);
    writeVerdict(dir, { task: 'd1', attempt: 1, checker: 'checker-a11y', verdict: 'PASS', family: 'anthropic' });
    return ['d1'];
  }],
  ['tier-1 PASS + unnamed malformed stray', (dir) => {
    writeLedger(dir, [['d1s', '1', 'a11y', 'accepted', '1', 'w', 'r']]);
    writeVerdict(dir, { task: 'd1s', attempt: 1, checker: 'checker-a11y', verdict: 'PASS', family: 'anthropic' });
    writeFile(dir, 'verdicts/d1s.1.checker-rogue.verdict', 'garbage\n');
    return ['d1s'];
  }],
  ['tier-1 named checker file malformed', (dir) => {
    writeLedger(dir, [['d1m', '1', 'a11y', 'accepted', '1', 'w', 'r']]);
    writeFile(dir, 'verdicts/d1m.1.checker-a11y.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');
    return ['d1m'];
  }],
  ['lean tier-2 single named checker PASS', (dir) => {
    writeLedger(dir, [['d2', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdict(dir, { task: 'd2', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
    return ['d2'];
  }],
  ['tier-2 two-lane quorum with second', (dir) => {
    writeLedger(dir, [['d2q', '2', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeVerdict(dir, { task: 'd2q', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
    writeVerdict(dir, { task: 'd2q', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'adversarial' });
    return ['d2q'];
  }],
  ['tier-2 quorum + malformed extra at current attempt', (dir) => {
    writeLedger(dir, [['d2j', '2', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeVerdict(dir, { task: 'd2j', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
    writeVerdict(dir, { task: 'd2j', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'adversarial' });
    writeFile(dir, 'verdicts/d2j.1.checker-rogue.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');
    return ['d2j'];
  }],
  ['tier-2 quorum + malformed file at an old attempt', (dir) => {
    writeLedger(dir, [['d2o', '2', 'tests', 'accepted', '2', 'w', 'r']]);
    writeFile(dir, 'verdicts/d2o.1.checker-tests.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');
    writeVerdict(dir, { task: 'd2o', attempt: 2, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
    return ['d2o'];
  }],
  ['tier-2 glob-matching filename with empty checker segment', (dir) => {
    writeLedger(dir, [['d2e', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdict(dir, { task: 'd2e', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
    writeFile(dir, 'verdicts/d2e.1..verdict', 'whatever\n');
    return ['d2e'];
  }],
  ['tier-2 stray filename too short for the glob', (dir) => {
    writeLedger(dir, [['d2t', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdict(dir, { task: 'd2t', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
    writeFile(dir, 'verdicts/d2t.1.verdict', 'whatever\n');
    return ['d2t'];
  }],
  ['dot-prefix sibling collision (both tasks checked)', (dir) => {
    writeLedger(dir, [
      ['d2p', '2', 'tests', 'accepted', '1', 'w', 'r'],
      ['d2p.1.b', '2', 'tests', 'accepted', '2', 'w', 'r'],
    ]);
    writeVerdict(dir, { task: 'd2p', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
    writeVerdict(dir, { task: 'd2p.1.b', attempt: 2, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
    return ['d2p', 'd2p.1.b'];
  }],
  ['tier-2 dispute overruled by full panel', (dir) => {
    writeLedger(dir, [['d2v', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdict(dir, { task: 'd2v', attempt: 1, checker: 'checker-tests', verdict: 'FAIL', family: 'anthropic' });
    writeVerdict(dir, { task: 'd2v', attempt: 1, checker: 'judge-claude', verdict: 'OVERRULE', family: 'anthropic' });
    writeVerdict(dir, { task: 'd2v', attempt: 1, checker: 'judge-standards', verdict: 'OVERRULE', family: 'adversarial' });
    writeVerdict(dir, { task: 'd2v', attempt: 1, checker: 'judge-impact', verdict: 'UPHOLD', family: 'impact' });
    return ['d2v'];
  }],
  ['tier-2 overruled dispute + malformed extra', (dir) => {
    writeLedger(dir, [['d2vj', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdict(dir, { task: 'd2vj', attempt: 1, checker: 'checker-tests', verdict: 'FAIL', family: 'anthropic' });
    writeVerdict(dir, { task: 'd2vj', attempt: 1, checker: 'judge-claude', verdict: 'OVERRULE', family: 'anthropic' });
    writeVerdict(dir, { task: 'd2vj', attempt: 1, checker: 'judge-standards', verdict: 'OVERRULE', family: 'adversarial' });
    writeVerdict(dir, { task: 'd2vj', attempt: 1, checker: 'judge-impact', verdict: 'OVERRULE', family: 'impact' });
    writeFile(dir, 'verdicts/d2vj.1.checker-rogue.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');
    return ['d2vj'];
  }],
  ['tier-3 green oracle + dual-lane quorum', (dir) => {
    writeLedger(dir, [['d3', '3', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeDualLanePasses(dir, 'd3', 1);
    writeOracle(dir, 'd3');
    writeFile(dir, 'tier3/d3/oracle.1.log', 'ORACLE PASS\n');
    return ['d3'];
  }],
  ['tier-3 green oracle + quorum + malformed extra', (dir) => {
    writeLedger(dir, [['d3j', '3', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeDualLanePasses(dir, 'd3j', 1);
    writeOracle(dir, 'd3j');
    writeFile(dir, 'tier3/d3j/oracle.1.log', 'ORACLE PASS\n');
    writeFile(dir, 'verdicts/d3j.1.checker-rogue.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');
    return ['d3j'];
  }],
];

test('differential: gate.sh check agrees with derived.state for every fixture', () => {
  for (const [name, setup] of DIFFERENTIAL_SCENARIOS) {
    const dir = makeSwarmDir();
    const taskIds = setup(dir);
    const state = parse(dir);
    for (const taskId of taskIds) {
      const gateOk = gateCheck(dir, taskId);
      const task = state.tasks.find((t) => t.id === taskId);
      assert.ok(task, `${name}: task ${taskId} missing from parse output`);
      assert.equal(
        task.derived.state === 'accepted',
        gateOk,
        `${name}: gate.sh check ${taskId} ${gateOk ? 'accepts' : 'rejects'} but derived.state is '${task.derived.state}'`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// module shape
// ---------------------------------------------------------------------------

test('parse() is a pure function exported from the module', () => {
  assert.equal(typeof parse, 'function');
});
