import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createHash } from 'node:crypto';

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

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// writeManifest — the worker contract (2026-09-18): tree files under
// <swarmDir>/tree, the .files manifest and the .sha256 fingerprint sidecar in
// sha256sum format. gate.sh is pointed at the tree via SWARM_TREE.
function writeManifest(swarmDir, task, attempt, paths = [`src/${task}.txt`]) {
  const lines = [];
  for (const p of paths) {
    const full = path.join(swarmDir, 'tree', p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (!fs.existsSync(full)) fs.writeFileSync(full, `content of ${p}\n`);
    lines.push(`${sha256(fs.readFileSync(full))}  ${p}`);
  }
  writeFile(swarmDir, `manifests/${task}.${attempt}.files`, paths.join('\n') + '\n');
  writeFile(swarmDir, `manifests/${task}.${attempt}.sha256`, lines.join('\n') + '\n');
}

function sidecarHash(swarmDir, task, attempt) {
  return sha256(fs.readFileSync(path.join(swarmDir, `manifests/${task}.${attempt}.sha256`)));
}

function verdictBody({ verdict, checker, family, task, attempt, evidence = 'ok', manifestSha256 }) {
  return (
    `VERDICT: ${verdict}\n` +
    `CHECKER: ${checker}\n` +
    `FAMILY: ${family}\n` +
    `TASK: ${task}\n` +
    `ATTEMPT: ${attempt}\n` +
    (manifestSha256 ? `MANIFEST_SHA256: ${manifestSha256}\n` : '') +
    `---\n${evidence}`
  );
}

// writeVerdict — creates a default manifest + fingerprint for (task, attempt)
// when none exists and stamps MANIFEST_SHA256 with the sidecar's hash, so a
// test that is not ABOUT fingerprints gets a consistent evidence set for
// free. Pass `fingerprint: false` to omit the header, or `fingerprint:
// '<hex>'` to force a value.
function writeVerdict(swarmDir, { task, attempt, checker, fingerprint, ...rest }) {
  if (!fs.existsSync(path.join(swarmDir, `manifests/${task}.${attempt}.sha256`))) {
    writeManifest(swarmDir, task, attempt);
  }
  let manifestSha256;
  if (fingerprint === false) manifestSha256 = undefined;
  else if (typeof fingerprint === 'string') manifestSha256 = fingerprint;
  else manifestSha256 = sidecarHash(swarmDir, task, attempt);
  writeFile(
    swarmDir,
    `verdicts/${task}.${attempt}.${checker}.verdict`,
    verdictBody({ task, attempt, checker, manifestSha256, ...rest })
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

test('tier3 stale report.md -> hasReport true and an otherwise-valid accepted row is blocked (legacy contract removed 2026-09-18)', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['t3-stale-report', '3', 'tests,second', 'accepted', '1', 'worker-coder', 'reused tier3 dir'],
  ]);
  writeVerdict(dir, { task: 't3-stale-report', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  writeVerdict(dir, { task: 't3-stale-report', attempt: 1, checker: 'checker-second', verdict: 'PASS', family: 'adversarial' });
  writeFile(dir, 'tier3/t3-stale-report/accept.sh', '#!/usr/bin/env bash\necho ORACLE PASS\n');
  fs.chmodSync(path.join(dir, 'tier3/t3-stale-report/accept.sh'), 0o755);
  writeFile(dir, 'tier3/t3-stale-report/oracle.1.log', 'ORACLE PASS\n');
  writeFile(dir, 'tier3/t3-stale-report/report.md', '# old report\nRESOLUTION: merged\n');

  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't3-stale-report');
  assert.equal(task.tier3.hasReport, true);
  assert.equal(task.derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.message.includes('t3-stale-report') && e.message.includes('report.md')));
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
// 2026-09-18 gate hardening mirror: tier-1 blank checks, tier-3 named
// checkers, fingerprint evidence consistency (gate.sh check_fingerprint in
// `done` mode — the dashboard never re-hashes the tree).
// ---------------------------------------------------------------------------

test('tier-1 blank checks column -> accepted row is blocked (no longer accepts with zero verdicts)', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['t1-blank', '1', '-', 'accepted', '0', 'worker-local', 'blank checks']]);
  writeManifest(dir, 't1-blank', 0);
  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 't1-blank');
  assert.equal(task.derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.message.includes('t1-blank') && e.message.includes('checks column')));
});

test('tier-3: a named checker that never ran blocks even with two lanes of PASS', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['t3-named', '3', 'tests,a11y,second', 'accepted', '1', 'worker-coder', 'a11y skipped']]);
  writeDualLanePasses(dir, 't3-named', 1);
  writeOracle(dir, 't3-named');
  writeFile(dir, 'tier3/t3-named/oracle.1.log', 'ORACLE PASS\n');
  let state = parse(dir);
  let task = state.tasks.find((t) => t.id === 't3-named');
  assert.equal(task.derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.message.includes('missing PASS from checker-a11y')));
  writeVerdict(dir, { task: 't3-named', attempt: 1, checker: 'checker-a11y', verdict: 'PASS', family: 'anthropic' });
  state = parse(dir);
  task = state.tasks.find((t) => t.id === 't3-named');
  assert.equal(task.derived.state, 'accepted');
});

