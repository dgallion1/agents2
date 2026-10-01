// CD2 oracle, differential half. Usage: node differential.mjs <TREE>
// Every row ledgered 'accepted'. Requires gate `check` exit 0 <=>
// derived.state === 'accepted', AND each scenario's pinned outcome, AND (for
// rejections caused by the pairing rule) that both the gate output and the
// dashboard mismatch say "invalid verdict" — so both-wrong cannot pass.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TREE = path.resolve(process.argv[2] ?? '.');
const GATE = path.join(TREE, 'swarm', 'gate.sh');
const { parse } = await import(pathToFileURL(path.join(TREE, 'dashboard', 'lib', 'parse.mjs')).href);
const ROOT = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cd2-diff-'));

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
function manifest(dir, task, att, paths = [`src/${task}.txt`]) {
  const lines = paths.map((p) => {
    const full = path.join(dir, 'tree', p);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    if (!fs.existsSync(full)) fs.writeFileSync(full, `content of ${p}\n`);
    return `${sha(fs.readFileSync(full))}  ${p}`;
  });
  w(dir, `manifests/${task}.${att}.files`, paths.join('\n') + '\n');
  w(dir, `manifests/${task}.${att}.sha256`, lines.join('\n') + '\n');
}
// stamp MANIFEST_SHA256 on EVERY PASS (whatever the identity), so a rejection
// can only come from the pairing rule, never from a missing fingerprint
function verdict(dir, task, att, checker, family, v) {
  const side = path.join(dir, `manifests/${task}.${att}.sha256`);
  const ms = v === 'PASS' && fs.existsSync(side) ? `MANIFEST_SHA256: ${sha(fs.readFileSync(side))}\n` : '';
  w(dir, `verdicts/${task}.${att}.${checker}.verdict`,
    `VERDICT: ${v}\nCHECKER: ${checker}\nFAMILY: ${family}\nTASK: ${task}\nATTEMPT: ${att}\n${ms}---\nprobe\n`);
}
function oracle3(dir, task, att = 1) {
  w(dir, `tier3/${task}/accept.sh`, '#!/bin/sh\necho ORACLE PASS\n', 0o755);
  w(dir, `tier3/${task}/oracle.${att}.log`, 'probe\nORACLE PASS\n');
}
function gate(dir, task) {
  const r = spawnSync('bash', [GATE, 'check', task], {
    env: { ...process.env, SWARM_DIR: dir, SWARM_TREE: path.join(dir, 'tree') }, encoding: 'utf8' });
  if (r.status !== 0 && r.status !== 1) throw new Error(`gate exit ${r.status}: ${r.stdout}${r.stderr}`);
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}

