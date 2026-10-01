// CD3 oracle, differential half. Usage: node differential.mjs <TREE>
// Every row ledgered 'accepted'. Requires gate `check` exit 0 <=>
// derived.state === 'accepted', each scenario's pinned outcome, and — where
// the rejection is the unreadable case — the reason token
// `critical-glob-unreadable` in both the gate output and the dashboard mismatch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TREE = path.resolve(process.argv[2] ?? '.');
const GATE = path.join(TREE, 'swarm', 'gate.sh');
const { parse } = await import(pathToFileURL(path.join(TREE, 'dashboard', 'lib', 'parse.mjs')).href);
const ROOT = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cd3-diff-'));

let nfail = 0;
const ok = (m) => console.log(`ok   - ${m}`);
const bad = (m) => { console.log(`FAIL - ${m}`); nfail += 1; };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const BAD_UTF8 = Buffer.from([0x73, 0x77, 0xff, 0xfe, 0x2f, 0x2a, 0x2a, 0x0a]); // "sw\xff\xfe/**\n"

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
function pass(dir, task, att, checker, family) {
  const ms = sha(fs.readFileSync(path.join(dir, `manifests/${task}.${att}.sha256`)));
  w(dir, `verdicts/${task}.${att}.${checker}.verdict`,
    `VERDICT: PASS\nCHECKER: ${checker}\nFAMILY: ${family}\nTASK: ${task}\nATTEMPT: ${att}\nMANIFEST_SHA256: ${ms}\n---\nprobe\n`);
}
function oracle3(dir, task) {
  w(dir, `tier3/${task}/accept.sh`, '#!/bin/sh\necho ORACLE PASS\n', 0o755);
  w(dir, `tier3/${task}/oracle.1.log`, 'probe\nORACLE PASS\n');
}
// a clean tier-2 row whose current manifest touches `p`
function row2(d, t, p = 'src/app.txt', att = '1') {
  ledger(d, [[t, '2', 'tests', att]]); manifest(d, t, att, [p]); pass(d, t, att, 'checker-tests', 'anthropic');
}
function gate(dir, task, env = {}) {
  const r = spawnSync('bash', [GATE, 'check', task], {
    env: { ...process.env, SWARM_DIR: dir, SWARM_TREE: path.join(dir, 'tree'), ...env }, encoding: 'utf8', timeout: 30000 });
  if (r.error) throw new Error(`gate did not finish: ${r.error.message}`);
  if (r.status !== 0 && r.status !== 1) throw new Error(`gate exit ${r.status}: ${r.stdout}${r.stderr}`);
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}