test('tier-3: empty checks column -> blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['t3-blank', '3', '-', 'accepted', '1', 'worker-coder', 'blank checks']]);
  writeDualLanePasses(dir, 't3-blank', 1);
  writeOracle(dir, 't3-blank');
  writeFile(dir, 'tier3/t3-blank/oracle.1.log', 'ORACLE PASS\n');
  const state = parse(dir);
  assert.equal(state.tasks.find((t) => t.id === 't3-blank').derived.state, 'blocked');
});

test('fingerprint: accepted row with no .sha256 sidecar -> blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['fp-none', '1', 'tests', 'accepted', '1', 'worker-coder', 'no sidecar']]);
  writeVerdict(dir, { task: 'fp-none', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  fs.rmSync(path.join(dir, 'manifests/fp-none.1.sha256'));
  const state = parse(dir);
  const task = state.tasks.find((t) => t.id === 'fp-none');
  assert.equal(task.derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.message.includes('fp-none') && e.message.includes('sha256')));
});

test('fingerprint: checker PASS without MANIFEST_SHA256 -> blocked; judges need none', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['fp-nohdr', '1', 'tests', 'accepted', '1', 'worker-coder', 'old-shape verdict'],
    ['fp-judges', '2', 'tests', 'accepted', '1', 'worker-coder', 'overruled dispute'],
  ]);
  writeVerdict(dir, { task: 'fp-nohdr', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic', fingerprint: false });
  writeVerdict(dir, { task: 'fp-judges', attempt: 1, checker: 'checker-tests', verdict: 'FAIL', family: 'anthropic', fingerprint: false });
  writeVerdict(dir, { task: 'fp-judges', attempt: 1, checker: 'judge-claude', verdict: 'OVERRULE', family: 'anthropic', fingerprint: false });
  writeVerdict(dir, { task: 'fp-judges', attempt: 1, checker: 'judge-standards', verdict: 'OVERRULE', family: 'adversarial', fingerprint: false });
  writeVerdict(dir, { task: 'fp-judges', attempt: 1, checker: 'judge-impact', verdict: 'OVERRULE', family: 'impact', fingerprint: false });
  const state = parse(dir);
  assert.equal(state.tasks.find((t) => t.id === 'fp-nohdr').derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.message.includes('fp-nohdr') && e.message.includes('MANIFEST_SHA256')));
  assert.equal(state.tasks.find((t) => t.id === 'fp-judges').derived.state, 'accepted');
});

test('fingerprint: MANIFEST_SHA256 that does not match the sidecar -> blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['fp-wrong', '1', 'tests', 'accepted', '1', 'worker-coder', 'stale hash']]);
  writeVerdict(dir, { task: 'fp-wrong', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic', fingerprint: 'a'.repeat(64) });
  const state = parse(dir);
  assert.equal(state.tasks.find((t) => t.id === 'fp-wrong').derived.state, 'blocked');
});

test('fingerprint: a manifest path with no sidecar line -> blocked', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['fp-short', '1', 'tests', 'accepted', '1', 'worker-coder', 'sidecar incomplete']]);
  writeManifest(dir, 'fp-short', 1, ['src/a.go', 'src/b.go']);
  const side = path.join(dir, 'manifests/fp-short.1.sha256');
  fs.writeFileSync(side, fs.readFileSync(side, 'utf8').split('\n').filter((l) => !l.endsWith('src/b.go')).join('\n') + '\n');
  writeVerdict(dir, { task: 'fp-short', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
  const state = parse(dir);
  assert.equal(state.tasks.find((t) => t.id === 'fp-short').derived.state, 'blocked');
});

// ---------------------------------------------------------------------------
// inline escalation triggers (gate.sh escalation_reasons, ruling 2026-09-29e).
// With no flag FILE on disk, `gate.sh check` recomputes the triggers and
// refuses an accepted row whose triggers are live below its target tier.
// Every fixture here carries a genuine quorum, so only a trigger stands
// between the row and 'accepted'.
// ---------------------------------------------------------------------------

const taskOf = (state, id) => state.tasks.find((t) => t.id === id);
const mismatchesOf = (state, id) =>
  state.errors
    .filter((e) => e.file === 'ledger.tsv' && e.message.startsWith(`task ${id}:`))
    .map((e) => e.message);

function writeVerdicts(dir, task, attempt, rows) {
  for (const [checker, family, verdict] of rows) {
    writeVerdict(dir, { task, attempt, checker, verdict, family });
  }
}

