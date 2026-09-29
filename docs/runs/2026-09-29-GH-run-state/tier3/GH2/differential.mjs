// GH2 oracle, differential half. Usage: node differential.mjs <TREE>
// Builds throwaway .swarm fixtures (every row ledgered 'accepted'), runs
// TREE/swarm/gate.sh check and TREE/dashboard/lib/parse.mjs on each, and
// requires (1) agreement: gate exit 0 <=> derived.state === 'accepted', and
// (2) where the scenario pins it, the specific outcome and the dashboard's
// mismatch text — so "both wrong the same way" cannot pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TREE = path.resolve(process.argv[2] ?? '.');
const GATE = path.join(TREE, 'swarm', 'gate.sh');
const { parse } = await import(pathToFileURL(path.join(TREE, 'dashboard', 'lib', 'parse.mjs')).href);
const ROOT = fs.mkdtempSync(path.join(process.env.TMPDIR ?? os.tmpdir(), 'gh2-diff-'));

let nfail = 0;
const ok = (m) => console.log(`ok   - ${m}`);
const bad = (m) => { console.log(`FAIL - ${m}`); nfail += 1; };
const sha = (b) => createHash('sha256').update(b).digest('hex');

function w(dir, rel, content, mode) {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  if (mode) fs.chmodSync(f, mode);
}
function ledger(dir, rows) {
  w(dir, 'ledger.tsv', ['# task_id\ttier\tchecks\tstatus\tattempt\tworker\treason',
    ...rows.map((r) => [r[0], r[1], r[2], 'accepted', r[3] ?? '1', 'worker-coder', 'probe'].join('\t'))].join('\n') + '\n');
}
// manifest + sidecar for (task, attempt); tree files live under <dir>/tree
function manifest(dir, task, att, paths) {
  const lines = paths.map((p) => {
    const full = path.join(dir, 'tree', p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (!fs.existsSync(full)) fs.writeFileSync(full, `content of ${p}\n`);
    return `${sha(fs.readFileSync(full))}  ${p}`;
  });
  w(dir, `manifests/${task}.${att}.files`, paths.join('\n') + '\n');
  w(dir, `manifests/${task}.${att}.sha256`, lines.join('\n') + '\n');
}
function verdict(dir, task, att, checker, family, v) {
  const side = path.join(dir, `manifests/${task}.${att}.sha256`);
  const ms = checker.startsWith('checker-') && v === 'PASS' && fs.existsSync(side)
    ? `MANIFEST_SHA256: ${sha(fs.readFileSync(side))}\n` : '';
  w(dir, `verdicts/${task}.${att}.${checker}.verdict`,
    `VERDICT: ${v}\nCHECKER: ${checker}\nFAMILY: ${family}\nTASK: ${task}\nATTEMPT: ${att}\n${ms}---\nprobe\n`);
}
function oracle3(dir, task, att = 1) {
  w(dir, `tier3/${task}/accept.sh`, '#!/bin/sh\necho ORACLE PASS\n', 0o755);
  w(dir, `tier3/${task}/oracle.${att}.log`, 'probe\nORACLE PASS\n');
}
function gateOk(dir, task) {
  const r = spawnSync('bash', [GATE, 'check', task], {
    env: { ...process.env, SWARM_DIR: dir, SWARM_TREE: path.join(dir, 'tree') }, encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) throw new Error(`gate exit ${r.status}: ${r.stdout}${r.stderr}`);
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}

// [name, setup(dir) -> task, expected: 'accept' | 'reject' | null (agreement only), mismatch fragments]
const S = [
  ['S1 tier-2 manifest hits a critical glob, no flag', (d) => {
    ledger(d, [['s1', '2', 'tests']]); manifest(d, 's1', 1, ['swarm/x.sh']);
    verdict(d, 's1', 1, 'checker-tests', 'anthropic', 'PASS');
    w(d, 'critical.globs', 'swarm/**\n'); return 's1';
  }, 'reject', ['critical-glob', 'escalate-scan']],
  ['S2 control: no critical-glob hit', (d) => {
    ledger(d, [['s2', '2', 'tests']]); manifest(d, 's2', 1, ['swarm/x.sh']);
    verdict(d, 's2', 1, 'checker-tests', 'anthropic', 'PASS');
    w(d, 'critical.globs', 'nomatch/**\n'); return 's2';
  }, 'accept', []],
  ['S3 critical path exempted by the default test globs', (d) => {
    ledger(d, [['s3', '2', 'tests']]); manifest(d, 's3', 1, ['swarm/x_test.go']);
    verdict(d, 's3', 1, 'checker-tests', 'anthropic', 'PASS');
    w(d, 'critical.globs', 'swarm/**\n'); return 's3';
  }, 'accept', []],
  ['S4a critical path exempted by a custom test.globs', (d) => {
    ledger(d, [['s4a', '2', 'tests']]); manifest(d, 's4a', 1, ['swarm/probe.sh']);
    verdict(d, 's4a', 1, 'checker-tests', 'anthropic', 'PASS');
    w(d, 'critical.globs', 'swarm/**\n'); w(d, 'test.globs', 'swarm/probe.sh\n'); return 's4a';
  }, 'accept', []],
  ['S4b a present test.globs replaces the defaults entirely', (d) => {
    ledger(d, [['s4b', '2', 'tests']]); manifest(d, 's4b', 1, ['swarm/x_test.go']);
    verdict(d, 's4b', 1, 'checker-tests', 'anthropic', 'PASS');
    w(d, 'critical.globs', 'swarm/**\n'); w(d, 'test.globs', 'nomatch\n'); return 's4b';
  }, 'reject', ['critical-glob']],
  ['S5 **/X also matches X at the root', (d) => {
    ledger(d, [['s5', '2', 'tests']]); manifest(d, 's5', 1, ['gate.sh']);
    verdict(d, 's5', 1, 'checker-tests', 'anthropic', 'PASS');
    w(d, 'critical.globs', '**/gate.sh\n'); return 's5';
  }, 'reject', ['critical-glob']],
  ['S6 critical hit only in an OLDER attempt manifest', (d) => {
    ledger(d, [['s6', '2', 'tests', '2']]); manifest(d, 's6', 1, ['swarm/x.sh']);
    manifest(d, 's6', 2, ['src/ok.txt']);
    verdict(d, 's6', 2, 'checker-tests', 'anthropic', 'PASS');
    w(d, 'critical.globs', 'swarm/**\n'); return 's6';
  }, 'reject', ['critical-glob']],
  ['S7 tier-3 row with a critical hit is never blocked inline', (d) => {
    ledger(d, [['s7', '3', 'tests,second']]); manifest(d, 's7', 1, ['swarm/x.sh']);
    verdict(d, 's7', 1, 'checker-tests', 'anthropic', 'PASS');
    verdict(d, 's7', 1, 'checker-second', 'adversarial', 'PASS');
    oracle3(d, 's7'); w(d, 'critical.globs', 'swarm/**\n'); return 's7';
  }, 'accept', []],
  ['S8 a CLOSED flag file suppresses the inline check (gate tests file existence)', (d) => {
    ledger(d, [['s8', '2', 'tests']]); manifest(d, 's8', 1, ['swarm/x.sh']);
    verdict(d, 's8', 1, 'checker-tests', 'anthropic', 'PASS');
    w(d, 'critical.globs', 'swarm/**\n'); w(d, 'flags/s8.flag', 'TARGET_TIER: 2\nREASON: critical-glob\n');
    return 's8';
  }, 'accept', []],
  ['S9 a boss OVERRULE at an old attempt triggers at tier 1', (d) => {
    ledger(d, [['s9', '1', 'tests', '2']]); manifest(d, 's9', 1, ['src/a.txt']);
    verdict(d, 's9', 1, 'checker-tests', 'anthropic', 'FAIL');
    verdict(d, 's9', 1, 'boss', 'anthropic', 'OVERRULE');
    manifest(d, 's9', 2, ['src/a.txt']); verdict(d, 's9', 2, 'checker-tests', 'anthropic', 'PASS');
    return 's9';
  }, 'reject', ['checker-overruled', 'escalate-scan']],
  ['S10 a boss OVERRULE on a tier-3 row is not blocked inline', (d) => {
    ledger(d, [['s10', '3', 'tests,second', '2']]); manifest(d, 's10', 1, ['src/a.txt']);
    verdict(d, 's10', 1, 'boss', 'anthropic', 'OVERRULE');
    manifest(d, 's10', 2, ['src/a.txt']);
    verdict(d, 's10', 2, 'checker-tests', 'anthropic', 'PASS');
    verdict(d, 's10', 2, 'checker-second', 'adversarial', 'PASS');
    oracle3(d, 's10', 2); return 's10';
  }, 'accept', []],
  ['S11 dot-prefix sibling manifest (agreement only — mirrors the gate glob)', (d) => {
    ledger(d, [['k', '2', 'tests'], ['k.1.x', '2', 'tests']]);
    manifest(d, 'k', 1, ['src/k.txt']); verdict(d, 'k', 1, 'checker-tests', 'anthropic', 'PASS');
    manifest(d, 'k.1.x', 1, ['swarm/x.sh']);
    w(d, 'critical.globs', 'swarm/**\n'); return 'k';
  }, null, []],
  ['S12 unresolved FAIL at attempt 1, overruled FAIL at attempt 2: no trigger', (d) => {
    ledger(d, [['s12', '2', 'tests', '2']]); manifest(d, 's12', 1, ['src/a.txt']);
    verdict(d, 's12', 1, 'checker-tests', 'anthropic', 'FAIL');
    manifest(d, 's12', 2, ['src/a.txt']);
    verdict(d, 's12', 2, 'checker-tests', 'anthropic', 'FAIL');
    verdict(d, 's12', 2, 'judge-claude', 'anthropic', 'OVERRULE');
    verdict(d, 's12', 2, 'judge-standards', 'adversarial', 'OVERRULE');
    verdict(d, 's12', 2, 'judge-impact', 'impact', 'UPHOLD');
    return 's12';
  }, 'accept', []],
  ['S13 two consecutive unresolved FAILs: the trigger outranks the tier check', (d) => {
    ledger(d, [['s13', '1', 'tests', '2']]); manifest(d, 's13', 1, ['src/a.txt']);
    verdict(d, 's13', 1, 'checker-tests', 'anthropic', 'FAIL');
    manifest(d, 's13', 2, ['src/a.txt']);
    verdict(d, 's13', 2, 'checker-tests', 'anthropic', 'FAIL');
    return 's13';
  }, 'reject', ['two-consecutive-fails']],
];

for (const [name, setup, expect, frags] of S) {
  const d = fs.mkdtempSync(path.join(ROOT, 'fx-'));
  let task, gate, st;
  try {
    task = setup(d);
    gate = gateOk(d, task);
    st = parse(d);
  } catch (e) { bad(`${name}: harness error: ${e.message}`); continue; }
  const t = st.tasks.find((x) => x.id === task);
  if (!t) { bad(`${name}: task ${task} missing from parse()`); continue; }
  const dashOk = t.derived.state === 'accepted';
  if (dashOk !== gate.ok) {
    bad(`${name}: gate ${gate.ok ? 'accepts' : 'rejects'} but dashboard state is '${t.derived.state}' (gate: ${gate.out})`);
    continue;
  }
  if (expect && (expect === 'accept') !== gate.ok) {
    bad(`${name}: both ${gate.ok ? 'accept' : 'reject'}, expected ${expect} (gate: ${gate.out})`);
    continue;
  }
  if (frags.length) {
    const msgs = (st.errors ?? []).map((e) => e.message).filter((m) => m.includes(`task ${task}:`)).join(' | ');
    const miss = frags.filter((f) => !msgs.includes(f));
    if (miss.length) { bad(`${name}: dashboard mismatch lacks ${JSON.stringify(miss)}: '${msgs}'`); continue; }
  }
  ok(`${name} (gate ${gate.ok ? 'accepts' : 'rejects'}, dashboard '${t.derived.state}')`);
}
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`differential: ${S.length - nfail}/${S.length} ok`);
process.exit(nfail ? 1 : 0);