// [name, setup -> task, expected, reasonToken|null]
const U = 'critical-glob-unreadable';
const S = [
  ['U1 critical.globs unreadable (mode 000)', (d) => { row2(d, 'u1'); w(d, 'critical.globs', 'swarm/**\n', 0o000); return 'u1'; }, 'reject', U],
  ['U2 critical.globs not valid UTF-8', (d) => { row2(d, 'u2'); w(d, 'critical.globs', BAD_UTF8); return 'u2'; }, 'reject', U],
  ['U3 critical.globs is a directory', (d) => { row2(d, 'u3'); fs.mkdirSync(path.join(d, 'critical.globs')); return 'u3'; }, 'reject', U],
  ['U4 test.globs unreadable, path matches no critical glob', (d) => { row2(d, 'u4'); w(d, 'critical.globs', 'swarm/**\n'); w(d, 'test.globs', 'x\n', 0o000); return 'u4'; }, 'reject', U],
  ['U5 test.globs not valid UTF-8', (d) => { row2(d, 'u5'); w(d, 'critical.globs', 'swarm/**\n'); w(d, 'test.globs', BAD_UTF8); return 'u5'; }, 'reject', U],
  ['U6 test.globs is a directory', (d) => { row2(d, 'u6'); w(d, 'critical.globs', 'swarm/**\n'); fs.mkdirSync(path.join(d, 'test.globs')); return 'u6'; }, 'reject', U],
  ['U7 an OLDER attempt manifest unreadable', (d) => { row2(d, 'u7', 'src/app.txt', '2'); w(d, 'critical.globs', 'swarm/**\n'); w(d, 'manifests/u7.1.files', 'src/app.txt\n', 0o000); return 'u7'; }, 'reject', U],
  ['U8 an OLDER attempt manifest not valid UTF-8', (d) => { row2(d, 'u8', 'src/app.txt', '2'); w(d, 'critical.globs', 'swarm/**\n'); w(d, 'manifests/u8.1.files', BAD_UTF8); return 'u8'; }, 'reject', U],
  ['U9 a directory matching <task>.*.files', (d) => { row2(d, 'u9'); w(d, 'critical.globs', 'swarm/**\n'); fs.mkdirSync(path.join(d, 'manifests', 'u9.0.files')); return 'u9'; }, 'reject', U],
  ['U10 control: tier 3 is never blocked inline, even unreadable', (d) => {
    ledger(d, [['u10', '3', 'tests,second']]); manifest(d, 'u10', 1, ['src/app.txt']);
    pass(d, 'u10', 1, 'checker-tests', 'anthropic'); pass(d, 'u10', 1, 'checker-second', 'adversarial'); oracle3(d, 'u10');
    w(d, 'critical.globs', 'swarm/**\n', 0o000); return 'u10';
  }, 'accept', null],
  ['U11 control: readable inputs, no match', (d) => { row2(d, 'u11'); w(d, 'critical.globs', 'swarm/**\n'); w(d, 'test.globs', 'nomatch\n'); return 'u11'; }, 'accept', null],
  ['U12 control: no critical.globs at all', (d) => { row2(d, 'u12'); return 'u12'; }, 'accept', null],
  ['U13 control: CRLF + BOM but valid UTF-8, no match', (d) => { row2(d, 'u13'); w(d, 'critical.globs', Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('swarm/**\r\n')])); return 'u13'; }, 'accept', null],
  ['U14 a real hit keeps the plain critical-glob reason', (d) => { row2(d, 'u14', 'swarm/x.sh'); w(d, 'critical.globs', 'swarm/**\n'); return 'u14'; }, 'reject', 'critical-glob'],
  // census CD3.1 G1/G2/G5/G6/G10/G12
  ['U15 tier 1: unreadable critical.globs is refused inline', (d) => {
    ledger(d, [['u15', '1', 'tests']]); manifest(d, 'u15', 1, ['src/app.txt']); pass(d, 'u15', 1, 'checker-tests', 'anthropic');
    w(d, 'critical.globs', 'swarm/**\n', 0o000); return 'u15'; }, 'reject', U],
  ['U16 the CURRENT manifest unreadable: refused, and parse() does not throw', (d) => {
    row2(d, 'u16'); w(d, 'critical.globs', 'swarm/**\n'); fs.chmodSync(path.join(d, 'manifests/u16.1.files'), 0o000); return 'u16'; }, 'reject', U],
  ['U17 the CURRENT sidecar is a directory: refused, parse() does not throw', (d) => {
    row2(d, 'u17'); fs.rmSync(path.join(d, 'manifests/u17.1.sha256')); fs.mkdirSync(path.join(d, 'manifests/u17.1.sha256')); return 'u17'; }, 'reject', null],
  ['U18 tier 3: CURRENT manifest is a directory: refused, parse() does not throw', (d) => {
    ledger(d, [['u18', '3', 'tests,second']]); manifest(d, 'u18', 1, ['src/app.txt']);
    pass(d, 'u18', 1, 'checker-tests', 'anthropic'); pass(d, 'u18', 1, 'checker-second', 'adversarial'); oracle3(d, 'u18');
    fs.rmSync(path.join(d, 'manifests/u18.1.files')); fs.mkdirSync(path.join(d, 'manifests/u18.1.files')); return 'u18'; }, 'reject', null],
  ['U19 critical.globs is a dangling symlink', (d) => { row2(d, 'u19'); fs.symlinkSync('nowhere.globs', path.join(d, 'critical.globs')); return 'u19'; }, 'reject', U],
  ['U20 test.globs is a FIFO (must not block)', (d) => {
    row2(d, 'u20'); w(d, 'critical.globs', 'swarm/**\n'); spawnSync('mkfifo', [path.join(d, 'test.globs')]); return 'u20'; }, 'reject', U],
  ['U21 unreadable beats a real hit', (d) => {
    row2(d, 'u21', 'swarm/x.sh', '2'); w(d, 'critical.globs', 'swarm/**\n'); w(d, 'manifests/u21.1.files', BAD_UTF8); return 'u21'; }, 'reject', U],
  ['U23 control: a symlink to a readable critical.globs, no match', (d) => {
    row2(d, 'u23'); w(d, 'real.globs', 'swarm/**\n'); fs.symlinkSync('real.globs', path.join(d, 'critical.globs')); return 'u23'; }, 'accept', null],
  ['U24 control: an empty critical.globs', (d) => { row2(d, 'u24'); w(d, 'critical.globs', ''); return 'u24'; }, 'accept', null],
  ['U25 control: valid UTF-8 non-ASCII manifest under LC_ALL=C', (d) => {
    row2(d, 'u25', 'docs/café.md'); w(d, 'critical.globs', 'swarm/**\n'); return 'u25'; }, 'accept', null, { LC_ALL: 'C', LANG: 'C', PYTHONUTF8: '0' }],
  ['U26 dot-prefix sibling with an unreadable manifest (agreement only)', (d) => {
    ledger(d, [['k', '2', 'tests'], ['k.1.x', '2', 'tests']]); manifest(d, 'k', 1, ['src/k.txt']); pass(d, 'k', 1, 'checker-tests', 'anthropic');
    w(d, 'critical.globs', 'swarm/**\n'); w(d, 'manifests/k.1.x.1.files', BAD_UTF8); return 'k'; }, null, null],
];
const CLEAN = new Set(['U11', 'U12', 'U13', 'U23', 'U24', 'U25']);