test('escalation: accepted row with a critical-glob hit and no flag file -> flagged, mismatch names the trigger', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['esc-crit', '2', 'tests', 'accepted', '1', 'w', 'r']]);
  writeManifest(dir, 'esc-crit', 1, ['swarm/x.sh']);
  writeVerdicts(dir, 'esc-crit', 1, [['checker-tests', 'anthropic', 'PASS']]);
  writeFile(dir, 'critical.globs', 'swarm/**\n');

  const state = parse(dir);
  const task = taskOf(state, 'esc-crit');
  assert.equal(task.derived.state, 'flagged');
  assert.equal(task.flag, null, 'no flag file exists, so there is no open flag to show');
  assert.equal(state.summary.accepted, 0);
  assert.equal(state.summary.flagsOpen, 0);
  assert.deepEqual(mismatchesOf(state, 'esc-crit'), [
    'task esc-crit: ledger says accepted but escalation trigger (critical-glob) and no flag — run gate.sh escalate-scan',
  ]);
  assert.equal(fs.existsSync(path.join(dir, 'flags')), false, 'parse() is read-only: it must never write a flag');
});

test('escalation: all three triggers are listed in gate order, on a tier-1 row the tier check alone would accept', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['esc-all', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
  writeManifest(dir, 'esc-all', 1, ['swarm/x.sh']);
  writeVerdicts(dir, 'esc-all', 1, [
    ['checker-second', 'adversarial', 'FAIL'],
    ['boss', 'anthropic', 'OVERRULE'],
  ]);
  writeVerdicts(dir, 'esc-all', 2, [
    ['checker-second', 'adversarial', 'FAIL'],
    ['checker-a11y', 'anthropic', 'PASS'],
  ]);
  writeFile(dir, 'critical.globs', 'swarm/**\n');

  const state = parse(dir);
  assert.equal(taskOf(state, 'esc-all').derived.state, 'flagged');
  assert.deepEqual(mismatchesOf(state, 'esc-all'), [
    'task esc-all: ledger says accepted but escalation trigger (two-consecutive-fails checker-overruled critical-glob) and no flag — run gate.sh escalate-scan',
  ]);
});

test('escalation: the trigger is decided before any quorum test (no verdicts at all still reads flagged)', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['esc-noquorum', '2', 'tests', 'accepted', '1', 'w', 'r'],
    ['esc-plain', '2', 'tests', 'accepted', '1', 'w', 'r'],
  ]);
  writeManifest(dir, 'esc-noquorum', 1, ['swarm/x.sh']);
  writeManifest(dir, 'esc-plain', 1, ['src/ok.txt']);
  writeFile(dir, 'critical.globs', 'swarm/**\n');

  const state = parse(dir);
  assert.equal(taskOf(state, 'esc-noquorum').derived.state, 'flagged');
  assert.deepEqual(mismatchesOf(state, 'esc-noquorum'), [
    'task esc-noquorum: ledger says accepted but escalation trigger (critical-glob) and no flag — run gate.sh escalate-scan',
  ]);
  // Control: without a trigger the same evidence is an ordinary quorum failure.
  assert.equal(taskOf(state, 'esc-plain').derived.state, 'blocked');
  assert.match(mismatchesOf(state, 'esc-plain')[0], /missing PASS from checker-tests/);
});

test('escalation: a tier-3 row is never blocked by an inline trigger (target tier is capped at 3)', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['esc-t3', '3', 'tests,second', 'accepted', '2', 'w', 'r']]);
  writeManifest(dir, 'esc-t3', 1, ['swarm/x.sh']);
  writeVerdicts(dir, 'esc-t3', 1, [['boss', 'anthropic', 'OVERRULE']]);
  writeManifest(dir, 'esc-t3', 2, ['swarm/x.sh']);
  writeDualLanePasses(dir, 'esc-t3', 2);
  writeOracle(dir, 'esc-t3');
  writeFile(dir, 'tier3/esc-t3/oracle.2.log', 'ORACLE PASS\n');
  writeFile(dir, 'critical.globs', 'swarm/**\n');

  const state = parse(dir);
  assert.equal(taskOf(state, 'esc-t3').derived.state, 'accepted');
  assert.deepEqual(mismatchesOf(state, 'esc-t3'), []);
});

test('escalation: only rows ledgered accepted are re-stated (a checking row with a hit stays checking)', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['esc-checking', '2', 'tests', 'checking', '1', 'w', 'r']]);
  writeManifest(dir, 'esc-checking', 1, ['swarm/x.sh']);
  writeVerdicts(dir, 'esc-checking', 1, [['checker-tests', 'anthropic', 'PASS']]);
  writeFile(dir, 'critical.globs', 'swarm/**\n');

  const state = parse(dir);
  assert.equal(taskOf(state, 'esc-checking').derived.state, 'checking');
  assert.deepEqual(mismatchesOf(state, 'esc-checking'), []);
});

