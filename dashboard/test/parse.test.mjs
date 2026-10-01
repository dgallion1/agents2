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
// lane accounting (run CD, CD2) — mirrors gate.sh load_verdict. PASS/FAIL are
// valid only from a CHECKER starting `checker-`; UPHOLD/OVERRULE only from one
// starting `judge-` or exactly `boss`. Any other pairing is an INVALID verdict
// file: excluded from the quorum, reported in errors[], and (at tiers 2/3)
// blocking the row like every other invalid current-attempt file.
// ---------------------------------------------------------------------------

const pairingMessage = (verdict, checker) =>
  `VERDICT ${verdict} not allowed from CHECKER '${checker}' ` +
  `(PASS/FAIL come from checker-*; UPHOLD/OVERRULE from judge-* or boss)`;

// [CHECKER, VERDICT] pairs that must be INVALID: wrong verdict class for the
// prefix, exact identity boundaries (`boss-2`, `Boss`, bare `checker`/`judge`,
// `checkerx-y`), and identities that may cast nothing.
const INVALID_PAIRINGS = [
  ['judge-x', 'PASS'],
  ['judge-x', 'FAIL'],
  ['boss', 'PASS'],
  ['boss', 'FAIL'],
  ['checker-rogue', 'UPHOLD'],
  ['checker-rogue', 'OVERRULE'],
  ['worker-coder', 'PASS'],
  ['worker-coder', 'OVERRULE'],
  ['lead', 'UPHOLD'],
  ['checker', 'PASS'],
  ['checkerx-y', 'PASS'],
  ['judge', 'OVERRULE'],
  ['boss-2', 'OVERRULE'],
  ['Boss', 'OVERRULE'],
];

test('lane accounting: every mis-paired VERDICT/CHECKER is excluded and reported naming both', () => {
  const dir = makeSwarmDir();
  const ids = INVALID_PAIRINGS.map((_, i) => `lp${i}`);
  writeLedger(dir, ids.map((id) => [id, '2', 'tests', 'checking', '1', 'w', 'r']));
  INVALID_PAIRINGS.forEach(([checker, verdict], i) => {
    writeVerdict(dir, { task: ids[i], attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'anthropic' });
    writeVerdict(dir, { task: ids[i], attempt: 1, checker, verdict, family: 'impact' });
  });
  const state = parse(dir);
  INVALID_PAIRINGS.forEach(([checker, verdict], i) => {
    const t = taskOf(state, ids[i]);
    assert.deepEqual(t.verdicts.map((v) => v.checker), ['checker-tests'], `${verdict} from '${checker}' must be excluded`);
    const hit = state.errors.find((e) => e.file === `verdicts/${ids[i]}.1.${checker}.verdict`);
    assert.ok(hit, `${verdict} from '${checker}' must be reported in errors[]`);
    assert.equal(hit.message, pairingMessage(verdict, checker));
    assert.deepEqual(t.invalidVerdicts, [`${ids[i]}.1.${checker}.verdict`], `${verdict} from '${checker}' must be listed as invalid`);
  });
});

test('lane accounting: the valid pairings are admitted (checker PASS/FAIL, judge and boss UPHOLD/OVERRULE)', () => {
  const dir = makeSwarmDir();
  const ok = [
    ['checker-tests', 'PASS'],
    ['checker-second', 'FAIL'],
    ['checker-a', 'FAIL'],
    ['judge-x', 'UPHOLD'],
    ['judge-y', 'OVERRULE'],
    ['boss', 'UPHOLD'],
    ['boss', 'OVERRULE'],
  ];
  const ids = ok.map((_, i) => `lv${i}`);
  writeLedger(dir, ids.map((id) => [id, '2', 'tests', 'checking', '1', 'w', 'r']));
  ok.forEach(([checker, verdict], i) => {
    writeVerdict(dir, { task: ids[i], attempt: 1, checker, verdict, family: 'impact' });
  });
  const state = parse(dir);
  ok.forEach(([checker, verdict], i) => {
    assert.deepEqual(taskOf(state, ids[i]).verdicts.map((v) => `${v.checker}:${v.verdict}`), [`${checker}:${verdict}`]);
    assert.ok(!state.errors.some((e) => e.file.includes(`${ids[i]}.1.`)), `${verdict} from '${checker}' is valid`);
  });
});

test('lane accounting: a judge-named PASS cannot supply the second lane (GH-29f) — blocked, naming the invalid file', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [['la-t3', '3', 'tests', 'accepted', '1', 'w', 'r'], ['la-t2', '2', 'tests,second', 'accepted', '1', 'w', 'r']]);
  writeManifest(dir, 'la-t3', 1);
  writeVerdicts(dir, 'la-t3', 1, [['checker-tests', 'anthropic', 'PASS']]);
  // the reproduced file: judge-named, PASS, adversarial lane, NO MANIFEST_SHA256
  writeVerdict(dir, { task: 'la-t3', attempt: 1, checker: 'judge-x', verdict: 'PASS', family: 'adversarial', fingerprint: false });
  writeOracle(dir, 'la-t3');
  writeFile(dir, 'tier3/la-t3/oracle.1.log', 'ORACLE PASS\n');
  // tier 2 with `second` named: two same-lane checker PASSes + a judge-named PASS in the other lane
  writeVerdicts(dir, 'la-t2', 1, [
    ['checker-tests', 'anthropic', 'PASS'],
    ['checker-second', 'anthropic', 'PASS'],
    ['judge-x', 'adversarial', 'PASS'],
  ]);
  const state = parse(dir);
  for (const id of ['la-t3', 'la-t2']) {
    assert.equal(taskOf(state, id).derived.state, 'blocked', id);
    assert.deepEqual(mismatchesOf(state, id), [
      `task ${id}: ledger says accepted but invalid verdict file(s) at attempt 1: ${id}.1.judge-x.verdict`,
    ]);
    assert.ok(
      state.errors.some((e) => e.file === `verdicts/${id}.1.judge-x.verdict` && e.message === pairingMessage('PASS', 'judge-x')),
      id
    );
  }
});

test('lane accounting: tier 1 loads only the named checkers — an unnamed mis-paired stray does not block; a named file casting OVERRULE does', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['la-t1s', '1', 'tests', 'accepted', '1', 'w', 'r'],
    ['la-t1n', '1', 'tests', 'accepted', '1', 'w', 'r'],
  ]);
  writeVerdicts(dir, 'la-t1s', 1, [['checker-tests', 'anthropic', 'PASS'], ['judge-x', 'adversarial', 'PASS']]);
  writeVerdicts(dir, 'la-t1n', 1, [['checker-tests', 'anthropic', 'OVERRULE']]);
  const state = parse(dir);
  assert.equal(taskOf(state, 'la-t1s').derived.state, 'accepted');
  assert.equal(taskOf(state, 'la-t1n').derived.state, 'blocked');
  assert.ok(state.errors.some((e) => e.file === 'verdicts/la-t1n.1.checker-tests.verdict' && e.message === pairingMessage('OVERRULE', 'checker-tests')));
});

test('lane accounting: a checker-cast UPHOLD/OVERRULE never joins the judge panel; a boss UPHOLD does', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['la-panel', '2', 'tests', 'accepted', '1', 'w', 'r'],
    ['la-boss', '2', 'tests', 'accepted', '1', 'w', 'r'],
  ]);
  // two judge OVERRULEs + a checker-cast OVERRULE: the third vote is invalid
  writeVerdicts(dir, 'la-panel', 1, [
    ['checker-tests', 'anthropic', 'FAIL'],
    ['judge-claude', 'anthropic', 'OVERRULE'],
    ['judge-standards', 'adversarial', 'OVERRULE'],
    ['checker-rogue', 'impact', 'OVERRULE'],
  ]);
  // two judge OVERRULEs + a boss UPHOLD: three valid votes, OVERRULE majority
  writeVerdicts(dir, 'la-boss', 1, [
    ['checker-tests', 'anthropic', 'FAIL'],
    ['judge-standards', 'adversarial', 'OVERRULE'],
    ['judge-impact', 'impact', 'OVERRULE'],
    ['boss', 'anthropic', 'UPHOLD'],
  ]);
  const state = parse(dir);
  assert.equal(taskOf(state, 'la-panel').derived.state, 'blocked');
  assert.equal(taskOf(state, 'la-boss').derived.state, 'accepted');
});

