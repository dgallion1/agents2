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
const PARSE_URL = pathToFileURL(path.join(TREE, 'dashboard', 'lib', 'parse.mjs')).href;
// parse() runs in a CHILD with a timeout (CD4.2): a hang or a throw fails that
// scenario only, instead of stalling the whole battery.
function parseChild(dir) {
  const code = `import(${JSON.stringify(PARSE_URL)}).then((m) => { const s = m.parse(${JSON.stringify(dir)});`
    + ` process.stdout.write(JSON.stringify({ tasks: s.tasks.map((t) => ({ id: t.id, derived: t.derived })), errors: s.errors })); })`
    + `.catch((e) => { process.stdout.write(JSON.stringify({ threw: String((e && e.message) || e) })); });`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 20000 });
  if (r.error || r.signal) return { hung: true };
  try { return JSON.parse(r.stdout); } catch { return { threw: `unparseable child output: ${r.stdout.slice(0, 200)} ${r.stderr.slice(0, 200)}` }; }
}
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
// The gate's answer must not depend on the caller's locale (CD4.2 item 1):
// every scenario runs it under all three; any split is reported as such.
const LOCALES = ['C', 'C.UTF-8', 'en_US.UTF-8'];
function gate1(dir, task, loc) {
  const r = spawnSync('bash', [GATE, 'check', task], {
    env: { ...process.env, LC_ALL: loc, LANG: loc, SWARM_DIR: dir, SWARM_TREE: path.join(dir, 'tree') }, encoding: 'utf8', timeout: 30000 });
  if (r.error) throw new Error(r.error.message);
  if (r.status !== 0 && r.status !== 1) throw new Error(`gate exit ${r.status}: ${r.stdout}${r.stderr}`);
  return { ok: r.status === 0, out: (r.stdout + r.stderr).trim() };
}
function gate(dir, task) {
  const rs = LOCALES.map((loc) => gate1(dir, task, loc));
  if (new Set(rs.map((r) => r.ok)).size > 1) {
    return { ok: null, out: 'LOCALE SPLIT: ' + rs.map((r, i) => `${LOCALES[i]}=${r.ok ? 'accept' : 'reject'}`).join(' ') + ' :: ' + rs[2].out };
  }
  return rs[2];
}
function gateDone(dir) {
  const r = spawnSync('bash', [GATE, 'done'], {
    env: { ...process.env, SWARM_DIR: dir, SWARM_TREE: path.join(dir, 'tree') }, encoding: 'utf8', timeout: 30000 });
  if (r.error) throw new Error(r.error.message);
  return r.status === 0;
}