test('escalation: a flag FILE on disk keeps today\'s flag logic and suppresses the inline check', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['esc-closed', '2', 'tests', 'accepted', '1', 'w', 'r'],
    ['esc-open', '2', 'tests', 'accepted', '1', 'w', 'r'],
  ]);
  for (const id of ['esc-closed', 'esc-open']) {
    writeManifest(dir, id, 1, ['swarm/x.sh']);
    writeVerdicts(dir, id, 1, [['checker-tests', 'anthropic', 'PASS']]);
  }
  writeFile(dir, 'critical.globs', 'swarm/**\n');
  writeFile(dir, 'flags/esc-closed.flag', 'TARGET_TIER: 2\nREASON: critical-glob\n'); // closed: ledger tier >= target
  writeFile(dir, 'flags/esc-open.flag', 'TARGET_TIER: 3\nREASON: critical-glob\n');

  const state = parse(dir);
  assert.equal(taskOf(state, 'esc-closed').derived.state, 'accepted');
  assert.deepEqual(mismatchesOf(state, 'esc-closed'), []);
  assert.equal(taskOf(state, 'esc-open').derived.state, 'flagged');
  assert.deepEqual(mismatchesOf(state, 'esc-open'), [
    'task esc-open: ledger says accepted but escalation flag open (target tier 3)',
  ]);
});

test('escalation: two-consecutive-fails counts every valid judge verdict (no identity de-duplication), needs >=3 and a strict majority', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['esc-dup', '1', 'a11y', 'accepted', '2', 'w', 'r'],
    ['esc-short', '1', 'a11y', 'accepted', '2', 'w', 'r'],
    ['esc-minor', '1', 'a11y', 'accepted', '2', 'w', 'r'],
    ['esc-tie', '1', 'a11y', 'accepted', '2', 'w', 'r'],
    ['esc-once', '1', 'a11y', 'accepted', '2', 'w', 'r'],
  ]);
  // Attempt 2 of every row: unresolved FAIL from an unnamed checker beside the
  // named PASS — tier 1 alone accepts it.
  for (const id of ['esc-dup', 'esc-short', 'esc-minor', 'esc-tie', 'esc-once']) {
    writeVerdicts(dir, id, 2, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
  }
  // esc-dup: three OVERRULEs sharing one FAMILY still set the FAIL aside.
  writeVerdicts(dir, 'esc-dup', 1, [
    ['checker-second', 'adversarial', 'FAIL'],
    ['judge-a', 'anthropic', 'OVERRULE'],
    ['judge-b', 'anthropic', 'OVERRULE'],
    ['judge-c', 'anthropic', 'OVERRULE'],
  ]);
  // esc-short: two OVERRULEs are too few to set it aside.
  writeVerdicts(dir, 'esc-short', 1, [
    ['checker-second', 'adversarial', 'FAIL'],
    ['judge-claude', 'anthropic', 'OVERRULE'],
    ['judge-standards', 'adversarial', 'OVERRULE'],
  ]);
  // esc-minor: three verdicts, OVERRULE in the minority.
  writeVerdicts(dir, 'esc-minor', 1, [
    ['checker-second', 'adversarial', 'FAIL'],
    ['judge-claude', 'anthropic', 'OVERRULE'],
    ['judge-standards', 'adversarial', 'UPHOLD'],
    ['judge-impact', 'impact', 'UPHOLD'],
  ]);
  // esc-tie: four verdicts split 2-2 — the OVERRULE majority must be strict.
  writeVerdicts(dir, 'esc-tie', 1, [
    ['checker-second', 'adversarial', 'FAIL'],
    ['judge-a', 'anthropic', 'OVERRULE'],
    ['judge-b', 'adversarial', 'OVERRULE'],
    ['judge-c', 'impact', 'UPHOLD'],
    ['judge-d', 'anthropic', 'UPHOLD'],
  ]);
  // esc-once: attempt 1 has no FAIL at all, so the FAILs are not consecutive.
  writeVerdicts(dir, 'esc-once', 1, [['checker-a11y', 'anthropic', 'PASS']]);

  const state = parse(dir);
  assert.equal(taskOf(state, 'esc-dup').derived.state, 'accepted');
  assert.equal(taskOf(state, 'esc-once').derived.state, 'accepted');
  for (const id of ['esc-short', 'esc-minor', 'esc-tie']) {
    assert.equal(taskOf(state, id).derived.state, 'flagged', id);
    assert.deepEqual(mismatchesOf(state, id), [
      `task ${id}: ledger says accepted but escalation trigger (two-consecutive-fails) and no flag — run gate.sh escalate-scan`,
    ]);
  }
});

test('escalation: a boss OVERRULE counts at ANY attempt, but only for the task that owns the file', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['esc-boss', '1', 'tests', 'accepted', '3', 'w', 'r'],
    ['esc-boss.1.x', '1', 'tests', 'accepted', '1', 'w', 'r'],
    ['esc-judge', '1', 'tests', 'accepted', '1', 'w', 'r'],
  ]);
  writeVerdicts(dir, 'esc-boss', 1, [['boss', 'anthropic', 'OVERRULE']]);
  writeVerdicts(dir, 'esc-boss', 3, [['checker-tests', 'anthropic', 'PASS']]);
  // A dot-prefix sibling's boss verdict lies in esc-boss's `esc-boss.*.verdict`
  // glob but belongs to esc-boss.1.x.
  writeVerdicts(dir, 'esc-boss.1.x', 1, [['checker-tests', 'anthropic', 'PASS']]);
  writeVerdicts(dir, 'esc-judge', 1, [['checker-tests', 'anthropic', 'PASS'], ['judge-claude', 'anthropic', 'OVERRULE']]);

  const state = parse(dir);
  assert.equal(taskOf(state, 'esc-boss').derived.state, 'flagged');
  assert.match(mismatchesOf(state, 'esc-boss')[0], /escalation trigger \(checker-overruled\) and no flag/);
  assert.equal(taskOf(state, 'esc-boss.1.x').derived.state, 'accepted');
  assert.equal(taskOf(state, 'esc-judge').derived.state, 'accepted', 'only CHECKER: boss counts, not any OVERRULE');
});