// [name, setup -> task, expected 'accept'|'reject', pairingRejection]
const S = [
  ['L1 tier-3: a judge-named PASS no longer supplies the second lane', (d) => {
    ledger(d, [['l1', '3', 'tests']]); manifest(d, 'l1', 1);
    verdict(d, 'l1', 1, 'checker-tests', 'anthropic', 'PASS');
    verdict(d, 'l1', 1, 'judge-x', 'adversarial', 'PASS'); oracle3(d, 'l1'); return 'l1';
  }, 'reject', true],
  ['L2 tier-2: a boss PASS is invalid', (d) => {
    ledger(d, [['l2', '2', 'tests']]); manifest(d, 'l2', 1);
    verdict(d, 'l2', 1, 'checker-tests', 'anthropic', 'PASS');
    verdict(d, 'l2', 1, 'boss', 'anthropic', 'PASS'); return 'l2';
  }, 'reject', true],
  ['L3 tier-2: a checker casting OVERRULE is invalid', (d) => {
    ledger(d, [['l3', '2', 'tests']]); manifest(d, 'l3', 1);
    verdict(d, 'l3', 1, 'checker-tests', 'anthropic', 'PASS');
    verdict(d, 'l3', 1, 'checker-rogue', 'adversarial', 'OVERRULE'); return 'l3';
  }, 'reject', true],
  ['L4 control: a real three-judge panel still overrules a FAIL', (d) => {
    ledger(d, [['l4', '2', 'tests']]); manifest(d, 'l4', 1);
    verdict(d, 'l4', 1, 'checker-tests', 'anthropic', 'FAIL');
    verdict(d, 'l4', 1, 'judge-claude', 'anthropic', 'OVERRULE');
    verdict(d, 'l4', 1, 'judge-standards', 'adversarial', 'OVERRULE');
    verdict(d, 'l4', 1, 'judge-impact', 'impact', 'UPHOLD'); return 'l4';
  }, 'accept', false],
  ['L5 control: tier-3 with two real checker lanes accepts', (d) => {
    ledger(d, [['l5', '3', 'tests,second']]); manifest(d, 'l5', 1);
    verdict(d, 'l5', 1, 'checker-tests', 'anthropic', 'PASS');
    verdict(d, 'l5', 1, 'checker-second', 'adversarial', 'PASS'); oracle3(d, 'l5'); return 'l5';
  }, 'accept', false],
  ['L6 control: tier 1 still ignores an unnamed invalid file', (d) => {
    ledger(d, [['l6', '1', 'tests']]); manifest(d, 'l6', 1);
    verdict(d, 'l6', 1, 'checker-tests', 'anthropic', 'PASS');
    verdict(d, 'l6', 1, 'judge-x', 'adversarial', 'PASS'); return 'l6';
  }, 'accept', false],
  ['L7 tier-2: a judge casting FAIL is invalid', (d) => {
    ledger(d, [['l7', '2', 'tests']]); manifest(d, 'l7', 1);
    verdict(d, 'l7', 1, 'checker-tests', 'anthropic', 'PASS');
    verdict(d, 'l7', 1, 'judge-standards', 'adversarial', 'FAIL'); return 'l7';
  }, 'reject', true],
  ['L8 control: an invalid pairing at an OLD attempt does not block the current one', (d) => {
    ledger(d, [['l8', '2', 'tests', '2']]); manifest(d, 'l8', 1);
    verdict(d, 'l8', 1, 'judge-x', 'adversarial', 'PASS');
    manifest(d, 'l8', 2); verdict(d, 'l8', 2, 'checker-tests', 'anthropic', 'PASS'); return 'l8';
  }, 'accept', false],
  ['L9 control: a valid boss OVERRULE at an old attempt still triggers escalation', (d) => {
    ledger(d, [['l9', '2', 'tests', '2']]); manifest(d, 'l9', 1);
    verdict(d, 'l9', 1, 'boss', 'anthropic', 'OVERRULE');
    manifest(d, 'l9', 2); verdict(d, 'l9', 2, 'checker-tests', 'anthropic', 'PASS'); return 'l9';
  }, 'reject', false],
  ['L10 tier-3: an UPHOLD cast by a checker is invalid', (d) => {
    ledger(d, [['l10', '3', 'tests,second']]); manifest(d, 'l10', 1);
    verdict(d, 'l10', 1, 'checker-tests', 'anthropic', 'PASS');
    verdict(d, 'l10', 1, 'checker-second', 'adversarial', 'PASS');
    verdict(d, 'l10', 1, 'checker-a11y', 'impact', 'UPHOLD'); oracle3(d, 'l10'); return 'l10';
  }, 'reject', true],
  // census CD2.1 gap 6/7: an allow-list, with exact identity boundaries
  ...[
    ['worker-coder', 'PASS'], ['lead', 'UPHOLD'], ['boss', 'FAIL'], ['judge-claude', 'PASS'],
    ['checker', 'PASS'], ['checkerx-y', 'PASS'], ['judge', 'OVERRULE'], ['boss-2', 'OVERRULE'], ['Boss', 'OVERRULE'],
  ].map(([who, v], i) => [`L${11 + i} tier-2: ${v} from '${who}' is invalid`, (d) => {
    const t = `m${i}`;
    ledger(d, [[t, '2', 'tests']]); manifest(d, t, 1);
    verdict(d, t, 1, 'checker-tests', 'anthropic', 'PASS');
    verdict(d, t, 1, who, 'impact', v); return t;
  }, 'reject', true]),
  // census gap 8: the valid boss side at the CURRENT attempt
  ['L20 control: a panel with a boss UPHOLD at the current attempt still resolves', (d) => {
    ledger(d, [['l20', '2', 'tests']]); manifest(d, 'l20', 1);
    verdict(d, 'l20', 1, 'checker-tests', 'anthropic', 'FAIL');
    verdict(d, 'l20', 1, 'judge-standards', 'adversarial', 'OVERRULE');
    verdict(d, 'l20', 1, 'judge-impact', 'impact', 'OVERRULE');
    verdict(d, 'l20', 1, 'boss', 'anthropic', 'UPHOLD'); return 'l20';
  }, 'accept', false],
];

for (const [name, setup, expect, pairing] of S) {
  const d = fs.mkdtempSync(path.join(ROOT, 'fx-'));
  let task, g, st;
  try { task = setup(d); g = gate(d, task); st = parse(d); }
  catch (e) { bad(`${name}: harness error: ${e.message}`); continue; }
  const t = st.tasks.find((x) => x.id === task);
  if (!t) { bad(`${name}: task missing from parse()`); continue; }
  const dashOk = t.derived.state === 'accepted';
  if (dashOk !== g.ok) { bad(`${name}: gate ${g.ok ? 'accepts' : 'rejects'} but dashboard '${t.derived.state}' (gate: ${g.out})`); continue; }
  if ((expect === 'accept') !== g.ok) { bad(`${name}: both ${g.ok ? 'accept' : 'reject'}, expected ${expect} (gate: ${g.out})`); continue; }
  if (pairing) {
    const msgs = (st.errors ?? []).map((e) => e.message).join(' | ');
    if (!/invalid verdict/i.test(g.out)) { bad(`${name}: gate rejects but not for an invalid verdict: ${g.out}`); continue; }
    if (!/not allowed/i.test(g.out + ' ' + msgs)) { bad(`${name}: no 'not allowed' pairing message in gate or dashboard: ${g.out} || ${msgs}`); continue; }
    { const inv = [...fs.readdirSync(path.join(d, 'verdicts'))].find((f) => !/\.checker-tests\.verdict$/.test(f) && !/\.checker-second\.verdict$/.test(f));
      const who = inv ? inv.split('.').slice(2, -1).join('.') : '';
      const vv = inv ? /VERDICT: (\S+)/.exec(fs.readFileSync(path.join(d, 'verdicts', inv), 'utf8'))[1] : '';
      if (!g.out.includes(`'${who}'`) || !g.out.includes(vv)) { bad(`${name}: gate message does not name both VERDICT ${vv} and CHECKER '${who}': ${g.out}`); continue; } }
    if (!msgs.includes(`task ${task}:`) || !/invalid verdict/i.test(msgs)) { bad(`${name}: dashboard mismatch lacks 'invalid verdict': ${msgs}`); continue; }
  }
  ok(`${name} (gate ${g.ok ? 'accepts' : 'rejects'}, dashboard '${t.derived.state}')`);
}
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`differential: ${S.length - nfail}/${S.length} ok`);
process.exit(nfail ? 1 : 0);
