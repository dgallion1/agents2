// CD4 oracle, differential half. Usage: node differential.mjs <TREE>
// Every row ledgered 'accepted'. Requires gate `check` exit 0 <=>
// derived.state === 'accepted', each scenario's pinned outcome, and (where
// named) a fragment in the gate's FAIL line.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TREE = path.resolve(process.argv[2] ?? '.');
const GATE = path.join(TREE, 'swarm', 'gate.sh');
const { parse } = await import(pathToFileURL(path.join(TREE, 'dashboard', 'lib', 'parse.mjs')).href);
const ROOT = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cd4-diff-'));

let nfail = 0;
const ok = (m) => console.log(`ok   - ${m}`);
const bad = (m) => { console.log(`FAIL - ${m}`); nfail += 1; };
const sha = (b) => createHash('sha256').update(b).digest('hex');

function w(dir, rel, content, mode) {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, content);
  if (mode !== undefined) fs.chmodSync(f, mode);
}
function ledger(dir, rows) {
  w(dir, 'ledger.tsv', ['# task_id\ttier\tchecks\tstatus\tattempt\tworker\treason',
    ...rows.map((r) => [r[0], r[1], r[2], 'accepted', r[3] ?? '1', 'worker-coder', 'probe'].join('\t'))].join('\n') + '\n');
}
function manifest(dir, task, att) {
  const p = `src/${task}.txt`;
  const full = path.join(dir, 'tree', p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (!fs.existsSync(full)) fs.writeFileSync(full, `content of ${p}\n`);
  w(dir, `manifests/${task}.${att}.files`, `${p}\n`);
  w(dir, `manifests/${task}.${att}.sha256`, `${sha(fs.readFileSync(full))}  ${p}\n`);
}
function v(dir, task, att, checker, family, verdict, { ms = true, extra = '' } = {}) {
  const side = path.join(dir, `manifests/${task}.${att}.sha256`);
  const m = ms && verdict === 'PASS' && fs.existsSync(side) ? `MANIFEST_SHA256: ${sha(fs.readFileSync(side))}\n` : '';
  w(dir, `verdicts/${task}.${att}.${checker}.verdict`,
    `VERDICT: ${verdict}\nCHECKER: ${checker}\nFAMILY: ${family}\nTASK: ${task}\nATTEMPT: ${att}\n${m}${extra}---\nprobe\n`);
}
const codex = (d, t, a, verdict, opts) => v(d, t, a, 'checker-codex', 'crossvendor', verdict,
  { ...opts, extra: 'CODEX_MODEL: gpt-6-astra\nCODEX_VERSION: codex-cli stub\n' });
function skip(dir, task, att, reason, { tTask = task, tAtt = att, detail = 'probe' } = {}) {
  w(dir, `verdicts/${task}.${att}.checker-codex.skip`, `REASON: ${reason}\nDETAIL: ${detail}\nTASK: ${tTask}\nATTEMPT: ${tAtt}\n`);
}
function oracle3(dir, task) {
  w(dir, `tier3/${task}/accept.sh`, '#!/bin/sh\necho ORACLE PASS\n', 0o755);
  w(dir, `tier3/${task}/oracle.1.log`, 'probe\nORACLE PASS\n');
}
function base(d, t, tier, checks, { second = 'PASS', tests = 'PASS' } = {}) {
  ledger(d, [[t, tier, checks]]); manifest(d, t, 1);
  if (tests) v(d, t, 1, 'checker-tests', 'anthropic', tests);
  if (second && checks.includes('second')) v(d, t, 1, 'checker-second', 'adversarial', second);
  if (tier === '3') oracle3(d, t);
}
function gate(dir, task) {
  const r = spawnSync('bash', [GATE, 'check', task], {
    env: { ...process.env, SWARM_DIR: dir, SWARM_TREE: path.join(dir, 'tree') }, encoding: 'utf8', timeout: 30000 });
  if (r.error) throw new Error(r.error.message);
  if (r.status !== 0 && r.status !== 1) throw new Error(`gate exit ${r.status}: ${r.stdout}${r.stderr}`);
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}
function gateDone(dir) {
  const r = spawnSync('bash', [GATE, 'done'], {
    env: { ...process.env, SWARM_DIR: dir, SWARM_TREE: path.join(dir, 'tree') }, encoding: 'utf8', timeout: 30000 });
  if (r.error) throw new Error(r.error.message);
  return r.status === 0;
}

const REASONS = ["no-exclude-policy", "no-criteria", "no-evidence", "no-codex", "docker-unavailable", "unsafe-tree", "fingerprint-mismatch", "container-error", "auth", "quota", "timeout", "schema-invalid", "evidence-free-pass", "secret-leak", "codex-error"];
const E = 'missing checker-codex evidence';
const panel = (d, t, a = 1) => { v(d, t, a, 'judge-claude', 'anthropic', 'OVERRULE'); v(d, t, a, 'judge-standards', 'adversarial', 'OVERRULE'); v(d, t, a, 'judge-impact', 'impact', 'UPHOLD'); };
// [name, setup, expect, fragment, identityValid(default true), codexPassAccepted]
const S = [
  ['X1 tier 2 named: a Codex PASS alongside real PASSes accepts', (d) => { base(d, 'x1', '2', 'tests,second,codex'); codex(d, 'x1', 1, 'PASS'); return 'x1'; }, 'accept', null, true, true],
  ['X2 tier 2: a Codex FAIL counts (no panel) → refused as a dispute', (d) => { base(d, 'x2', '2', 'tests,second,codex'); codex(d, 'x2', 1, 'FAIL'); return 'x2'; }, 'reject', 'dispute'],
  ['X3 tier 2: a Codex FAIL overruled by a real panel → accepted', (d) => { base(d, 'x3', '2', 'tests,second,codex'); codex(d, 'x3', 1, 'FAIL'); panel(d, 'x3'); return 'x3'; }, 'accept'],
  ['X4 tier 2 named, no Codex evidence → refused', (d) => { base(d, 'x4', '2', 'tests,second,codex'); return 'x4'; }, 'reject', E],
  ...REASONS.map((r) => [`X5 tier 2 named: a valid '${r}' skip record is evidence → accepted`, (d) => { base(d, 'x5', '2', 'tests,second,codex'); skip(d, 'x5', 1, r); return 'x5'; }, 'accept']),
  ['X6 a skip with an unknown REASON is not evidence', (d) => { base(d, 'x6', '2', 'tests,second,codex'); skip(d, 'x6', 1, 'bogus-reason'); return 'x6'; }, 'reject', E],
  ['X7 a skip whose TASK disagrees with its name', (d) => { base(d, 'x7', '2', 'tests,second,codex'); skip(d, 'x7', 1, 'quota', { tTask: 'other' }); return 'x7'; }, 'reject', E],
  ['X7b a skip whose ATTEMPT disagrees with its name', (d) => { base(d, 'x7b', '2', 'tests,second,codex'); skip(d, 'x7b', 1, 'quota', { tAtt: 2 }); return 'x7b'; }, 'reject', E],
  ['X8 a skip with an empty DETAIL', (d) => { base(d, 'x8', '2', 'tests,second,codex'); skip(d, 'x8', 1, 'quota', { detail: '' }); return 'x8'; }, 'reject', E],
  ['X8b a skip with no DETAIL line', (d) => { base(d, 'x8b', '2', 'tests,second,codex'); w(d, 'verdicts/x8b.1.checker-codex.skip', 'REASON: quota\nTASK: x8b\nATTEMPT: 1\n'); return 'x8b'; }, 'reject', E],
  ['X8c a skip record that is a directory (never opened)', (d) => { base(d, 'x8c', '2', 'tests,second,codex'); fs.mkdirSync(path.join(d, 'verdicts/x8c.1.checker-codex.skip')); return 'x8c'; }, 'reject', E],
  ['X8d a skip record that is a FIFO (never opened, no hang)', (d) => { base(d, 'x8d', '2', 'tests,second,codex'); spawnSync('mkfifo', [path.join(d, 'verdicts/x8d.1.checker-codex.skip')]); return 'x8d'; }, 'reject', E],
  ['X8f a mode-000 skip record (unreadable → absent, parse() never throws)', (d) => { base(d, 'x8f', '2', 'tests,second,codex'); skip(d, 'x8f', 1, 'quota'); fs.chmodSync(path.join(d, 'verdicts/x8f.1.checker-codex.skip'), 0o000); return 'x8f'; }, 'reject', E],
  ['X8e first-match headers: a valid REASON first, a bogus one later → valid', (d) => { base(d, 'x8e', '2', 'tests,second,codex'); w(d, 'verdicts/x8e.1.checker-codex.skip', 'REASON: quota\nDETAIL: probe\nTASK: x8e\nATTEMPT: 1\nREASON: bogus\n'); return 'x8e'; }, 'accept'],
  ['X9 BOTH a Codex verdict and a skip record → refused', (d) => { base(d, 'x9', '2', 'tests,second,codex'); codex(d, 'x9', 1, 'PASS'); skip(d, 'x9', 1, 'quota'); return 'x9'; }, 'reject', 'checker-codex'],
  ['X10 tier 3: a Codex PASS does not supply the second lane', (d) => { base(d, 'x10', '3', 'tests,codex'); codex(d, 'x10', 1, 'PASS'); return 'x10'; }, 'reject', 'famil'],
  ['X11 tier 2: a Codex PASS does not stand in for a missing checker-second', (d) => { base(d, 'x11', '2', 'tests,second,codex', { second: null }); codex(d, 'x11', 1, 'PASS'); return 'x11'; }, 'reject', 'checker-second'],
  ['X12 tier 2: checks = codex only is refused like a blank column', (d) => { base(d, 'x12', '2', 'codex', { tests: null }); codex(d, 'x12', 1, 'PASS'); return 'x12'; }, 'reject', 'requires named checkers'],
  ['X13 tier 1: checks = codex only is refused like a blank column', (d) => { base(d, 'x13', '1', 'codex', { tests: null }); codex(d, 'x13', 1, 'PASS'); return 'x13'; }, 'reject', 'requires named checkers'],
  ['X14 tier 1: tests + codex, both PASS → accepted', (d) => { base(d, 'x14', '1', 'tests,codex'); codex(d, 'x14', 1, 'PASS'); return 'x14'; }, 'accept', null, true, true],
  ['X15 tier 1: a named Codex FAIL → refused', (d) => { base(d, 'x15', '1', 'tests,codex'); codex(d, 'x15', 1, 'FAIL'); return 'x15'; }, 'reject', 'checker-codex returned FAIL'],
  ['X16 codex NOT named, tier 2: a Codex FAIL still counts', (d) => { base(d, 'x16', '2', 'tests'); codex(d, 'x16', 1, 'FAIL'); return 'x16'; }, 'reject', 'dispute'],
  ['X17 codex NOT named, tier 1: an unnamed Codex FAIL is ignored', (d) => { base(d, 'x17', '1', 'tests'); codex(d, 'x17', 1, 'FAIL'); return 'x17'; }, 'accept'],
  ['X18 codex NOT named, tier 2: a skip record is ignored', (d) => { base(d, 'x18', '2', 'tests'); skip(d, 'x18', 1, 'quota'); return 'x18'; }, 'accept'],
  ['X19 tier 3: tests + second + codex, all PASS → accepted', (d) => { base(d, 'x19', '3', 'tests,second,codex'); codex(d, 'x19', 1, 'PASS'); return 'x19'; }, 'accept', null, true, true],
  ['X20 a Codex PASS without MANIFEST_SHA256 → refused', (d) => { base(d, 'x20', '2', 'tests,second,codex'); codex(d, 'x20', 1, 'PASS', { ms: false }); return 'x20'; }, 'reject', 'MANIFEST_SHA256'],
  ['X21 codex NOT named, tier 2: a Codex PASS is loaded, not invalid', (d) => { base(d, 'x21', '2', 'tests'); codex(d, 'x21', 1, 'PASS'); return 'x21'; }, 'accept', null, true, true],
  ['X22 tier 3 named + a valid skip → accepted (an outage never blocks)', (d) => { base(d, 'x22', '3', 'tests,second,codex'); skip(d, 'x22', 1, 'quota'); return 'x22'; }, 'accept'],
  ['X23 tier 3 named, no Codex evidence', (d) => { base(d, 'x23', '3', 'tests,second,codex'); return 'x23'; }, 'reject', E],
  ['X24 tier 3: a Codex FAIL → refused as a dispute', (d) => { base(d, 'x24', '3', 'tests,second,codex'); codex(d, 'x24', 1, 'FAIL'); return 'x24'; }, 'reject', 'dispute'],
  ['X25 tier 3: a Codex FAIL overruled by a panel → accepted', (d) => { base(d, 'x25', '3', 'tests,second,codex'); codex(d, 'x25', 1, 'FAIL'); panel(d, 'x25'); return 'x25'; }, 'accept'],
  ['X26 tier 3: checks = codex only', (d) => { base(d, 'x26', '3', 'codex', { tests: null }); codex(d, 'x26', 1, 'PASS'); return 'x26'; }, 'reject', 'requires named checkers'],
  ['X27 tier 1 named + a valid skip → accepted', (d) => { base(d, 'x27', '1', 'tests,codex'); skip(d, 'x27', 1, 'timeout'); return 'x27'; }, 'accept'],
  ['X28 tier 1 named, no Codex evidence', (d) => { base(d, 'x28', '1', 'tests,codex'); return 'x28'; }, 'reject', E],
  ['X29 tier 1: both a verdict and a skip → refused', (d) => { base(d, 'x29', '1', 'tests,codex'); codex(d, 'x29', 1, 'PASS'); skip(d, 'x29', 1, 'quota'); return 'x29'; }, 'reject', 'checker-codex'],
  ['X30 tier 1: an invalid skip is not evidence', (d) => { base(d, 'x30', '1', 'tests,codex'); skip(d, 'x30', 1, 'bogus'); return 'x30'; }, 'reject', E],
  ['X31 evidence only at an OLDER attempt does not count', (d) => {
    ledger(d, [['x31', '2', 'tests,second,codex', '2']]); manifest(d, 'x31', 1); manifest(d, 'x31', 2);
    codex(d, 'x31', 1, 'PASS'); v(d, 'x31', 2, 'checker-tests', 'anthropic', 'PASS'); v(d, 'x31', 2, 'checker-second', 'adversarial', 'PASS'); return 'x31'; }, 'reject', E],
  ['X32 tier 2: a Codex PASS never makes up the second lane (second on the same lane)', (d) => {
    ledger(d, [['x32', '2', 'tests,second,codex']]); manifest(d, 'x32', 1);
    v(d, 'x32', 1, 'checker-tests', 'anthropic', 'PASS'); v(d, 'x32', 1, 'checker-second', 'anthropic', 'PASS'); codex(d, 'x32', 1, 'PASS'); return 'x32'; }, 'reject', 'lane'],
  ['X33 tier 3, codex NOT named: an unnamed Codex PASS is no lane', (d) => { base(d, 'x33', '3', 'tests'); codex(d, 'x33', 1, 'PASS'); return 'x33'; }, 'reject', 'famil'],
  ['X34 checker-codex with FAMILY adversarial → invalid', (d) => { base(d, 'x34', '2', 'tests,second'); v(d, 'x34', 1, 'checker-codex', 'adversarial', 'PASS'); return 'x34'; }, 'reject', 'invalid', false],
  ['X35 checker-tests with FAMILY crossvendor → invalid', (d) => {
    ledger(d, [['x35', '2', 'tests']]); manifest(d, 'x35', 1); v(d, 'x35', 1, 'checker-tests', 'crossvendor', 'PASS'); return 'x35'; }, 'reject', 'invalid', false],
  ['X36 named: a FAIL overruled by a panel still needs Codex evidence', (d) => {
    ledger(d, [['x36', '2', 'tests,codex']]); manifest(d, 'x36', 1); v(d, 'x36', 1, 'checker-tests', 'anthropic', 'FAIL'); panel(d, 'x36'); return 'x36'; }, 'reject', E],
];
for (const [name, setup, expect, frag, idValid = true, codexPass = false] of S) {
  const d = fs.mkdtempSync(path.join(ROOT, 'fx-'));
  let task, g, st;
  try { task = setup(d); g = gate(d, task); } catch (e) { bad(`${name}: gate harness error: ${e.message}`); continue; }
  try { st = parse(d); } catch (e) { bad(`${name}: parse() THREW: ${e.message}`); continue; }
  const t = st.tasks.find((x) => x.id === task);
  if (!t) { bad(`${name}: task missing from parse()`); continue; }
  const dashOk = t.derived.state === 'accepted';
  if (dashOk !== g.ok) { bad(`${name}: gate ${g.ok ? 'accepts' : 'rejects'} but dashboard '${t.derived.state}' (gate: ${g.out})`); continue; }
  let dn; try { dn = gateDone(d); } catch (e) { bad(`${name}: gate done harness error: ${e.message}`); continue; }
  if (dn !== g.ok) { bad(`${name}: 'done' ${dn ? 'accepts' : 'refuses'} but 'check' ${g.ok ? 'accepts' : 'refuses'}`); continue; }
  if ((expect === 'accept') !== g.ok) { bad(`${name}: both ${g.ok ? 'accept' : 'reject'}, expected ${expect} (gate: ${g.out})`); continue; }
  if (frag && !g.out.includes(frag)) { bad(`${name}: gate FAIL should mention '${frag}': ${g.out}`); continue; }
  if (idValid && /invalid FAMILY/i.test(g.out)) { bad(`${name}: refused as 'invalid FAMILY' — the pre-CD4 reason: ${g.out}`); continue; }
  if (codexPass && (t.derived.familiesPassed ?? []).includes('crossvendor')) { bad(`${name}: dashboard familiesPassed counts the Codex PASS: ${JSON.stringify(t.derived.familiesPassed)}`); continue; }
  if (frag === E) {
    const msgs = (st.errors ?? []).map((e) => e.message).filter((m) => m.includes(`task ${task}:`)).join(' | ');
    if (!msgs.includes(E)) { bad(`${name}: dashboard mismatch should name '${E}': ${msgs}`); continue; }
  }
  ok(`${name} (gate ${g.ok ? 'accepts' : 'rejects'}, dashboard '${t.derived.state}')`);
}
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`differential: ${S.length - nfail}/${S.length} ok`);
process.exit(nfail ? 1 : 0);