// The glob battery: one swarm-wide critical.globs, one task per path. `hit` is
// what gate.sh's python3 (`fnmatch` + the `**/` and `/**` candidates + the
// default test-glob exemption) says for that path — pinned from a real run of
// the gate's own matcher, so a JS reimplementation that drifts fails here.
const GLOB_BATTERY_GLOBS = [
  '# swarm/** (a comment line, never a glob)',
  '  #hash/*', // '#' is tested on the RAW line: indented, this IS the glob '#hash/*'
  'src/a?.go',
  'lib/[abc]/*.txt',
  'lib/[!abc]/*.md',
  'docs/**/*.md',
  '**/Makefile',
  '*.lock',
  '[[]x]/f',
  '[a-c-e]z',
  'web/[z-a]/q', // reversed range: matches nothing
  'web/[!z-a]/r', // negated reversed range: matches any one character
  'web/[z-a!]/s', // python quirk: the reversed range vanishes and leaves a bare '!', which reads as "any character"
  '   pad/tab.txt   ', // surrounding whitespace is stripped
  'vendor/**',
];
const GLOB_BATTERY = [
  ['swarm/x.sh', false],
  ['#hash/a', true],
  ['src/ab.go', true],
  ['src/abc.go', false],
  [`src/a${String.fromCodePoint(0x1f600)}.go`, true], // `?` is one code point, not one UTF-16 unit
  ['lib/a/f.txt', true],
  ['lib/d/f.txt', false],
  ['lib/d/f.md', true],
  ['lib/a/f.md', false],
  ['docs/x/y.md', true],
  ['docs/y.md', false],
  ['Makefile', true], // **/Makefile also tries Makefile
  ['a/b/Makefile', true],
  ['MAKEFILE', false], // case-sensitive
  ['yarn.lock', true],
  ['sub/yarn.lock', true], // `*` crosses '/'
  ['[x]/f', true],
  ['x/f', false],
  ['az', true],
  ['-z', true],
  ['ez', true],
  ['dz', false],
  ['web/m/q', false],
  ['web/m/r', true],
  ['web/mm/r', false],
  ['web/m/s', true],
  ['web/mm/s', false],
  ['pad/tab.txt', true],
  ['vendor/foo.go', true],
  ['vendor/foo_test.go', false], // exempted by the default test glob **/*_test.go
  ['vendor/tests/x', true], // tests/** is anchored at the root: not exempt here
];

function writeGlobBattery(dir) {
  const ids = GLOB_BATTERY.map((_, i) => `gb${i}`);
  writeLedger(dir, ids.map((id) => [id, '2', 'tests', 'accepted', '1', 'w', 'r']));
  GLOB_BATTERY.forEach(([p], i) => {
    writeManifest(dir, ids[i], 1, [p]);
    writeVerdicts(dir, ids[i], 1, [['checker-tests', 'anthropic', 'PASS']]);
  });
  writeFile(dir, 'critical.globs', GLOB_BATTERY_GLOBS.join('\n') + '\n');
  return ids;
}

test('critical-glob: python fnmatch semantics, the gate\'s extra candidates and the default test-glob exemption', () => {
  const dir = makeSwarmDir();
  const ids = writeGlobBattery(dir);
  const state = parse(dir);
  GLOB_BATTERY.forEach(([p, hit], i) => {
    assert.equal(
      taskOf(state, ids[i]).derived.state,
      hit ? 'flagged' : 'accepted',
      `manifest path ${JSON.stringify(p)} should ${hit ? '' : 'not '}be a critical-glob hit`
    );
  });
});

test('critical-glob: a present test.globs REPLACES the defaults; an absent critical.globs never triggers', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['cg-default', '2', 'tests', 'accepted', '1', 'w', 'r'],
    ['cg-nomatch', '2', 'tests', 'accepted', '1', 'w', 'r'],
  ]);
  for (const id of ['cg-default', 'cg-nomatch']) {
    writeManifest(dir, id, 1, ['swarm/x_test.go']);
    writeVerdicts(dir, id, 1, [['checker-tests', 'anthropic', 'PASS']]);
  }
  // No critical.globs yet: nothing can trigger.
  assert.equal(taskOf(parse(dir), 'cg-default').derived.state, 'accepted');
  writeFile(dir, 'critical.globs', 'swarm/**\n');
  // Default test globs exempt swarm/x_test.go.
  assert.equal(taskOf(parse(dir), 'cg-default').derived.state, 'accepted');
  // A test.globs that does not name it replaces the defaults: now a hit.
  writeFile(dir, 'test.globs', 'nomatch\n');
  assert.equal(taskOf(parse(dir), 'cg-nomatch').derived.state, 'flagged');
  // ...and one that names it exempts it.
  writeFile(dir, 'test.globs', 'swarm/x_test.go\n');
  assert.equal(taskOf(parse(dir), 'cg-nomatch').derived.state, 'accepted');
});