function restore(d) {                       // make everything deletable again
  spawnSync('chmod', ['-R', 'u+rwX', d]);
}
for (const [name, setup, expect, reason, env] of S) {
  const d = fs.mkdtempSync(path.join(ROOT, 'fx-'));
  let task, g, st;
  try { task = setup(d); g = gate(d, task, env ?? {}); }
  catch (e) { bad(`${name}: gate harness error: ${e.message}`); restore(d); continue; }
  try { st = parse(d); }
  catch (e) { bad(`${name}: parse() THREW: ${e.message}`); restore(d); continue; }
  restore(d);
  const t = st.tasks.find((x) => x.id === task);
  if (!t) { bad(`${name}: task missing from parse()`); continue; }
  const dashOk = t.derived.state === 'accepted';
  if (dashOk !== g.ok) { bad(`${name}: gate ${g.ok ? 'accepts' : 'rejects'} but dashboard '${t.derived.state}' (gate: ${g.out})`); continue; }
  if (expect && (expect === 'accept') !== g.ok) { bad(`${name}: both ${g.ok ? 'accept' : 'reject'}, expected ${expect} (gate: ${g.out})`); continue; }
  if (CLEAN.has(name.split(' ')[0]) && /unreadable/i.test(g.err)) { bad(`${name}: stderr says unreadable on clean inputs: ${g.err}`); continue; }
  if (reason) {
    const msgs = (st.errors ?? []).map((e) => e.message).filter((m) => m.includes(`task ${task}:`)).join(' | ');
    const exact = reason === U ? (s) => s.includes(U) : (s) => s.includes('critical-glob') && !s.includes(U);
    if (!exact(g.out)) { bad(`${name}: the FAIL line (stdout) should carry '${reason}': ${g.out}`); continue; }
    if (reason === U && (g.err.split('\n').filter((l) => /unreadable/i.test(l)).length !== 1)) { bad(`${name}: want exactly one 'unreadable' stderr line, got: ${g.err}`); continue; }
    if (!exact(msgs)) { bad(`${name}: dashboard mismatch reason should be '${reason}': ${msgs}`); continue; }
  }
  ok(`${name} (gate ${g.ok ? 'accepts' : 'rejects'}, dashboard '${t.derived.state}')`);
}
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(`differential: ${S.length - nfail}/${S.length} ok`);
process.exit(nfail ? 1 : 0);