test('lane accounting: a judge- or boss-cast FAIL is not a FAIL, and a checker-cast OVERRULE is not a vote — escalation triggers follow', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['la-jf', '1', 'a11y', 'accepted', '2', 'w', 'r'],
    ['la-bf', '1', 'a11y', 'accepted', '2', 'w', 'r'],
    ['la-cv', '1', 'a11y', 'accepted', '2', 'w', 'r'],
    ['la-bo', '1', 'a11y', 'accepted', '2', 'w', 'r'],
  ]);
  const attempt2 = [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']];
  // la-jf / la-bf: attempt 1's only FAIL is judge-/boss-cast (invalid), so attempt 2's FAIL is not the second in a row
  writeVerdicts(dir, 'la-jf', 1, [['judge-x', 'adversarial', 'FAIL']]);
  writeVerdicts(dir, 'la-bf', 1, [['boss', 'anthropic', 'FAIL']]);
  // la-cv: attempt 1's genuine FAIL is "set aside" by two judges and a checker-cast OVERRULE — only two valid votes, so it stays unresolved
  writeVerdicts(dir, 'la-cv', 1, [
    ['checker-second', 'adversarial', 'FAIL'],
    ['judge-claude', 'anthropic', 'OVERRULE'],
    ['judge-standards', 'adversarial', 'OVERRULE'],
    ['checker-rogue', 'impact', 'OVERRULE'],
  ]);
  // la-bo: `boss-2` / `Boss` cast nothing, so no checker-overruled trigger
  writeVerdicts(dir, 'la-bo', 1, [['boss-2', 'anthropic', 'OVERRULE'], ['Boss', 'adversarial', 'OVERRULE']]);
  for (const id of ['la-jf', 'la-bf', 'la-cv', 'la-bo']) writeVerdicts(dir, id, 2, attempt2);
  const state = parse(dir);
  assert.equal(taskOf(state, 'la-jf').derived.state, 'accepted');
  assert.equal(taskOf(state, 'la-bf').derived.state, 'accepted');
  assert.equal(taskOf(state, 'la-bo').derived.state, 'accepted');
  assert.equal(taskOf(state, 'la-cv').derived.state, 'flagged');
  assert.deepEqual(mismatchesOf(state, 'la-cv'), [
    'task la-cv: ledger says accepted but escalation trigger (two-consecutive-fails) and no flag — run gate.sh escalate-scan',
  ]);
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

  // --- lane accounting (run CD, CD2): who may cast which verdict -------------
  // Every PASS below is fingerprinted (writeVerdict stamps it), so a rejection
  // can only come from the VERDICT/CHECKER pairing rule, never from a missing
  // MANIFEST_SHA256. The reproduced hole (GH-29f) is the first scenario.
  ['tier-3 checker PASS + judge-named PASS supplying the second lane (GH-29f, no fingerprint)', (dir) => {
    writeLedger(dir, [['la1', '3', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdicts(dir, 'la1', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeVerdict(dir, { task: 'la1', attempt: 1, checker: 'judge-x', verdict: 'PASS', family: 'adversarial', fingerprint: false });
    writeOracle(dir, 'la1');
    writeFile(dir, 'tier3/la1/oracle.1.log', 'ORACLE PASS\n');
    return ['la1'];
  }],
  ['tier-3 checker PASS + fingerprinted judge-named PASS supplying the second lane', (dir) => {
    writeLedger(dir, [['la2', '3', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdicts(dir, 'la2', 1, [['checker-tests', 'anthropic', 'PASS'], ['judge-x', 'adversarial', 'PASS']]);
    writeOracle(dir, 'la2');
    writeFile(dir, 'tier3/la2/oracle.1.log', 'ORACLE PASS\n');
    return ['la2'];
  }],
  ['tier-2 second named, same-lane checker PASSes + judge-named PASS in the other lane', (dir) => {
    writeLedger(dir, [['la3', '2', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeVerdicts(dir, 'la3', 1, [
      ['checker-tests', 'anthropic', 'PASS'],
      ['checker-second', 'anthropic', 'PASS'],
      ['judge-x', 'adversarial', 'PASS'],
    ]);
    return ['la3'];
  }],
  ['tier-3 two genuine checker lanes (control)', (dir) => {
    writeLedger(dir, [['la4', '3', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeDualLanePasses(dir, 'la4', 1);
    writeOracle(dir, 'la4');
    writeFile(dir, 'tier3/la4/oracle.1.log', 'ORACLE PASS\n');
    return ['la4'];
  }],
  // the allow-list with exact identity boundaries, each beside a genuine PASS
  ...INVALID_PAIRINGS.map(([who, v], i) => [`tier-2 ${v} from '${who}' beside a checker PASS`, (dir) => {
    const t = `lb${i}`;
    writeLedger(dir, [[t, '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdicts(dir, t, 1, [['checker-tests', 'anthropic', 'PASS'], [who, 'impact', v]]);
    return [t];
  }]),
  ['tier-1 named checker file casting OVERRULE', (dir) => {
    writeLedger(dir, [['lc1', '1', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdicts(dir, 'lc1', 1, [['checker-tests', 'anthropic', 'OVERRULE']]);
    return ['lc1'];
  }],
  ['tier-1 named checker PASS + unnamed mis-paired judge-named PASS (control: never read)', (dir) => {
    writeLedger(dir, [['lc2', '1', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdicts(dir, 'lc2', 1, [['checker-tests', 'anthropic', 'PASS'], ['judge-x', 'adversarial', 'PASS']]);
    return ['lc2'];
  }],
  ['tier-3 two genuine lanes + a checker-cast UPHOLD', (dir) => {
    writeLedger(dir, [['lc3', '3', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeDualLanePasses(dir, 'lc3', 1);
    writeVerdicts(dir, 'lc3', 1, [['checker-a11y', 'impact', 'UPHOLD']]);
    writeOracle(dir, 'lc3');
    writeFile(dir, 'tier3/lc3/oracle.1.log', 'ORACLE PASS\n');
    return ['lc3'];
  }],
  ['tier-2 mis-paired file at an OLD attempt beside a genuine current PASS (control)', (dir) => {
    writeLedger(dir, [['lc4', '2', 'tests', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'lc4', 1, [['judge-x', 'adversarial', 'PASS']]);
    writeVerdicts(dir, 'lc4', 2, [['checker-tests', 'anthropic', 'PASS']]);
    return ['lc4'];
  }],
  // the panel that sets a FAIL aside
  ['tier-2 FAIL, two judge OVERRULEs + a checker-cast OVERRULE (two valid votes)', (dir) => {
    writeLedger(dir, [['ld1', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdicts(dir, 'ld1', 1, [
      ['checker-tests', 'anthropic', 'FAIL'],
      ['judge-claude', 'anthropic', 'OVERRULE'],
      ['judge-standards', 'adversarial', 'OVERRULE'],
      ['checker-rogue', 'impact', 'OVERRULE'],
    ]);
    return ['ld1'];
  }],
  ['tier-2 FAIL, two judge OVERRULEs + a boss UPHOLD (three valid votes, control)', (dir) => {
    writeLedger(dir, [['ld2', '2', 'tests', 'accepted', '1', 'w', 'r']]);
    writeVerdicts(dir, 'ld2', 1, [
      ['checker-tests', 'anthropic', 'FAIL'],
      ['judge-standards', 'adversarial', 'OVERRULE'],
      ['judge-impact', 'impact', 'OVERRULE'],
      ['boss', 'anthropic', 'UPHOLD'],
    ]);
    return ['ld2'];
  }],
  // escalation mirrors: FAILs and OVERRULEs cast by the wrong identities
  ['tier-1 attempt-1 judge-cast FAIL, attempt-2 genuine FAIL beside the named PASS', (dir) => {
    writeLedger(dir, [['le1', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'le1', 1, [['judge-x', 'adversarial', 'FAIL']]);
    writeVerdicts(dir, 'le1', 2, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
    return ['le1'];
  }],
  ['tier-1 attempt-1 boss-cast FAIL, attempt-2 genuine FAIL beside the named PASS', (dir) => {
    writeLedger(dir, [['le2', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'le2', 1, [['boss', 'anthropic', 'FAIL']]);
    writeVerdicts(dir, 'le2', 2, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
    return ['le2'];
  }],
  ['tier-1 attempt-1 FAIL "set aside" with a checker-cast OVERRULE as the third vote, genuine FAIL at attempt 2', (dir) => {
    writeLedger(dir, [['le3', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'le3', 1, [
      ['checker-second', 'adversarial', 'FAIL'],
      ['judge-claude', 'anthropic', 'OVERRULE'],
      ['judge-standards', 'adversarial', 'OVERRULE'],
      ['checker-rogue', 'impact', 'OVERRULE'],
    ]);
    writeVerdicts(dir, 'le3', 2, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
    return ['le3'];
  }],
  ['tier-1 attempt-1 FAIL set aside by two judge OVERRULEs + a boss UPHOLD, genuine FAIL at attempt 2 (control)', (dir) => {
    writeLedger(dir, [['le4', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'le4', 1, [
      ['checker-second', 'adversarial', 'FAIL'],
      ['judge-standards', 'adversarial', 'OVERRULE'],
      ['judge-impact', 'impact', 'OVERRULE'],
      ['boss', 'anthropic', 'UPHOLD'],
    ]);
    writeVerdicts(dir, 'le4', 2, [['checker-second', 'adversarial', 'FAIL'], ['checker-a11y', 'anthropic', 'PASS']]);
    return ['le4'];
  }],
  ['tier-1 attempt-1 `boss-2` / `Boss` OVERRULE cast nothing, so no checker-overruled trigger', (dir) => {
    writeLedger(dir, [['le5', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'le5', 1, [['boss-2', 'anthropic', 'OVERRULE'], ['Boss', 'adversarial', 'OVERRULE']]);
    writeVerdicts(dir, 'le5', 2, [['checker-a11y', 'anthropic', 'PASS']]);
    return ['le5'];
  }],
  ['tier-1 attempt-1 genuine boss OVERRULE still triggers checker-overruled (control)', (dir) => {
    writeLedger(dir, [['le6', '1', 'a11y', 'accepted', '2', 'w', 'r']]);
    writeVerdicts(dir, 'le6', 1, [['boss', 'anthropic', 'OVERRULE']]);
    writeVerdicts(dir, 'le6', 2, [['checker-a11y', 'anthropic', 'PASS']]);
    return ['le6'];
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
// critical-glob evaluation fails CLOSED (run CD, CD3) — mirrors gate.sh
// manifest_hits_glob. critical.globs, test.globs and every <task>.*.files
// manifest that is PRESENT but not a readable regular file of valid UTF-8 make
// the evaluation UNREADABLE: it counts as a hit with the reason
// `critical-glob-unreadable` (never "no hit"), so `accepted` is refused exactly
// as the gate refuses it. Absent inputs keep their old meaning.
// ---------------------------------------------------------------------------

const UNREADABLE_TOKEN = 'critical-glob-unreadable';
const BAD_UTF8 = Buffer.from([0x73, 0x77, 0xff, 0xfe, 0x2f, 0x2a, 0x2a, 0x0a]); // "sw\xff\xfe/**\n"
const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0;
const NEEDS_NON_ROOT = { skip: IS_ROOT ? 'mode-000 fixtures are readable by root' : false };

// A row that would otherwise accept (PASS + fingerprint at tier 1/2), whose one
// manifest matches nothing critical, under critical.globs = swarm/**.
function acceptableRow(dir, id, tier = 2) {
  writeLedger(dir, [[id, String(tier), 'tests', 'accepted', '1', 'w', 'r']]);
  writeManifest(dir, id, 1, ['src/ok.txt']);
  writeVerdicts(dir, id, 1, [['checker-tests', 'anthropic', 'PASS']]);
  writeFile(dir, 'critical.globs', 'swarm/**\n');
}

// [name, break-one-input(dir, id), skip-options]
const UNREADABLE_INPUTS = [
  ['critical.globs is a directory', (d) => {
    fs.rmSync(path.join(d, 'critical.globs')); fs.mkdirSync(path.join(d, 'critical.globs'));
  }],
  ['critical.globs is a dangling symlink', (d) => {
    fs.rmSync(path.join(d, 'critical.globs')); fs.symlinkSync('nowhere.globs', path.join(d, 'critical.globs'));
  }],
  ['critical.globs is a symlink loop', (d) => {
    fs.rmSync(path.join(d, 'critical.globs')); fs.symlinkSync('critical.globs', path.join(d, 'critical.globs'));
  }],
  ['critical.globs is not valid UTF-8', (d) => { writeFile(d, 'critical.globs', BAD_UTF8); }],
  ['critical.globs is mode 000', (d) => { fs.chmodSync(path.join(d, 'critical.globs'), 0o000); }, NEEDS_NON_ROOT],
  ['test.globs is a directory (not the defaults)', (d) => { fs.mkdirSync(path.join(d, 'test.globs')); }],
  ['test.globs is not valid UTF-8', (d) => { writeFile(d, 'test.globs', BAD_UTF8); }],
  ['test.globs is mode 000', (d) => { writeFile(d, 'test.globs', 'x\n'); fs.chmodSync(path.join(d, 'test.globs'), 0o000); }, NEEDS_NON_ROOT],
  ['test.globs is a FIFO (never opened)', (d) => {
    const r = spawnSync('mkfifo', [path.join(d, 'test.globs')]);
    assert.equal(r.status, 0, 'mkfifo is needed for this case');
  }],
  ['the current attempt manifest is not valid UTF-8', (d, id) => { writeFile(d, `manifests/${id}.1.files`, BAD_UTF8); }],
  ['the current attempt manifest is mode 000', (d, id) => { fs.chmodSync(path.join(d, `manifests/${id}.1.files`), 0o000); }, NEEDS_NON_ROOT],
  ['an OLDER attempt manifest is not valid UTF-8', (d, id) => { writeFile(d, `manifests/${id}.0.files`, BAD_UTF8); }],
  ['an OLDER attempt manifest is mode 000', (d, id) => { writeFile(d, `manifests/${id}.0.files`, 'x\n'); fs.chmodSync(path.join(d, `manifests/${id}.0.files`), 0o000); }, NEEDS_NON_ROOT],
  ['a directory matches <task>.*.files', (d, id) => { fs.mkdirSync(path.join(d, `manifests/${id}.0.files`)); }],
  ['a dangling symlink matches <task>.*.files', (d, id) => { fs.symlinkSync('nowhere', path.join(d, `manifests/${id}.0.files`)); }],
  ['the manifests directory cannot be listed (mode 000)', (d) => { fs.chmodSync(path.join(d, 'manifests'), 0o000); }, NEEDS_NON_ROOT],
];

// Everything a mode-000 fixture or a FIFO leaves behind: make it deletable,
// then delete this test's own directory.
function disposeFixture(dir) {
  spawnSync('chmod', ['-R', 'u+rwX', dir]);
  fs.rmSync(dir, { recursive: true, force: true });
}

// parse() in a child with a hard timeout: an implementation that opens a FIFO
// blocks forever, and a synchronous parse() cannot be interrupted in-process.
const PARSE_MJS = fileURLToPath(new URL('../lib/parse.mjs', import.meta.url));
function parseInChild(dir) {
  const r = spawnSync(
    process.execPath,
    ['--input-type=module', '-e',
      `import { parse } from ${JSON.stringify(new URL(`file://${PARSE_MJS}`).href)};` +
      `process.stdout.write(JSON.stringify(parse(${JSON.stringify(dir)})));`],
    { encoding: 'utf8', timeout: 20000 }
  );
  assert.equal(r.status, 0, `parse() must neither throw nor block: ${r.error ?? ''}${r.stderr}`);
  return JSON.parse(r.stdout);
}

for (const [name, breakInput, opts] of UNREADABLE_INPUTS) {
  test(`unreadable, fail closed (parse): ${name} -> flagged with ${UNREADABLE_TOKEN}, never no hit`, opts ?? {}, () => {
    const dir = makeSwarmDir();
    try {
      acceptableRow(dir, 'uf');
      breakInput(dir, 'uf');
      const state = parseInChild(dir);
      const task = state.tasks.find((t) => t.id === 'uf');
      assert.equal(task.derived.state, 'flagged');
      const msgs = state.errors.filter((e) => e.message.startsWith('task uf:')).map((e) => e.message);
      assert.deepEqual(msgs, [
        `task uf: ledger says accepted but escalation trigger (${UNREADABLE_TOKEN}) and no flag — run gate.sh escalate-scan`,
      ]);
    } finally {
      disposeFixture(dir);
    }
  });
}

test('unreadable, fail closed (parse): an unreadable input beats a real critical-glob hit', () => {
  const dir = makeSwarmDir();
  try {
    writeLedger(dir, [['ub', '2', 'tests', 'accepted', '2', 'w', 'r']]);
    writeManifest(dir, 'ub', 2, ['swarm/x.sh']); // a genuine hit ...
    writeVerdicts(dir, 'ub', 2, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    writeFile(dir, 'manifests/ub.1.files', BAD_UTF8); // ... beside one nobody can read
    const state = parse(dir);
    assert.equal(taskOf(state, 'ub').derived.state, 'flagged');
    assert.deepEqual(mismatchesOf(state, 'ub'), [
      `task ub: ledger says accepted but escalation trigger (${UNREADABLE_TOKEN}) and no flag — run gate.sh escalate-scan`,
    ]);
  } finally {
    disposeFixture(dir);
  }
});

test('unreadable, fail closed (parse): absent and clean inputs keep their old meaning (controls)', () => {
  const dir = makeSwarmDir();
  try {
    writeLedger(dir, [
      ['uc-absent', '2', 'tests', 'accepted', '1', 'w', 'r'],
      ['uc-clean', '2', 'tests', 'accepted', '1', 'w', 'r'],
      ['uc-nomanifest', '2', 'tests', 'accepted', '1', 'w', 'r'],
      ['uc-utf8', '2', 'tests', 'accepted', '1', 'w', 'r'],
    ]);
    for (const id of ['uc-absent', 'uc-clean', 'uc-utf8']) {
      writeManifest(dir, id, 1, [id === 'uc-utf8' ? 'docs/café.md' : 'src/ok.txt']);
      writeVerdicts(dir, id, 1, [['checker-tests', 'anthropic', 'PASS']]);
    }
    // No critical.globs: absent, never unreadable.
    assert.equal(taskOf(parse(dir), 'uc-absent').derived.state, 'accepted');
    // A directory at critical.globs would be unreadable — but only for a row
    // that has started: uc-nomanifest has no manifest, so it is never flagged.
    fs.mkdirSync(path.join(dir, 'critical.globs'));
    const withDir = parse(dir);
    assert.equal(taskOf(withDir, 'uc-nomanifest').derived.state, 'blocked');
    assert.doesNotMatch(mismatchesOf(withDir, 'uc-nomanifest').join(' '), /unreadable/);
    assert.equal(taskOf(withDir, 'uc-clean').derived.state, 'flagged');
    fs.rmdirSync(path.join(dir, 'critical.globs'));
    // Readable, valid UTF-8 (BOM, CRLF, non-ASCII manifest path): read, not unreadable.
    writeFile(dir, 'critical.globs', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('swarm/**\r\n')]));
    writeFile(dir, 'test.globs', 'nomatch\n');
    const clean = parse(dir);
    for (const id of ['uc-clean', 'uc-utf8']) assert.equal(taskOf(clean, id).derived.state, 'accepted', id);
    assert.deepEqual(clean.errors.filter((e) => /unreadable/.test(e.message)), []);
    // A symlink to a readable critical.globs is a regular file after following it.
    fs.rmSync(path.join(dir, 'critical.globs'));
    writeFile(dir, 'real.globs', 'swarm/**\n');
    fs.symlinkSync('real.globs', path.join(dir, 'critical.globs'));
    assert.equal(taskOf(parse(dir), 'uc-clean').derived.state, 'accepted');
  } finally {
    disposeFixture(dir);
  }
});

test('unreadable, fail closed (parse): tier 3 is never blocked inline (target tier is capped at 3)', () => {
  const dir = makeSwarmDir();
  try {
    writeLedger(dir, [['u3', '3', 'tests,second', 'accepted', '1', 'w', 'r']]);
    writeDualLanePasses(dir, 'u3', 1);
    writeOracle(dir, 'u3');
    writeFile(dir, 'tier3/u3/oracle.1.log', 'ORACLE PASS\n');
    writeFile(dir, 'critical.globs', BAD_UTF8);
    assert.equal(taskOf(parse(dir), 'u3').derived.state, 'accepted');
  } finally {
    disposeFixture(dir);
  }
});

// The CURRENT attempt's manifest and sidecar must not make parse() throw
// (today's readFileIfExists rethrows EACCES/EISDIR -> an HTTP 500 upstream).
// gate.sh check_fingerprint tests `[[ -f ]]` and reads both, so it refuses the
// row either way; the dashboard's derived state must agree.
const CURRENT_EVIDENCE_KINDS = [
  ['the current manifest is mode 000', (d, id) => { fs.chmodSync(path.join(d, `manifests/${id}.1.files`), 0o000); }, NEEDS_NON_ROOT],
  ['the current manifest is a directory', (d, id) => {
    fs.rmSync(path.join(d, `manifests/${id}.1.files`)); fs.mkdirSync(path.join(d, `manifests/${id}.1.files`));
  }],
  ['the current sidecar is mode 000', (d, id) => { fs.chmodSync(path.join(d, `manifests/${id}.1.sha256`), 0o000); }, NEEDS_NON_ROOT],
  ['the current sidecar is a directory', (d, id) => {
    fs.rmSync(path.join(d, `manifests/${id}.1.sha256`)); fs.mkdirSync(path.join(d, `manifests/${id}.1.sha256`));
  }],
  ['the current sidecar is a FIFO (never opened)', (d, id) => {
    fs.rmSync(path.join(d, `manifests/${id}.1.sha256`));
    assert.equal(spawnSync('mkfifo', [path.join(d, `manifests/${id}.1.sha256`)]).status, 0);
  }],
  ['the current manifest is a dangling symlink', (d, id) => {
    fs.rmSync(path.join(d, `manifests/${id}.1.files`)); fs.symlinkSync('nowhere', path.join(d, `manifests/${id}.1.files`));
  }],
];
for (const [name, breakInput, opts] of CURRENT_EVIDENCE_KINDS) {
  test(`unreadable, fail closed (parse): ${name} -> parse() does not throw and the row is blocked`, opts ?? {}, () => {
    const dir = makeSwarmDir();
    try {
      writeLedger(dir, [['ue', '2', 'tests', 'accepted', '1', 'w', 'r']]);
      writeManifest(dir, 'ue', 1, ['src/ok.txt']);
      writeVerdicts(dir, 'ue', 1, [['checker-tests', 'anthropic', 'PASS']]);
      breakInput(dir, 'ue');
      const state = parseInChild(dir);
      const task = state.tasks.find((t) => t.id === 'ue');
      assert.equal(task.derived.state, 'blocked');
      assert.equal(gateCheck(dir, 'ue'), false, 'gate.sh check refuses the same row');
    } finally {
      disposeFixture(dir);
    }
  });
}

// The anti-lie property over every unreadable kind, at tiers 1 and 2: the gate
// refuses inline, names critical-glob-unreadable on stdout, prints ONE
// `unreadable` stderr line, and derived.state agrees with the mismatch naming
// the same reason.
function gateRun(swarmDir, taskId, env = {}) {
  const res = spawnSync('bash', [GATE_SH, 'check', taskId], {
    env: { ...process.env, SWARM_DIR: swarmDir, SWARM_TREE: path.join(swarmDir, 'tree'), ...env },
    encoding: 'utf8',
    timeout: 30000,
  });
  assert.notEqual(res.status, null, `gate.sh did not finish: ${res.error}`);
  assert.ok(res.status === 0 || res.status === 1, `gate.sh exit ${res.status}: ${res.stdout}${res.stderr}`);
  return { ok: res.status === 0, out: res.stdout.trim(), err: res.stderr.trim() };
}
for (const [name, breakInput, opts] of UNREADABLE_INPUTS) {
  test(`unreadable, fail closed (differential): ${name} -> gate check and derived.state both refuse, naming ${UNREADABLE_TOKEN}`, opts ?? {}, () => {
    for (const tier of [1, 2]) {
      const dir = makeSwarmDir();
      try {
        const id = `ud${tier}`;
        acceptableRow(dir, id, tier);
        breakInput(dir, id);
        const g = gateRun(dir, id);
        const state = parseInChild(dir);
        const task = state.tasks.find((t) => t.id === id);
        const where = `tier ${tier}: gate ${g.ok ? 'accepts' : 'rejects'}, dashboard '${task.derived.state}' (${g.out})`;
        assert.equal(g.ok, false, `the gate must refuse (${where})`);
        assert.equal(task.derived.state === 'accepted', g.ok, where);
        assert.ok(g.out.includes(UNREADABLE_TOKEN), `the gate's FAIL line names the reason: ${g.out}`);
        assert.equal(g.err.split('\n').filter((l) => /unreadable/i.test(l)).length, 1, `one unreadable stderr line: ${g.err}`);
        const msgs = state.errors.filter((e) => e.message.startsWith(`task ${id}:`)).map((e) => e.message).join(' | ');
        assert.ok(msgs.includes(UNREADABLE_TOKEN), `the dashboard mismatch names the reason: ${msgs}`);
      } finally {
        disposeFixture(dir);
      }
    }
  });
}

test('unreadable, fail closed (differential): valid inputs behave exactly as before, non-ASCII UTF-8 included, under LC_ALL=C', () => {
  const dir = makeSwarmDir();
  try {
    writeLedger(dir, [
      ['ur1', '2', 'tests', 'accepted', '1', 'w', 'r'],
      ['ur2', '2', 'tests', 'accepted', '1', 'w', 'r'],
    ]);
    writeManifest(dir, 'ur1', 1, ['docs/café.md']);
    writeVerdicts(dir, 'ur1', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeManifest(dir, 'ur2', 1, ['swarm/x.sh']); // a real hit: plain critical-glob, not unreadable
    writeVerdicts(dir, 'ur2', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeFile(dir, 'critical.globs', 'swarm/**\n');
    const state = parse(dir);
    const c = { LC_ALL: 'C', LANG: 'C', PYTHONUTF8: '0' };
    const g1 = gateRun(dir, 'ur1', c);
    assert.equal(g1.ok, true, `readable UTF-8 is no hit: ${g1.out}`);
    assert.equal(taskOf(state, 'ur1').derived.state, 'accepted');
    assert.doesNotMatch(g1.err, /unreadable/i);
    const g2 = gateRun(dir, 'ur2', c);
    assert.equal(g2.ok, false);
    assert.ok(g2.out.includes('critical-glob') && !g2.out.includes(UNREADABLE_TOKEN), g2.out);
    assert.equal(taskOf(state, 'ur2').derived.state, 'flagged');
    assert.deepEqual(mismatchesOf(state, 'ur2'), [
      'task ur2: ledger says accepted but escalation trigger (critical-glob) and no flag — run gate.sh escalate-scan',
    ]);
  } finally {
    disposeFixture(dir);
  }
});

// ---------------------------------------------------------------------------
// the Codex lane (run CD, CD4) — mirrors gate.sh. swarm/codex-check.sh writes
// one outcome per (task, attempt): a checker-codex verdict (FAMILY crossvendor)
// or a checker-codex.skip record. Trial rule (D2): a Codex FAIL counts, a Codex
// PASS never does, an outage never blocks; `codex` in the checks column is not
// a named checker, it demands exactly ONE valid outcome at the CURRENT attempt.
// Gate `check` exits 0 <=> derived.state === 'accepted', at every tier.
// ---------------------------------------------------------------------------

const CODEX_EVIDENCE = 'missing checker-codex evidence';
const CODEX_SKIP_REASONS = [
  'no-exclude-policy', 'no-criteria', 'no-evidence', 'no-codex', 'docker-unavailable', 'unsafe-tree',
  'fingerprint-mismatch', 'container-error', 'auth', 'quota', 'timeout', 'schema-invalid',
  'evidence-free-pass', 'secret-leak', 'codex-error',
];

function writeCodex(dir, task, attempt, verdict, opts = {}) {
  writeVerdict(dir, { task, attempt, checker: 'checker-codex', verdict, family: 'crossvendor', ...opts });
}
function writeCodexSkip(dir, task, attempt, reason = 'quota', { detail = 'probe detail', taskHdr = task, attemptHdr = attempt } = {}) {
  writeFile(
    dir,
    `verdicts/${task}.${attempt}.checker-codex.skip`,
    `REASON: ${reason}\nDETAIL: ${detail}\nTASK: ${taskHdr}\nATTEMPT: ${attemptHdr}\n`
  );
}
// A row ledgered accepted at attempt 1 whose real checkers PASS (tests; second
// too when named; a passing oracle at tier 3). Codex evidence is the test's job.
function codexRow(dir, id, tier, checks) {
  writeLedger(dir, [[id, String(tier), checks, 'accepted', '1', 'w', 'r']]);
  writeVerdicts(dir, id, 1, [['checker-tests', 'anthropic', 'PASS']]);
  if (checks.split(',').includes('second')) writeVerdicts(dir, id, 1, [['checker-second', 'adversarial', 'PASS']]);
  if (tier === 3) {
    writeOracle(dir, id);
    writeFile(dir, `tier3/${id}/oracle.1.log`, 'ORACLE PASS\n');
  }
}
function codexPanel(dir, id) {
  writeVerdicts(dir, id, 1, [
    ['judge-claude', 'anthropic', 'OVERRULE'],
    ['judge-standards', 'adversarial', 'OVERRULE'],
    ['judge-impact', 'impact', 'UPHOLD'],
  ]);
}

test('codex identity: crossvendor is valid ONLY with checker-codex, and checker-codex ONLY with crossvendor', () => {
  const dir = makeSwarmDir();
  writeLedger(dir, [
    ['ci-ok', '2', 'tests', 'checking', '1', 'w', 'r'],
    ['ci-fam', '2', 'tests', 'checking', '1', 'w', 'r'],
    ['ci-chk', '2', 'tests', 'checking', '1', 'w', 'r'],
    ['ci-judge', '2', 'tests', 'checking', '1', 'w', 'r'],
  ]);
  writeCodex(dir, 'ci-ok', 1, 'FAIL');
  writeVerdict(dir, { task: 'ci-fam', attempt: 1, checker: 'checker-codex', verdict: 'PASS', family: 'adversarial' });
  writeVerdict(dir, { task: 'ci-chk', attempt: 1, checker: 'checker-tests', verdict: 'PASS', family: 'crossvendor' });
  writeVerdict(dir, { task: 'ci-judge', attempt: 1, checker: 'judge-x', verdict: 'OVERRULE', family: 'crossvendor' });
  const state = parse(dir);
  assert.deepEqual(taskOf(state, 'ci-ok').verdicts.map((v) => `${v.checker}:${v.family}:${v.verdict}`), ['checker-codex:crossvendor:FAIL']);
  for (const [id, checker, family] of [['ci-fam', 'checker-codex', 'adversarial'], ['ci-chk', 'checker-tests', 'crossvendor'], ['ci-judge', 'judge-x', 'crossvendor']]) {
    const t = taskOf(state, id);
    assert.deepEqual(t.verdicts, [], `${checker}/${family} must be excluded`);
    assert.deepEqual(t.invalidVerdicts, [`${id}.1.${checker}.verdict`]);
    const hit = state.errors.find((e) => e.file === `verdicts/${id}.1.${checker}.verdict`);
    assert.ok(hit, `${checker}/${family} must be reported in errors[]`);
    assert.equal(
      hit.message,
      `FAMILY 'crossvendor' and CHECKER 'checker-codex' are valid only together (got CHECKER '${checker}', FAMILY '${family}')`
    );
  }
});

test('codex lane: derived.familiesPassed excludes a Codex PASS and equals the gate lane set', () => {
  const dir = makeSwarmDir();
  codexRow(dir, 'cf1', 2, 'tests,second,codex');
  writeCodex(dir, 'cf1', 1, 'PASS');
  const t = taskOf(parse(dir), 'cf1');
  assert.equal(t.derived.state, 'accepted');
  assert.deepEqual([...t.derived.familiesPassed].sort(), ['adversarial', 'anthropic']);
  assert.ok(!t.derived.familiesPassed.includes('crossvendor'), 'a Codex PASS is no lane');
  // a Codex PASS alone in a row: no lane at all
  const dir2 = makeSwarmDir();
  writeLedger(dir2, [['cf2', '2', 'tests,codex', 'checking', '1', 'w', 'r']]);
  writeCodex(dir2, 'cf2', 1, 'PASS');
  assert.deepEqual(taskOf(parse(dir2), 'cf2').derived.familiesPassed, []);
});

test('codex lane: parse() never throws on a directory, FIFO or mode-000 skip record — it counts as absent', () => {
  const dir = makeSwarmDir();
  try {
    writeLedger(dir, [
      ['sk-dir', '2', 'tests,codex', 'accepted', '1', 'w', 'r'],
      ['sk-fifo', '2', 'tests,codex', 'accepted', '1', 'w', 'r'],
      ['sk-000', '2', 'tests,codex', 'accepted', '1', 'w', 'r'],
      ['sk-ok', '2', 'tests,codex', 'accepted', '1', 'w', 'r'],
    ]);
    for (const id of ['sk-dir', 'sk-fifo', 'sk-000', 'sk-ok']) writeVerdicts(dir, id, 1, [['checker-tests', 'anthropic', 'PASS']]);
    fs.mkdirSync(path.join(dir, 'verdicts/sk-dir.1.checker-codex.skip'));
    assert.equal(spawnSync('mkfifo', [path.join(dir, 'verdicts/sk-fifo.1.checker-codex.skip')]).status, 0);
    writeCodexSkip(dir, 'sk-000', 1);
    // mode-000 fixtures are readable by root, so that case only runs as non-root
    if (!IS_ROOT) fs.chmodSync(path.join(dir, 'verdicts/sk-000.1.checker-codex.skip'), 0o000);
    writeCodexSkip(dir, 'sk-ok', 1);
    const state = parseInChild(dir);
    for (const id of IS_ROOT ? ['sk-dir', 'sk-fifo'] : ['sk-dir', 'sk-fifo', 'sk-000']) {
      assert.equal(taskOf(state, id).derived.state, 'blocked', id);
      assert.equal(taskOf(state, id).codexSkip, null, id);
      assert.ok(mismatchesOf(state, id).join(' ').includes(CODEX_EVIDENCE), id);
    }
    assert.equal(taskOf(state, 'sk-ok').derived.state, 'accepted');
    assert.deepEqual(taskOf(state, 'sk-ok').codexSkip, { reason: 'quota' });
  } finally {
    disposeFixture(dir);
  }
});

// [name, expected acceptance, tier, checks, setup(dir, id)] — each row is run
// through the gate AND the dashboard; both must agree with the expectation.
const CODEX_SCENARIOS = [];
for (const tier of [1, 2, 3]) {
  const all = 'tests,second,codex';
  CODEX_SCENARIOS.push(
    [`tier ${tier}: codex named, no outcome -> refused (evidence)`, false, tier, all, () => {}, CODEX_EVIDENCE],
    [`tier ${tier}: codex named, a Codex PASS -> accepted`, true, tier, all, (d, id) => writeCodex(d, id, 1, 'PASS')],
    [`tier ${tier}: codex named, a valid skip record -> accepted (an outage never blocks)`, true, tier, all, (d, id) => writeCodexSkip(d, id, 1)],
    [`tier ${tier}: codex named, a verdict AND a skip record -> refused`, false, tier, all, (d, id) => { writeCodex(d, id, 1, 'PASS'); writeCodexSkip(d, id, 1); }, 'checker-codex'],
    [`tier ${tier}: checks = codex only -> refused like a blank column`, false, tier, 'codex', (d, id) => writeCodex(d, id, 1, 'PASS'), 'requires named checkers'],
  );
}
for (const reason of CODEX_SKIP_REASONS) {
  CODEX_SCENARIOS.push([`skip reason '${reason}' is evidence`, true, 2, 'tests,codex', (d, id) => writeCodexSkip(d, id, 1, reason)]);
}
CODEX_SCENARIOS.push(
  ['a skip with an unknown REASON is not evidence', false, 2, 'tests,codex', (d, id) => writeCodexSkip(d, id, 1, 'bogus-reason'), CODEX_EVIDENCE],
  ['a skip REASON of two adjacent valid ones is not evidence', false, 2, 'tests,codex', (d, id) => writeCodexSkip(d, id, 1, 'auth quota'), CODEX_EVIDENCE],
  ['a skip whose TASK header disagrees is not evidence', false, 2, 'tests,codex', (d, id) => writeCodexSkip(d, id, 1, 'quota', { taskHdr: 'other' }), CODEX_EVIDENCE],
  ['a skip whose ATTEMPT header disagrees is not evidence', false, 2, 'tests,codex', (d, id) => writeCodexSkip(d, id, 1, 'quota', { attemptHdr: 2 }), CODEX_EVIDENCE],
  ['a skip with an empty DETAIL is not evidence', false, 2, 'tests,codex', (d, id) => writeCodexSkip(d, id, 1, 'quota', { detail: '' }), CODEX_EVIDENCE],
  ['a skip with no DETAIL line is not evidence', false, 2, 'tests,codex', (d, id) => writeFile(d, `verdicts/${id}.1.checker-codex.skip`, `REASON: quota\nTASK: ${id}\nATTEMPT: 1\n`), CODEX_EVIDENCE],
  ['a skip with a NUL byte is not evidence', false, 2, 'tests,codex', (d, id) => writeFile(d, `verdicts/${id}.1.checker-codex.skip`, `REASON: qu\0ota\nDETAIL: d\nTASK: ${id}\nATTEMPT: 1\n`), CODEX_EVIDENCE],
  ['first-match headers: a valid REASON first, a bogus one later -> evidence', true, 2, 'tests,codex', (d, id) => writeFile(d, `verdicts/${id}.1.checker-codex.skip`, `REASON: quota\nDETAIL: d\nTASK: ${id}\nATTEMPT: 1\nREASON: bogus\n`)],
  ['first-match headers: a bogus REASON first, a valid one later -> not evidence', false, 2, 'tests,codex', (d, id) => writeFile(d, `verdicts/${id}.1.checker-codex.skip`, `REASON: bogus\nDETAIL: d\nTASK: ${id}\nATTEMPT: 1\nREASON: quota\n`), CODEX_EVIDENCE],
  ['first-match headers: an indented REASON line is not the header', false, 2, 'tests,codex', (d, id) => writeFile(d, `verdicts/${id}.1.checker-codex.skip`, ` REASON: quota\nDETAIL: d\nTASK: ${id}\nATTEMPT: 1\n`), CODEX_EVIDENCE],
  ['a skip REASON with trailing whitespace is not one of the 15', false, 2, 'tests,codex', (d, id) => writeFile(d, `verdicts/${id}.1.checker-codex.skip`, `REASON: quota \nDETAIL: d\nTASK: ${id}\nATTEMPT: 1\n`), CODEX_EVIDENCE],
  ['codex not named: a skip record is ignored', true, 2, 'tests', (d, id) => writeCodexSkip(d, id, 1)],
  ['codex not named: a bogus skip record is ignored', true, 2, 'tests', (d, id) => writeCodexSkip(d, id, 1, 'bogus')],
  // D2: a Codex PASS never counts — no named-checker requirement, no lane
  ['tier 3: a Codex PASS supplies no second lane', false, 3, 'tests,codex', (d, id) => writeCodex(d, id, 1, 'PASS'), 'famil'],
  ['tier 3, codex not named: an unnamed Codex PASS supplies no lane either', false, 3, 'tests', (d, id) => writeCodex(d, id, 1, 'PASS'), 'famil'],
  ['tier 2: a Codex PASS does not stand in for a missing checker-second', false, 2, 'tests,second,codex', (d, id) => { fs.rmSync(path.join(d, `verdicts/${id}.1.checker-second.verdict`)); writeCodex(d, id, 1, 'PASS'); }, 'checker-second'],
  ['tier 2: a Codex PASS does not widen a same-lane second', false, 2, 'tests,second,codex', (d, id) => { writeVerdicts(d, id, 1, [['checker-second', 'anthropic', 'PASS']]); writeCodex(d, id, 1, 'PASS'); }, 'lane'],
  ['a Codex PASS without MANIFEST_SHA256 is refused like any checker PASS', false, 2, 'tests,codex', (d, id) => writeCodex(d, id, 1, 'PASS', { fingerprint: false }), 'MANIFEST_SHA256'],
  // D2: a Codex FAIL counts wherever it is loaded
  ['tier 1, codex named: a Codex FAIL is refused', false, 1, 'tests,codex', (d, id) => writeCodex(d, id, 1, 'FAIL'), 'checker-codex returned FAIL'],
  ['tier 1, codex not named: a Codex FAIL is ignored', true, 1, 'tests', (d, id) => writeCodex(d, id, 1, 'FAIL')],
  ['tier 2, codex named: a Codex FAIL opens a dispute', false, 2, 'tests,codex', (d, id) => writeCodex(d, id, 1, 'FAIL'), 'dispute'],
  ['tier 2, codex NOT named: a Codex FAIL still opens a dispute', false, 2, 'tests', (d, id) => writeCodex(d, id, 1, 'FAIL'), 'dispute'],
  ['tier 2: a Codex FAIL set aside by a panel -> accepted', true, 2, 'tests,codex', (d, id) => { writeCodex(d, id, 1, 'FAIL'); codexPanel(d, id); }],
  ['tier 3: a Codex FAIL opens a dispute', false, 3, 'tests,second,codex', (d, id) => writeCodex(d, id, 1, 'FAIL'), 'dispute'],
  ['tier 3: a Codex FAIL set aside by a panel -> accepted', true, 3, 'tests,second,codex', (d, id) => { writeCodex(d, id, 1, 'FAIL'); codexPanel(d, id); }],
  ['a named FAIL set aside by a panel still needs Codex evidence', false, 2, 'tests,codex', (d, id) => { writeVerdicts(d, id, 1, [['checker-tests', 'anthropic', 'FAIL']]); codexPanel(d, id); }, CODEX_EVIDENCE],
  ['evidence only at an OLDER attempt does not count', false, 2, 'tests,codex', (d, id) => {
    writeLedger(d, [[id, '2', 'tests,codex', 'accepted', '2', 'w', 'r']]);
    writeCodex(d, id, 1, 'PASS'); writeCodexSkip(d, id, 1);
    writeVerdicts(d, id, 2, [['checker-tests', 'anthropic', 'PASS']]);
  }, CODEX_EVIDENCE]
);

// CD4 attempt 2. U+2003 and friends are built from code points, never typed.
const EMSP = String.fromCodePoint(0x2003);
const NBSP = String.fromCodePoint(0xa0);
const IDSP = String.fromCodePoint(0x3000);
const rawSkip = (d, id, text) => writeFile(d, `verdicts/${id}.1.checker-codex.skip`, text);
const skipText = (id, { reason = 'quota', detail = 'probe', task = id, attempt = '1' } = {}) =>
  `REASON:${reason}\nDETAIL:${detail}\nTASK:${task}\nATTEMPT:${attempt}\n`;
const mode000 = (d, rel) => fs.chmodSync(path.join(d, rel), 0o000);
const CODEX_INVALID = 'invalid verdict checker-codex';
CODEX_SCENARIOS.push(
  // the NUL rule: a NUL byte ANYWHERE in a skip record makes it invalid (gate AND dashboard)
  ['a NUL inside DETAIL makes the skip record invalid', false, 2, 'tests,codex', (d, id) => rawSkip(d, id, `REASON: quota\nDETAIL: pro\0be\nTASK: ${id}\nATTEMPT: 1\n`), CODEX_EVIDENCE],
  ['a NUL on a line that is no header makes the skip record invalid', false, 2, 'tests,codex', (d, id) => rawSkip(d, id, `REASON: quota\nDETAIL: probe\nTASK: ${id}\nATTEMPT: 1\nnote: a\0b\n`), CODEX_EVIDENCE],
  ['a trailing NUL makes the skip record invalid', false, 2, 'tests,codex', (d, id) => rawSkip(d, id, `REASON: quota\nDETAIL: probe\nTASK: ${id}\nATTEMPT: 1\n\0`), CODEX_EVIDENCE],
  // a header value loses LEADING ASCII whitespace only
  ['DETAIL:<U+2003> is a non-empty DETAIL (valid skip)', true, 2, 'tests,codex', (d, id) => rawSkip(d, id, skipText(id, { detail: EMSP }))],
  ['DETAIL: <NBSP> is a non-empty DETAIL (valid skip)', true, 2, 'tests,codex', (d, id) => rawSkip(d, id, skipText(id, { detail: ` ${NBSP}` }))],
  ['DETAIL:<VT> strips to empty (invalid skip)', false, 2, 'tests,codex', (d, id) => rawSkip(d, id, skipText(id, { detail: '\v' })), CODEX_EVIDENCE],
  ['REASON:<U+2003>quota is no known reason', false, 2, 'tests,codex', (d, id) => rawSkip(d, id, skipText(id, { reason: `${EMSP}quota` })), CODEX_EVIDENCE],
  ['REASON:<U+3000>auth is no known reason (tier 1)', false, 1, 'tests,codex', (d, id) => rawSkip(d, id, skipText(id, { reason: `${IDSP}auth` })), CODEX_EVIDENCE],
  ['TASK:<U+2003><id> does not match the filename', false, 2, 'tests,codex', (d, id) => rawSkip(d, id, skipText(id, { task: `${EMSP}${id}` })), CODEX_EVIDENCE],
  ['ATTEMPT:<U+2003>1 does not match the filename', false, 2, 'tests,codex', (d, id) => rawSkip(d, id, skipText(id, { attempt: `${EMSP}1` })), CODEX_EVIDENCE],
  ['REASON: quota<U+2003> (trailing whitespace is never stripped) is no known reason', false, 2, 'tests,codex', (d, id) => rawSkip(d, id, skipText(id, { reason: ` quota${EMSP}` })), CODEX_EVIDENCE],
  ['leading TAB and several spaces are stripped (valid skip)', true, 2, 'tests,codex', (d, id) => rawSkip(d, id, `REASON:\t  quota\nDETAIL:\t d\nTASK:   ${id}\nATTEMPT: \t1\n`)],
  // tier 1, codex named: a non-regular or invalid verdict entry refuses the row, even beside a valid skip
  ['tier 1 named: an INVALID Codex verdict (no ---) beside a valid skip is refused', false, 1, 'tests,codex', (d, id) => {
    writeCodexSkip(d, id, 1);
    writeFile(d, `verdicts/${id}.1.checker-codex.verdict`, `VERDICT: PASS\nCHECKER: checker-codex\nFAMILY: crossvendor\nTASK: ${id}\nATTEMPT: 1\n`);
  }, CODEX_INVALID],
  ['tier 1 named: a Codex verdict with a bad FAMILY beside a valid skip is refused', false, 1, 'tests,codex', (d, id) => {
    writeCodexSkip(d, id, 1);
    writeVerdict(d, { task: id, attempt: 1, checker: 'checker-codex', verdict: 'PASS', family: 'adversarial' });
  }, CODEX_INVALID],
  ['tier 1 named: a DANGLING-symlink Codex verdict entry beside a valid skip is refused', false, 1, 'tests,codex', (d, id) => {
    writeCodexSkip(d, id, 1); fs.symlinkSync('nowhere', path.join(d, `verdicts/${id}.1.checker-codex.verdict`));
  }, CODEX_INVALID],
  ['tier 1 named: a dangling-symlink Codex verdict entry and no skip is refused as invalid', false, 1, 'tests,codex', (d, id) => {
    fs.symlinkSync('nowhere', path.join(d, `verdicts/${id}.1.checker-codex.verdict`));
  }, CODEX_INVALID],
  ['tier 1 named: a symlink-LOOP Codex verdict entry beside a valid skip is refused', false, 1, 'tests,codex', (d, id) => {
    writeCodexSkip(d, id, 1); fs.symlinkSync(`${id}.1.checker-codex.verdict`, path.join(d, `verdicts/${id}.1.checker-codex.verdict`));
  }, CODEX_INVALID],
  ['tier 1 named: a DIRECTORY named as the Codex verdict beside a valid skip is refused', false, 1, 'tests,codex', (d, id) => {
    writeCodexSkip(d, id, 1); fs.mkdirSync(path.join(d, `verdicts/${id}.1.checker-codex.verdict`));
  }, CODEX_INVALID],
  ['tier 1 named: a FIFO named as the Codex verdict (never opened) beside a valid skip is refused', false, 1, 'tests,codex', (d, id) => {
    writeCodexSkip(d, id, 1); assert.equal(spawnSync('mkfifo', [path.join(d, `verdicts/${id}.1.checker-codex.verdict`)]).status, 0);
  }, CODEX_INVALID],
  ['tier 1 NOT named: a dangling-symlink Codex verdict entry is ignored', true, 1, 'tests', (d, id) => {
    fs.symlinkSync('nowhere', path.join(d, `verdicts/${id}.1.checker-codex.verdict`));
  }],
  // tiers 2/3: any non-regular verdict entry is an invalid verdict file that blocks the row, whatever the checker
  ['tier 2: a DIRECTORY named as another checker\'s verdict blocks the row', false, 2, 'tests', (d, id) => { fs.mkdirSync(path.join(d, `verdicts/${id}.1.checker-other.verdict`)); }, 'invalid verdict'],
  ['tier 2: a FIFO named as another checker\'s verdict blocks the row (no hang)', false, 2, 'tests', (d, id) => { assert.equal(spawnSync('mkfifo', [path.join(d, `verdicts/${id}.1.checker-other.verdict`)]).status, 0); }, 'invalid verdict'],
  ['tier 2: a symlink LOOP named as another checker\'s verdict blocks the row', false, 2, 'tests', (d, id) => { fs.symlinkSync(`${id}.1.checker-other.verdict`, path.join(d, `verdicts/${id}.1.checker-other.verdict`)); }, 'invalid verdict'],
  ['tier 3 named: a FIFO named as the Codex verdict beside a valid skip blocks the row', false, 3, 'tests,second,codex', (d, id) => {
    writeCodexSkip(d, id, 1); assert.equal(spawnSync('mkfifo', [path.join(d, `verdicts/${id}.1.checker-codex.verdict`)]).status, 0);
  }, 'invalid verdict'],
);
if (!IS_ROOT) {
  // mode-000 fixtures are readable by root, so these only run as non-root
  CODEX_SCENARIOS.push(
    ['tier 1 named: a MODE-000 Codex verdict beside a valid skip is refused', false, 1, 'tests,codex', (d, id) => {
      writeCodexSkip(d, id, 1); writeCodex(d, id, 1, 'PASS'); mode000(d, `verdicts/${id}.1.checker-codex.verdict`);
    }, CODEX_INVALID],
    ['tier 2: a MODE-000 regular file named as another checker\'s verdict blocks the row', false, 2, 'tests', (d, id) => {
      writeVerdicts(d, id, 1, [['checker-other', 'anthropic', 'PASS']]); mode000(d, `verdicts/${id}.1.checker-other.verdict`);
    }, 'invalid verdict'],
  );
}

test('codex differential: gate.sh check agrees with derived.state for every Codex scenario, and names the evidence defect', () => {
  for (const [name, expectAccepted, tier, checks, setup, needle] of CODEX_SCENARIOS) {
    const dir = makeSwarmDir();
    try {
      const id = 'cxd';
      codexRow(dir, id, tier, checks);
      setup(dir, id);
      const g = gateRun(dir, id);
      const state = parseInChild(dir);
      const task = taskOf(state, id);
      const where = `${name}: gate ${g.ok ? 'accepts' : 'rejects'} (${g.out}), dashboard '${task.derived.state}' (${mismatchesOf(state, id).join(' | ')})`;
      assert.equal(task.derived.state === 'accepted', g.ok, where);
      assert.equal(g.ok, expectAccepted, `expected ${expectAccepted ? 'accept' : 'reject'}: ${where}`);
      assert.doesNotMatch(g.out, /invalid FAMILY/, `refused for the pre-CD4 reason: ${where}`);
      if (needle) {
        assert.ok(g.out.includes(needle), `the gate's FAIL line should mention '${needle}': ${where}`);
        if (needle === CODEX_EVIDENCE) {
          assert.ok(mismatchesOf(state, id).join(' | ').includes(CODEX_EVIDENCE), `the dashboard mismatch should name the evidence defect: ${where}`);
        }
      }
      if (g.ok && checks.includes('codex')) {
        assert.ok(!task.derived.familiesPassed.includes('crossvendor'), `familiesPassed must not count a Codex PASS: ${where}`);
      }
    } finally {
      disposeFixture(dir);
    }
  }
});

test('codex escalation: two consecutive Codex FAILs trigger two-consecutive-fails, named or not (gate and dashboard agree)', () => {
  for (const checks of ['tests', 'tests,codex']) {
    const dir = makeSwarmDir();
    try {
      writeLedger(dir, [['cxe', '1', checks, 'accepted', '2', 'w', 'r']]);
      writeCodex(dir, 'cxe', 1, 'FAIL');
      writeCodex(dir, 'cxe', 2, 'FAIL');
      writeVerdicts(dir, 'cxe', 2, [['checker-tests', 'anthropic', 'PASS']]);
      const g = gateRun(dir, 'cxe');
      const state = parseInChild(dir);
      assert.equal(g.ok, false, `checks=${checks}: ${g.out}`);
      assert.equal(taskOf(state, 'cxe').derived.state, 'flagged', `checks=${checks}`);
      assert.ok(g.out.includes('two-consecutive-fails'), g.out);
      assert.deepEqual(mismatchesOf(state, 'cxe'), [
        'task cxe: ledger says accepted but escalation trigger (two-consecutive-fails) and no flag — run gate.sh escalate-scan',
      ]);
    } finally {
      disposeFixture(dir);
    }
  }
});

// A UTF-8 locale the TEST sets itself for the gate child (LC_ALL), so a gate
// that parses headers in the CALLER's locale is caught whatever locale this
// suite runs under. null when the host has none.
function utf8Locale() {
  const r = spawnSync('locale', ['-a'], { encoding: 'utf8' });
  const names = (r.stdout ?? '').split('\n');
  return names.find((n) => /^c\.utf-?8$/i.test(n)) ?? names.find((n) => /^en_US\.utf-?8$/i.test(n)) ?? null;
}
const UTF8_LOCALE = utf8Locale();

test('codex skip headers: the gate gives the same answer under C and a UTF-8 locale, and the dashboard agrees', { skip: UTF8_LOCALE ? false : 'no UTF-8 locale on this host' }, () => {
  const cases = [
    ['DETAIL:<U+2003>', (id) => skipText(id, { detail: EMSP }), true],
    ['DETAIL:<U+3000>', (id) => skipText(id, { detail: IDSP }), true],
    ['DETAIL: <NBSP>', (id) => skipText(id, { detail: ` ${NBSP}` }), true],
    ['DETAIL:<VT> (stripped: empty)', (id) => skipText(id, { detail: '\v' }), false],
    ['REASON:<U+2003>quota', (id) => skipText(id, { reason: `${EMSP}quota` }), false],
    ['REASON:<U+3000>auth', (id) => skipText(id, { reason: `${IDSP}auth` }), false],
    ['TASK:<U+2003><id>', (id) => skipText(id, { task: `${EMSP}${id}` }), false],
    ['ATTEMPT:<U+2003>1', (id) => skipText(id, { attempt: `${EMSP}1` }), false],
    ['REASON: quota<U+2003>', (id) => skipText(id, { reason: ` quota${EMSP}` }), false],
    ['TAB and spaces before every value', (id) => `REASON:\t  quota\nDETAIL:\t d\nTASK:   ${id}\nATTEMPT: \t1\n`, true],
  ];
  for (const [name, text, expectAccepted] of cases) {
    const dir = makeSwarmDir();
    try {
      codexRow(dir, 'lh', 2, 'tests,codex');
      rawSkip(dir, 'lh', text('lh'));
      const state = parseInChild(dir);
      const dash = taskOf(state, 'lh').derived.state === 'accepted';
      assert.equal(dash, expectAccepted, `${name}: dashboard should ${expectAccepted ? 'accept' : 'refuse'}`);
      for (const loc of ['C', UTF8_LOCALE]) {
        const g = gateRun(dir, 'lh', { LC_ALL: loc, LANG: loc });
        assert.equal(g.ok, expectAccepted, `${name}: the gate under ${loc} should ${expectAccepted ? 'accept' : 'refuse'} (${g.out})`);
      }
    } finally {
      disposeFixture(dir);
    }
  }
});

// parse() must NEVER open a non-regular *.verdict entry and never throw or
// hang on one: a directory, FIFO, symlink loop, dangling link, or an entry it
// cannot read is an INVALID verdict file — reported in errors[], excluded from
// quorum, blocking at tiers 2/3 (gate.sh load_verdict's `[[ -f ]]`). Each case
// runs parse() in a child with a timeout, so a throw or a hang fails the test.
const NON_REGULAR_ENTRIES = [
  ['a directory', (p) => fs.mkdirSync(p)],
  ['a FIFO', (p) => assert.equal(spawnSync('mkfifo', [p]).status, 0)],
  ['a symlink loop', (p) => fs.symlinkSync(path.basename(p), p)],
  ['a dangling symlink', (p) => fs.symlinkSync('nowhere', p)],
  ['a symlink to a FIFO', (p) => { assert.equal(spawnSync('mkfifo', [`${p}.fifo`]).status, 0); fs.symlinkSync(path.basename(`${p}.fifo`), p); }],
  ['a mode-000 regular file', (p) => { fs.writeFileSync(p, 'VERDICT: PASS\n---\n'); fs.chmodSync(p, 0o000); }, NEEDS_NON_ROOT],
];
for (const [kind, make, opts] of NON_REGULAR_ENTRIES) {
  test(`codex verdict entries: parse() neither throws nor hangs on ${kind} named *.verdict — an invalid verdict file`, opts ?? {}, () => {
    const dir = makeSwarmDir();
    try {
      writeLedger(dir, [
        ['nr-t2', '2', 'tests', 'accepted', '1', 'w', 'r'],
        ['nr-t1n', '1', 'tests', 'accepted', '1', 'w', 'r'],
        ['nr-t1u', '1', 'tests', 'accepted', '1', 'w', 'r'],
        ['nr-cx', '1', 'tests,codex', 'accepted', '1', 'w', 'r'],
      ]);
      for (const id of ['nr-t2', 'nr-t1n', 'nr-t1u', 'nr-cx']) writeVerdicts(dir, id, 1, [['checker-tests', 'anthropic', 'PASS']]);
      writeCodexSkip(dir, 'nr-cx', 1);
      make(path.join(dir, 'verdicts/nr-t2.1.checker-other.verdict'));   // tier 2: any checker's entry blocks the row
      fs.rmSync(path.join(dir, 'verdicts/nr-t1n.1.checker-tests.verdict'), { force: true });
      make(path.join(dir, 'verdicts/nr-t1n.1.checker-tests.verdict'));  // tier 1: the NAMED checker's entry is never a PASS
      make(path.join(dir, 'verdicts/nr-t1u.1.checker-other.verdict'));  // tier 1: an unnamed entry is ignored
      make(path.join(dir, 'verdicts/nr-cx.1.checker-codex.verdict'));   // tier 1, codex named: invalid beside a valid skip
      const state = parseInChild(dir);
      for (const [id, checker] of [['nr-t2', 'checker-other'], ['nr-t1n', 'checker-tests'], ['nr-t1u', 'checker-other'], ['nr-cx', 'checker-codex']]) {
        const name = `${id}.1.${checker}.verdict`;
        const hit = state.errors.find((e) => e.file === `verdicts/${name}`);
        assert.ok(hit, `${kind} as ${name} must be reported in errors[]`);
        assert.ok(taskOf(state, id).invalidVerdicts.includes(name), `${name} must be listed as an invalid verdict file`);
        assert.ok(!taskOf(state, id).verdicts.some((v) => v.filename === name), `${name} must be excluded from quorum`);
      }
      assert.equal(taskOf(state, 'nr-t2').derived.state, 'blocked');
      assert.equal(taskOf(state, 'nr-t1n').derived.state, 'blocked');
      assert.equal(taskOf(state, 'nr-t1u').derived.state, 'accepted', 'an unnamed tier-1 entry is ignored, as the gate ignores it');
      assert.equal(taskOf(state, 'nr-cx').derived.state, 'blocked');
      assert.ok(mismatchesOf(state, 'nr-cx').join(' ').includes('invalid verdict checker-codex'), mismatchesOf(state, 'nr-cx').join(' | '));
      // and the gate refuses / accepts exactly the same rows
      for (const id of ['nr-t2', 'nr-t1n', 'nr-t1u', 'nr-cx']) {
        assert.equal(gateRun(dir, id).ok, taskOf(state, id).derived.state === 'accepted', `${kind}: gate and dashboard disagree on ${id}`);
      }
    } finally {
      disposeFixture(dir);
    }
  });
}

// ---------------------------------------------------------------------------
// codex: parse() NEVER OPENS a non-regular entry (CD4.1 rule 3 / CD4.2 item 2b).
// readVerdictEntry and parseCodexSkip stat the entry and return BEFORE any open
// when it is not a regular file; the O_NONBLOCK open + fstat re-check behind them
// would still keep a FIFO from hanging and classify the entry invalid, so no
// no-throw / no-hang test can tell the guard from its absence. This one counts the
// opens. The child is CommonJS (`node -e`): it patches fs.openSync and
// fs.readFileSync to count calls whose path argument is THE ENTRY, calls
// syncBuiltinESMExports() so named-import openers see the patch too, and only THEN
// imports parse.mjs. (An ESM child that imported fs first would miss them; this is
// not the ESM parseInChild helper.) A regular file is opened by design, so a
// mode-000 file is not one of the kinds.
// ---------------------------------------------------------------------------

const PARSE_MJS_URL = new URL('../lib/parse.mjs', import.meta.url).href;

function parseCountingOpens(dir, entryPath) {
  const code = `
    const fs = require('node:fs');
    const ENTRY = ${JSON.stringify(entryPath)};
    let n = 0;
    const hit = (p) => { try { if (typeof p === 'string' || p instanceof URL || Buffer.isBuffer(p)) { if (String(p) === ENTRY) n += 1; } } catch {} };
    const openSync = fs.openSync, readFileSync = fs.readFileSync;
    fs.openSync = function (p, ...a) { hit(p); return openSync.call(fs, p, ...a); };
    fs.readFileSync = function (p, ...a) { hit(p); return readFileSync.call(fs, p, ...a); };
    require('node:module').syncBuiltinESMExports();
    import(${JSON.stringify(PARSE_MJS_URL)}).then((m) => {
      const s = m.parse(${JSON.stringify(dir)});
      const t = s.tasks[0];
      process.stdout.write(JSON.stringify({
        opens: n,
        state: t && t.derived.state,
        invalidVerdicts: t ? t.invalidVerdicts : null,
        codexSkip: t ? t.codexSkip : null,
        errors: s.errors,
      }));
    }).catch((e) => process.stdout.write(JSON.stringify({ threw: String((e && e.message) || e) })));`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 20000 });
  assert.ok(!r.error && !r.signal, `parse() must neither throw nor hang (timeout/signal: ${r.error ?? r.signal})`);
  const out = JSON.parse(r.stdout);
  assert.equal(out.threw, undefined, `parse() threw: ${out.threw}`);
  return out;
}

// The seven non-regular kinds. make(entryPath) creates the entry; a symlink's
// target sits beside it under a name that is neither *.verdict nor *.skip.
const NEVER_OPENS_KINDS = [
  ['a FIFO', (p) => assert.equal(spawnSync('mkfifo', [p]).status, 0)],
  ['a directory', (p) => fs.mkdirSync(p)],
  ['a dangling symlink', (p) => fs.symlinkSync('nowhere', p)],
  ['a symlink loop', (p) => fs.symlinkSync(path.basename(p), p)],
  ['a symlink to a FIFO', (p) => { assert.equal(spawnSync('mkfifo', [`${p}.target`]).status, 0); fs.symlinkSync(path.basename(`${p}.target`), p); }],
  ['a symlink to a directory', (p) => { fs.mkdirSync(`${p}.dir`); fs.symlinkSync(path.basename(`${p}.dir`), p); }],
  ['a symlink to /dev/null (a device)', (p) => fs.symlinkSync('/dev/null', p)],
];

for (const [kind, make] of NEVER_OPENS_KINDS) {
  test(`codex: parse() never opens ${kind} named as a verdict entry (0 opens; entry invalid; row blocked)`, () => {
    const dir = makeSwarmDir();
    try {
      writeLedger(dir, [['no-v', '2', 'tests', 'accepted', '1', 'w', 'r']]);
      writeVerdicts(dir, 'no-v', 1, [['checker-tests', 'anthropic', 'PASS']]);
      const name = 'no-v.1.checker-other.verdict';
      const entry = path.join(dir, 'verdicts', name);
      make(entry);
      const out = parseCountingOpens(dir, entry);
      assert.equal(out.opens, 0, `parse() opened ${kind} ${name} ${out.opens} time(s): it must never open a non-regular verdict entry`);
      assert.equal(out.state, 'blocked', 'the row stays refused');
      assert.ok(out.invalidVerdicts.includes(name), `${name} must be listed as an invalid verdict file: ${JSON.stringify(out.invalidVerdicts)}`);
      assert.ok(out.errors.some((e) => e.file === `verdicts/${name}`), `${name} must be reported in errors[]`);
    } finally {
      disposeFixture(dir);
    }
  });

  test(`codex: parse() never opens ${kind} named as the Codex skip record (0 opens; no evidence; row blocked)`, () => {
    const dir = makeSwarmDir();
    try {
      writeLedger(dir, [['no-s', '2', 'tests,codex', 'accepted', '1', 'w', 'r']]);
      writeVerdicts(dir, 'no-s', 1, [['checker-tests', 'anthropic', 'PASS']]);
      const entry = path.join(dir, 'verdicts', 'no-s.1.checker-codex.skip');
      make(entry);
      const out = parseCountingOpens(dir, entry);
      assert.equal(out.opens, 0, `parse() opened ${kind} as the skip record ${out.opens} time(s): it must never open a non-regular skip record`);
      assert.equal(out.state, 'blocked', 'the row stays refused');
      assert.equal(out.codexSkip, null, 'a non-regular skip record counts as absent');
      assert.ok(
        out.errors.some((e) => e.file === 'ledger.tsv' && e.message.includes('task no-s:') && e.message.includes('missing checker-codex evidence')),
        `the dashboard mismatch names the missing evidence: ${JSON.stringify(out.errors)}`
      );
    } finally {
      disposeFixture(dir);
    }
  });
}

test('codex: the opens counter sees a regular verdict entry and a regular skip record (control: the counter works)', () => {
  const dir = makeSwarmDir();
  try {
    writeLedger(dir, [['no-c', '2', 'tests,codex', 'accepted', '1', 'w', 'r']]);
    writeVerdicts(dir, 'no-c', 1, [['checker-tests', 'anthropic', 'PASS']]);
    writeCodexSkip(dir, 'no-c', 1);
    const verdictEntry = path.join(dir, 'verdicts', 'no-c.1.checker-tests.verdict');
    const skipEntry = path.join(dir, 'verdicts', 'no-c.1.checker-codex.skip');
    const v = parseCountingOpens(dir, verdictEntry);
    const sk = parseCountingOpens(dir, skipEntry);
    assert.ok(v.opens >= 1, 'a regular verdict file is opened by design — the counter must see it');
    assert.ok(sk.opens >= 1, 'a regular skip record is opened by design — the counter must see it');
    assert.equal(v.state, 'accepted');
  } finally {
    disposeFixture(dir);
  }
});

// ---------------------------------------------------------------------------
// module shape
// ---------------------------------------------------------------------------

test('parse() is a pure function exported from the module', () => {
  assert.equal(typeof parse, 'function');
});
