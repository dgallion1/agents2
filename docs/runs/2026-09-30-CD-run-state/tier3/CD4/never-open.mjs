// CD4 oracle helper (attempt 3, CD-z/CD-aa). Usage: node never-open.mjs <TREE>
// For each non-regular verdict-entry kind, runs parse() in a CHILD whose
// fs.openSync / fs.readFileSync are instrumented BEFORE parse.mjs is imported,
// and counts calls whose path argument is that entry. Prints one line per kind
// and exits 1 if any count is non-zero, the child hangs/throws, or the row is
// not blocked. Exit 0 = parse() never opened a non-regular entry.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const TREE = path.resolve(process.argv[2] ?? '.');
const PARSE_URL = pathToFileURL(path.join(TREE, 'dashboard', 'lib', 'parse.mjs')).href;
const ROOT = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'cd4-never-open-'));
let bad = 0;

const KINDS = {
  fifo: (p) => spawnSync('mkfifo', [p]),
  directory: (p) => fs.mkdirSync(p),
  dangling: (p) => fs.symlinkSync('nothere', p),
  loop: (p) => fs.symlinkSync(path.basename(p), p),
  'symlink-to-fifo': (p) => { spawnSync('mkfifo', [p + '.target']); fs.symlinkSync(path.basename(p) + '.target', p); },
  'symlink-to-dir': (p) => { fs.mkdirSync(p + '.dir'); fs.symlinkSync(path.basename(p) + '.dir', p); },
  'symlink-to-device': (p) => fs.symlinkSync('/dev/null', p),
};
// Both entries parse() reads per row: a verdict entry, and (codex named) the skip record.
const ENTRIES = {
  verdict: { checks: 'tests', file: 'x.1.checker-tests.verdict' },
  skip: { checks: 'tests,codex', file: 'x.1.checker-codex.skip' },
};

for (const [ename, E] of Object.entries(ENTRIES)) for (const [kind0, make] of Object.entries(KINDS)) {
  const kind = `${ename}/${kind0}`;
  const d = fs.mkdtempSync(path.join(ROOT, `${ename}-${kind0}-`));
  fs.mkdirSync(path.join(d, 'verdicts'));
  fs.writeFileSync(path.join(d, 'ledger.tsv'), `# h\nx\t2\t${E.checks}\taccepted\t1\tw\tr\n`);
  const entry = path.join(d, 'verdicts', E.file);
  make(entry);
  const code = `
    const fs = require('node:fs');
    const ENTRY = ${JSON.stringify(entry)};
    let n = 0;
    const hit = (p) => { try { if (typeof p === 'string' || p instanceof URL || Buffer.isBuffer(p)) { if (String(p) === ENTRY) n += 1; } } catch {} };
    const o = fs.openSync, r = fs.readFileSync;
    fs.openSync = function (p, ...a) { hit(p); return o.call(fs, p, ...a); };
    fs.readFileSync = function (p, ...a) { hit(p); return r.call(fs, p, ...a); };
    require('node:module').syncBuiltinESMExports();
    import(${JSON.stringify(PARSE_URL)}).then((m) => {
      const s = m.parse(${JSON.stringify(d)});
      process.stdout.write(JSON.stringify({ n, state: s.tasks[0] && s.tasks[0].derived.state }));
    }).catch((e) => process.stdout.write(JSON.stringify({ threw: String((e && e.message) || e) })));`;
  const res = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', timeout: 20000 });
  let out;
  if (res.error || res.signal) out = { hung: true };
  else { try { out = JSON.parse(res.stdout); } catch { out = { threw: `unparseable: ${res.stdout} ${res.stderr}`.slice(0, 300) }; } }
  const okRow = !out.hung && !out.threw && out.n === 0 && out.state !== 'accepted';
  console.log(`${okRow ? 'ok  ' : 'FAIL'} ${kind}: opens=${out.n ?? '-'} state=${out.state ?? '-'}${out.hung ? ' HUNG' : ''}${out.threw ? ' THREW ' + out.threw : ''}`);
  if (!okRow) bad += 1;
}
fs.rmSync(ROOT, { recursive: true, force: true });
console.log(bad === 0 ? 'never-open: 0 opens of any non-regular entry' : `never-open: ${bad} kind(s) failed`);
process.exit(bad === 0 ? 0 : 1);