test('critical-glob: reads EVERY manifest the gate\'s <task>.*.files glob matches, older attempts included', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['cg-old', '2', 'tests', 'accepted', '2', 'w', 'r']]);
  writeManifest(dir, 'cg-old', 1, ['swarm/x.sh']);
  writeManifest(dir, 'cg-old', 2, ['src/ok.txt']);
  writeVerdicts(dir, 'cg-old', 2, [['checker-tests', 'anthropic', 'PASS']]);
  writeFile(dir, 'critical.globs', 'swarm/**\n');

  const state = parse(dir);
  assert.equal(taskOf(state, 'cg-old').derived.state, 'flagged');
  assert.match(mismatchesOf(state, 'cg-old')[0], /escalation trigger \(critical-glob\)/);
});

// ---------------------------------------------------------------------------
// differential run against swarm/gate.sh — the anti-lie property, tested
// mechanically: for every fixture below (all rows ledgered 'accepted'),
// `gate.sh check <task>` exits 0 exactly when derived.state === 'accepted'.
// ---------------------------------------------------------------------------

const GATE_SH = fileURLToPath(new URL('../../swarm/gate.sh', import.meta.url));

function gateCheck(swarmDir, taskId) {
  const res = spawnSync('bash', [GATE_SH, 'check', taskId], {
    env: { ...process.env, SWARM_DIR: swarmDir, SWARM_TREE: path.join(swarmDir, 'tree') },
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
  ['tier-1 blank checks column', (dir) => {
    writeLedger(dir, [['d1b', '1', '-', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'd1b', 1);
    return ['d1b'];
  }],
  ['tier-3 named checker never ran', (dir) => {
    writeLedger(dir, [['d3n', '3', 'tests,a11y,second', 'accepted', '1', 'w', 'r']]);
    writeDualLanePasses(dir, 'd3n', 1);
    writeOracle(dir, 'd3n');
    writeFile(dir, 'tier3/d3n/oracle.1.log', 'ORACLE PASS\n');
    return ['d3n'];
  }],
  ['tier-3 stale report.md beside a green oracle', (dir) => {
    writeLedger(dir, [['d3r', '3', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeDualLanePasses(dir, 'd3r', 1);
    writeOracle(dir, 'd3r');
    writeFile(dir, 'tier3/d3r/oracle.1.log', 'ORACLE PASS\n');
    writeFile(dir, 'tier3/d3r/report.md', 'RESOLUTION: merged\n');
    return ['d3r'];
  }],
  ['fingerprint header missing / mismatched / sidecar missing', (dir) => {
    writeLedger(dir, [
      ['dfa', '1', 'tests', 'accepted', '1', 'w', 'r'],
      ['dfb', '1', 'tests', 'accepted', '1', 'w', 'r'],
      ['dfc', '1', 'tests', 'accepted', '1', 'w', 'r'],
    ]);
    writeVerdict(dir, { task: 'dfa', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic', fingerprint: false });
    writeVerdict(dir, { task: 'dfb', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic', fingerprint: 'b'.repeat(64) });
    writeVerdict(dir, { task: 'dfc', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
    fs.rmSync(path.join(dir, 'manifests/dfc.1.sha256'));
    return ['dfa', 'dfb', 'dfc'];
  }],
  ['tier-3 green oracle + quorum + malformed extra', (dir) => {
    writeLedger(dir, [['d3j', '3', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeDualLanePasses(dir, 'd3j', 1);
    writeOracle(dir, 'd3j');
    writeFile(dir, 'tier3/d3j/oracle.1.log', 'ORACLE PASS\n');
    writeFile(dir, 'verdicts/d3j.1.checker-rogue.verdict', 'VERDICT: PASS\nFAMILY: anthropic\n');
    return ['d3j'];
  }],

  // --- inline escalation triggers (ruling 2026-09-29e) ----------------------
  // Each row below carries the evidence its tier demands, so only an inline
  // trigger (or its absence) decides whether the gate accepts. No flag files
  // unless the scenario names one.
  ['tier-2 manifest path in critical.globs, no flag file', (dir) => {
    writeLedger(dir, [['e1', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e1', 1, ['swarm/x.sh']);
    writeVerdicts(dir, 'e1', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    return ['e1'];
  }],
  ['tier-2 critical.globs present, manifest path outside it', (dir) => {
    writeLedger(dir, [['e2', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e2', 1, ['swarm/x.sh']);
    writeVerdicts(dir, 'e2', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'nomatch/**\n');
    return ['e2'];
  }],
  ['tier-2 critical path that a default test glob exempts', (dir) => {
    writeLedger(dir, [['e3', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e3', 1, ['swarm/x_test.go']);
    writeVerdicts(dir, 'e3', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    return ['e3'];
  }],
  ['tier-2 critical path that a present test.globs exempts', (dir) => {
    writeLedger(dir, [['e4', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e4', 1, ['swarm/probe.sh']);
    writeVerdicts(dir, 'e4', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    writeFile(dir, 'test.globs', 'swarm/probe.sh\n');
    return ['e4'];
  }],
  ['tier-2 default-test-glob path with a test.globs that replaces the defaults', (dir) => {
    writeLedger(dir, [['e5', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e5', 1, ['swarm/x_test.go']);
    writeVerdicts(dir, 'e5', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    writeFile(dir, 'test.globs', 'nomatch\n');
    return ['e5'];
  }],
  ['tier-2 default-test-glob path with an empty test.globs', (dir) => {
    writeLedger(dir, [['e5b', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e5b', 1, ['swarm/x_test.go']);
    writeVerdicts(dir, 'e5b', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    writeFile(dir, 'test.globs', '# nothing is exempt\n');
    return ['e5b'];
  }],
  ['tier-2 **/X glob and X at the repo root', (dir) => {
    writeLedger(dir, [['e6', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e6', 1, ['gate.sh']);
    writeVerdicts(dir, 'e6', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', '**/gate.sh\n');
    return ['e6'];
  }],
  ['tier-2 critical path only in an older attempt\'s manifest', (dir) => {
    writeLedger(dir, [['e7', '2', 'tests', 'accepted', '2', 'w', 'r']]);
    writeManifest(dir, 'e7', 1, ['swarm/x.sh']);
    writeManifest(dir, 'e7', 2, ['src/ok.txt']);
    writeVerdicts(dir, 'e7', 2, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    return ['e7'];
  }],
  ['tier-3 green oracle + quorum + critical path', (dir) => {
    writeLedger(dir, [['e8', '3', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e8', 1, ['swarm/x.sh']);
    writeDualLanePasses(dir, 'e8', 1);
    writeOracle(dir, 'e8');
    writeFile(dir, 'tier3/e8/oracle.1.log', 'ORACLE PASS\n');
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    return ['e8'];
  }],
  ['tier-2 critical path beside a CLOSED flag file', (dir) => {
    writeLedger(dir, [['e9', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e9', 1, ['swarm/x.sh']);
    writeVerdicts(dir, 'e9', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    writeFile(dir, 'flags/e9.flag', 'TARGET_TIER: 2\nREASON: critical-glob\n');
    return ['e9'];
  }],
  ['tier-2 critical path beside an OPEN flag file', (dir) => {
    writeLedger(dir, [['e9o', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e9o', 1, ['swarm/x.sh']);
    writeVerdicts(dir, 'e9o', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    writeFile(dir, 'flags/e9o.flag', 'TARGET_TIER: 3\nREASON: critical-glob\n');
    return ['e9o'];
  }],
  ['tier-1 boss OVERRULE at an older attempt', (dir) => {
    writeLedger(dir, [['e10', '1', 'tests', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'e10', 1, [['checker-tests', 'anthropic', 'FAIL'], ['boss', 'anthropic', 'OVERRULE']]);
    writeVerdicts(dir, 'e10', 2, [['checker-tests', 'anthropic', 'PASS']]);
    return ['e10'];
  }],
  ['tier-3 green oracle + quorum + boss OVERRULE at an older attempt', (dir) => {
    writeLedger(dir, [['e11', '3', 'tests,second', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'e11', 1, [['boss', 'anthropic', 'OVERRULE']]);
    writeDualLanePasses(dir, 'e11', 2);
    writeOracle(dir, 'e11');
    writeFile(dir, 'tier3/e11/oracle.2.log', 'ORACLE PASS\n');
    return ['e11'];
  }],
  ['tier-1 unresolved FAILs at attempts 1 and 2 beside the named PASS', (dir) => {
    writeLedger(dir, [['e12', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'e12', 1, [['checker-second', 'adversarial', 'FAIL']]);
    writeVerdicts(dir, 'e12', 2, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
    return ['e12'];
  }],
  ['tier-1 FAIL at attempt 1 only, named PASS at attempt 2', (dir) => {
    writeLedger(dir, [['e13', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'e13', 1, [['checker-second', 'adversarial', 'FAIL']]);
    writeVerdicts(dir, 'e13', 2, [['checker-a11y', 'anthropic', 'PASS']]);
    return ['e13'];
  }],
  ['tier-1 attempt-1 FAIL set aside by three same-family judges (no identity de-dup), unresolved FAIL at attempt 2', (dir) => {
    writeLedger(dir, [['e14', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'e14', 1, [
      ['checker-second', 'adversarial', 'FAIL'],
      ['judge-a', 'anthropic', 'OVERRULE'],
      ['judge-b', 'anthropic', 'OVERRULE'],
      ['judge-c', 'anthropic', 'OVERRULE'],
    ]);
    writeVerdicts(dir, 'e14', 2, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
    return ['e14'];
  }],
  ['tier-1 attempt-1 FAIL with a two-judge panel, unresolved FAIL at attempt 2', (dir) => {
    writeLedger(dir, [['e15', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'e15', 1, [
      ['checker-second', 'adversarial', 'FAIL'],
      ['judge-claude', 'anthropic', 'OVERRULE'],
      ['judge-standards', 'adversarial', 'OVERRULE'],
    ]);
    writeVerdicts(dir, 'e15', 2, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
    return ['e15'];
  }],
  ['tier-1 attempt-1 FAIL with a 2-2 judge panel, unresolved FAIL at attempt 2', (dir) => {
    writeLedger(dir, [['e15s', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'e15s', 1, [
      ['checker-second', 'adversarial', 'FAIL'],
      ['judge-a', 'anthropic', 'OVERRULE'],
      ['judge-b', 'adversarial', 'OVERRULE'],
      ['judge-c', 'impact', 'UPHOLD'],
      ['judge-d', 'anthropic', 'UPHOLD'],
    ]);
    writeVerdicts(dir, 'e15s', 2, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
    return ['e15s'];
  }],
  ['tier-1 attempt-1 FAIL with an OVERRULE/UPHOLD/UPHOLD panel, unresolved FAIL at attempt 2', (dir) => {
    writeLedger(dir, [['e15t', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'e15t', 1, [
      ['checker-second', 'adversarial', 'FAIL'],
      ['judge-claude', 'anthropic', 'OVERRULE'],
      ['judge-standards', 'adversarial', 'UPHOLD'],
      ['judge-impact', 'impact', 'UPHOLD'],
    ]);
    writeVerdicts(dir, 'e15t', 2, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
    return ['e15t'];
  }],
  ['tier-1 FAILs at attempts 0 and 1', (dir) => {
    writeLedger(dir, [['e16', '1', 'a11y', 'accepted', '1', 'w', 'r']]);
    writeVerdicts(dir, 'e16', 0, [['checker-second', 'adversarial', 'FAIL']]);
    writeVerdicts(dir, 'e16', 1, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
    return ['e16'];
  }],
  ['tier-1 sibling task\'s boss OVERRULE lies in the dot-prefix glob (both tasks checked)', (dir) => {
    writeLedger(dir, [
      ['e17', '1', 'tests', 'accepted', '1', 'w', 'r'],
      ['e17.1.x', '1', 'tests', 'accepted', '2', 'w', 'r'],
    ]);
    writeVerdicts(dir, 'e17', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeVerdicts(dir, 'e17.1.x', 1, [['boss', 'anthropic', 'OVERRULE']]);
    writeVerdicts(dir, 'e17.1.x', 2, [['checker-tests', 'anthropic', 'PASS']]);
    return ['e17', 'e17.1.x'];
  }],
  ['tier-1 sibling task\'s critical manifest lies in the dot-prefix glob (both tasks checked)', (dir) => {
    writeLedger(dir, [
      ['e18', '1', 'tests', 'accepted', '1', 'w', 'r'],
      ['e18.1.x', '1', 'tests', 'accepted', '1', 'w', 'r'],
    ]);
    writeManifest(dir, 'e18', 1, ['src/ok.txt']);
    writeVerdicts(dir, 'e18', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeManifest(dir, 'e18.1.x', 1, ['swarm/x.sh']);
    writeVerdicts(dir, 'e18.1.x', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    return ['e18', 'e18.1.x'];
  }],
  ['tier-2 critical.globs with comment, whitespace, class, ? and ** lines, one manifest path per task', writeGlobBattery],
  ['tier-2 critical.globs that is not valid UTF-8', (dir) => {
    writeLedger(dir, [['e19', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e19', 1, ['swarm/x.sh']);
    writeVerdicts(dir, 'e19', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', Buffer.concat([Buffer.from('swarm/**\n'), Buffer.from([0xff, 0x0a])]));
    return ['e19'];
  }],
  ['tier-2 critical.globs that starts with a UTF-8 BOM', (dir) => {
    writeLedger(dir, [['e20', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeManifest(dir, 'e20', 1, ['swarm/x.sh']);
    writeVerdicts(dir, 'e20', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('swarm/**\n')]));
    return ['e20'];
  }],
  ['tier-2 critical.globs with CRLF line endings and a lone-CR line break', (dir) => {
    writeLedger(dir, [
      ['e21', '2', 'tests', 'accepted', '1', 'w', 'r'],
      ['e21b', '2', 'tests', 'accepted', '1', 'w', 'r'],
    ]);
    writeManifest(dir, 'e21', 1, ['swarm/x.sh']);
    writeVerdicts(dir, 'e21', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeManifest(dir, 'e21b', 1, ['lib/y.sh']);
    writeVerdicts(dir, 'e21b', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', '# header\r\nswarm/**\rlib/**\r\n');
    return ['e21', 'e21b'];
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