const EMSP = String.fromCodePoint(0x2003), NBSP = String.fromCodePoint(0xa0), IDSP = String.fromCodePoint(0x3000);
const rawskip = (d, t, a, text) => w(d, `verdicts/${t}.${a}.checker-codex.skip`, Buffer.from(text, 'utf8'));
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
  // CD4.2 item 1: only LEADING ASCII whitespace is stripped from a skip header, under every locale
  ['X37 DETAIL:<U+2003> is a non-empty DETAIL (valid skip)', (d) => { base(d, 'x37', '2', 'tests,codex'); rawskip(d, 'x37', 1, `REASON: quota\nDETAIL:${EMSP}\nTASK: x37\nATTEMPT: 1\n`); return 'x37'; }, 'accept'],
  ['X38 REASON:<U+2003>quota is no known reason', (d) => { base(d, 'x38', '2', 'tests,codex'); rawskip(d, 'x38', 1, `REASON:${EMSP}quota\nDETAIL: probe\nTASK: x38\nATTEMPT: 1\n`); return 'x38'; }, 'reject', E],
  ['X39 TASK:<U+2003>x39 does not match the filename', (d) => { base(d, 'x39', '2', 'tests,codex'); rawskip(d, 'x39', 1, `REASON: quota\nDETAIL: probe\nTASK:${EMSP}x39\nATTEMPT: 1\n`); return 'x39'; }, 'reject', E],
  ['X40 DETAIL: <U+00A0> (NBSP after a space) is non-empty (valid skip)', (d) => { base(d, 'x40', '2', 'tests,codex'); rawskip(d, 'x40', 1, `REASON: quota\nDETAIL: ${NBSP}\nTASK: x40\nATTEMPT: 1\n`); return 'x40'; }, 'accept'],
  ['X40b REASON:<U+3000>auth, tier 1 named', (d) => { base(d, 'x40b', '1', 'tests,codex'); rawskip(d, 'x40b', 1, `REASON:${IDSP}auth\nDETAIL: probe\nTASK: x40b\nATTEMPT: 1\n`); return 'x40b'; }, 'reject', E],
  // CD4.2 item 2: tier 1 named — a non-regular or invalid verdict entry refuses the row even beside a valid skip
  ['X41 tier 1 named: a DANGLING-symlink Codex verdict beside a valid skip', (d) => { base(d, 'x41', '1', 'tests,codex'); skip(d, 'x41', 1, 'quota'); fs.symlinkSync('nothere', path.join(d, 'verdicts/x41.1.checker-codex.verdict')); return 'x41'; }, 'reject', 'invalid verdict checker-codex'],
  ['X42 tier 1 named: a DIRECTORY named as the Codex verdict beside a valid skip', (d) => { base(d, 'x42', '1', 'tests,codex'); skip(d, 'x42', 1, 'quota'); fs.mkdirSync(path.join(d, 'verdicts/x42.1.checker-codex.verdict')); return 'x42'; }, 'reject', 'invalid verdict checker-codex'],
  ['X43 tier 1 named: an INVALID Codex verdict (no ---) beside a valid skip', (d) => { base(d, 'x43', '1', 'tests,codex'); skip(d, 'x43', 1, 'quota'); w(d, 'verdicts/x43.1.checker-codex.verdict', 'VERDICT: PASS\nCHECKER: checker-codex\nFAMILY: crossvendor\nTASK: x43\nATTEMPT: 1\n'); return 'x43'; }, 'reject', 'invalid verdict checker-codex'],
  ['X44 tier 1 named: a FIFO named as the Codex verdict (never opened, no hang)', (d) => { base(d, 'x44', '1', 'tests,codex'); skip(d, 'x44', 1, 'quota'); spawnSync('mkfifo', [path.join(d, 'verdicts/x44.1.checker-codex.verdict')]); return 'x44'; }, 'reject', 'invalid verdict checker-codex'],
  ['X44b tier 1 NOT named: a dangling Codex verdict entry is ignored', (d) => { base(d, 'x44b', '1', 'tests'); fs.symlinkSync('nothere', path.join(d, 'verdicts/x44b.1.checker-codex.verdict')); return 'x44b'; }, 'accept'],
  // the NUL rule (attempt-1 addition, pinned by CD4.2): a NUL byte ANYWHERE makes a skip record invalid
  ['X45 a NUL inside DETAIL', (d) => { base(d, 'x45', '2', 'tests,codex'); rawskip(d, 'x45', 1, 'REASON: quota\nDETAIL: pro\u0000be\nTASK: x45\nATTEMPT: 1\n'); return 'x45'; }, 'reject', E],
  ['X46 a NUL on a line that is no header', (d) => { base(d, 'x46', '2', 'tests,codex'); rawskip(d, 'x46', 1, 'REASON: quota\nDETAIL: probe\nTASK: x46\nATTEMPT: 1\nnote: a\u0000b\n'); return 'x46'; }, 'reject', E],
  // census CD4.2: more header shapes (leading \v stripped, trailing never, ATTEMPT too)
  ['X37b DETAIL:<VT> strips to empty (invalid)', (d) => { base(d, 'x37b', '2', 'tests,codex'); rawskip(d, 'x37b', 1, 'REASON: quota\nDETAIL:\u000b\nTASK: x37b\nATTEMPT: 1\n'); return 'x37b'; }, 'reject', E],
  ['X38b REASON: quota<U+2003> (trailing, never stripped)', (d) => { base(d, 'x38b', '2', 'tests,codex'); rawskip(d, 'x38b', 1, `REASON: quota${EMSP}\nDETAIL: probe\nTASK: x38b\nATTEMPT: 1\n`); return 'x38b'; }, 'reject', E],
  ['X39b ATTEMPT:<U+2003>1', (d) => { base(d, 'x39b', '2', 'tests,codex'); rawskip(d, 'x39b', 1, `REASON: quota\nDETAIL: probe\nTASK: x39b\nATTEMPT:${EMSP}1\n`); return 'x39b'; }, 'reject', E],
  // census CD4.2: more non-regular / unreadable Codex verdict entries (tier 1 named, and tiers 2/3)
  ['X41b tier 1 named: a dangling-symlink Codex verdict and NO skip', (d) => { base(d, 'x41b', '1', 'tests,codex'); fs.symlinkSync('nothere', path.join(d, 'verdicts/x41b.1.checker-codex.verdict')); return 'x41b'; }, 'reject', 'invalid verdict checker-codex'],
  ['X42b tier 1 named: a symlink-LOOP Codex verdict beside a valid skip', (d) => { base(d, 'x42b', '1', 'tests,codex'); skip(d, 'x42b', 1, 'quota'); fs.symlinkSync('x42b.1.checker-codex.verdict', path.join(d, 'verdicts/x42b.1.checker-codex.verdict')); return 'x42b'; }, 'reject', 'invalid verdict checker-codex'],
  ['X43b tier 1 named: a MODE-000 Codex verdict beside a valid skip', (d) => { base(d, 'x43b', '1', 'tests,codex'); skip(d, 'x43b', 1, 'quota'); codex(d, 'x43b', 1, 'PASS'); fs.chmodSync(path.join(d, 'verdicts/x43b.1.checker-codex.verdict'), 0o000); return 'x43b'; }, 'reject', 'invalid verdict checker-codex'],
  ['X42c tier 2 named: a DIRECTORY named as the Codex verdict', (d) => { base(d, 'x42c', '2', 'tests,second,codex'); fs.mkdirSync(path.join(d, 'verdicts/x42c.1.checker-codex.verdict')); return 'x42c'; }, 'reject', 'invalid verdict'],
  ['X44c tier 3 NOT named: a FIFO named as the Codex verdict', (d) => { base(d, 'x44c', '3', 'tests,second'); spawnSync('mkfifo', [path.join(d, 'verdicts/x44c.1.checker-codex.verdict')]); return 'x44c'; }, 'reject', 'invalid verdict'],
  // census CD4.2: parse() must never throw or hang on ANY non-regular *.verdict entry
  ['X47 tier 2: a DIRECTORY named as another checker\'s verdict', (d) => { base(d, 'x47', '2', 'tests,second'); fs.mkdirSync(path.join(d, 'verdicts/x47.1.checker-other.verdict')); return 'x47'; }, 'reject', 'invalid verdict'],
  ['X48 tier 2: a FIFO named as another checker\'s verdict', (d) => { base(d, 'x48', '2', 'tests,second'); spawnSync('mkfifo', [path.join(d, 'verdicts/x48.1.checker-other.verdict')]); return 'x48'; }, 'reject', 'invalid verdict'],
  ['X49 tier 2: a MODE-000 regular file named as another checker\'s verdict', (d) => { base(d, 'x49', '2', 'tests,second'); v(d, 'x49', 1, 'checker-other', 'anthropic', 'PASS'); fs.chmodSync(path.join(d, 'verdicts/x49.1.checker-other.verdict'), 0o000); return 'x49'; }, 'reject', 'invalid verdict'],
];
for (const [name, setup, expect, frag, idValid = true, codexPass = false] of S) {
  const d = fs.mkdtempSync(path.join(ROOT, 'fx-'));
  let task, g, st;
  try { task = setup(d); g = gate(d, task); } catch (e) { bad(`${name}: gate harness error: ${e.message}`); continue; }
  if (g.ok === null) { bad(`${name}: the gate's answer depends on the locale: ${g.out}`); continue; }
  st = parseChild(d);
  if (st.hung) { bad(`${name}: parse() HUNG (killed after 20 s)`); continue; }
  if (st.threw) { bad(`${name}: parse() THREW: ${st.threw}`); continue; }
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
