// WS5 probe: glide path (D6) and person rows (D7) in real Chromium against an
// isolated server. usage: node probe.js <base> <saved-whatif.json>
const { chromium } = require('playwright');
const fs = require('fs');
const [base, savedPath] = process.argv.slice(2);
const saved = () => JSON.parse(fs.readFileSync(savedPath, 'utf8'));
const out = [];
const check = (ok, msg) => out.push(`${ok ? 'PASS' : 'FAIL'} ${msg}`);
let inflight = 0, last = Date.now();
async function settle(page) { const d = Date.now() + 60000; while (Date.now() < d) { if (inflight === 0 && Date.now() - last > 800) return; await page.waitForTimeout(100); } }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('request', () => { inflight++; last = Date.now(); });
  const done = () => { inflight = Math.max(0, inflight - 1); last = Date.now(); };
  page.on('requestfinished', done); page.on('requestfailed', done);
  const posts = [];
  page.on('request', r => { if (r.method() !== 'GET') posts.push(new URL(r.url()).pathname); });
  const load = async () => { await page.goto(base + '/whatif', { waitUntil: 'domcontentloaded' }); await settle(page); posts.length = 0; };
  // Build a /whatif/settings persons payload from the saved plan (the same
  // fields the Rate Assumptions form posts for persons), plus extra rows.
  const personsForm = (extra = []) => {
    const s = saved(); const f = new URLSearchParams();
    f.set('start_date', s.start_date);
    for (const p of s.persons.concat(extra)) {
      f.append('person_id[]', p.id || ''); f.append('person_name[]', p.name);
      f.append('person_birth_month[]', p.birth_month || ''); f.append('person_role[]', p.role || 'other');
    }
    return f.toString();
  };
  const post = async (path, body) => {
    const r = await page.request.post(base + path, { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'HX-Request': 'true' }, data: body });
    return { status: r.status(), text: (await r.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() };
  };
  try {
    const glide0 = JSON.stringify(saved().glide_path);
    // G1 — a tick only reveals the fields; nothing is sent or saved.
    await load();
    await page.locator('form[hx-post="/whatif/glide-path"] input[name="enabled"]').check();
    await page.waitForTimeout(1500); await settle(page);
    check(!posts.includes('/whatif/glide-path'), `G1 D6: ticking the glide box sends no request (posts ${JSON.stringify(posts)})`);
    check(JSON.stringify(saved().glide_path) === glide0, `G1 D6: the leftover glide config is untouched (${JSON.stringify(saved().glide_path)})`);
    const req = await page.evaluate(() => ['glide-start-stock-pct', 'glide-end-stock-pct', 'glide-transition-years'].map(id => { const e = document.getElementById(id); return e && e.required && !e.disabled && !!e.offsetParent; }));
    check(req.every(Boolean), `G1 a11y: the revealed fields are visible and required (${JSON.stringify(req)})`);
    const instr = await page.evaluate(() => /required/i.test((document.getElementById('glide-path-fields') || {}).innerText || ''));
    check(instr, 'G1 a11y: a visible instruction says the fields are required');
    // G2 — the server refuses an enable with any single field missing.
    for (const [name, body] of [['start', 'enabled=on&start_stock_pct=&end_stock_pct=40&transition_years=10'],
                                ['end', 'enabled=on&start_stock_pct=60&end_stock_pct=&transition_years=10'],
                                ['years', 'enabled=on&start_stock_pct=60&end_stock_pct=40&transition_years=']]) {
      const r = await post('/whatif/glide-path', body);
      check(r.status === 400 && JSON.stringify(saved().glide_path) === glide0, `G2 D6: enable with only ${name} missing → 400, nothing saved (status ${r.status}, glide ${JSON.stringify(saved().glide_path)})`);
    }
    // G3 — Apply with all three saves.
    await page.fill('#glide-start-stock-pct', '60'); await page.fill('#glide-end-stock-pct', '40'); await page.fill('#glide-transition-years', '10');
    posts.length = 0;
    await page.locator('form[hx-post="/whatif/glide-path"] [type="submit"]').click();
    await page.waitForTimeout(800); await settle(page);
    const g3 = saved().glide_path;
    check(g3 && g3.enabled === true && g3.start_stock_pct === 60 && g3.end_stock_pct === 40 && g3.transition_years === 10, `G3 D6: Apply with all three saves (${JSON.stringify(g3)})`);
    // G4 — untick saves enabled=false, even with the fields emptied.
    await load();
    await page.fill('#glide-start-stock-pct', '').catch(() => {});
    await page.locator('form[hx-post="/whatif/glide-path"] input[name="enabled"]').uncheck();
    await page.waitForTimeout(1500); await settle(page);
    check(posts.includes('/whatif/glide-path') && saved().glide_path && saved().glide_path.enabled === false, `G4 D6: unticking saves enabled=false (posts ${JSON.stringify(posts)}, glide ${JSON.stringify(saved().glide_path)})`);

    // P1 — removing an unlinked person persists.
    await load();
    const p1 = page.waitForResponse(r => new URL(r.url()).pathname === '/whatif/settings' && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
    await page.evaluate(() => { const row = [...document.querySelectorAll('[data-person-row]')].find(r => [...r.querySelectorAll('input')].some(i => i.value === 'Pat Unlinked')); row.querySelector('[data-remove-person-row]').click(); });
    const r1 = await p1; await settle(page);
    check(r1 && r1.status() === 200 && !saved().persons.some(p => p.name === 'Pat Unlinked'), `P1 D7: removing an unlinked person saves (status ${r1 && r1.status()}, persons ${saved().persons.map(p => p.name)})`);
    await load();
    check(!(await page.evaluate(() => [...document.querySelectorAll('[data-person-row] input')].some(i => i.value === 'Pat Unlinked'))), 'P1 D7: the removed person is gone after reload');
    // P2 — removing a person linked from a healthcare entry is refused.
    const spouse = saved().persons.find(p => p.role === 'spouse');
    const before = JSON.stringify(saved().persons);
    const p2 = page.waitForResponse(r => new URL(r.url()).pathname === '/whatif/settings' && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
    await page.evaluate((name) => { const row = [...document.querySelectorAll('[data-person-row]')].find(r => [...r.querySelectorAll('input')].some(i => i.value === name)); row.querySelector('[data-remove-person-row]').click(); }, spouse.name);
    const r2 = await p2; await page.waitForTimeout(500); await settle(page);
    const refusal = await page.evaluate((name) => [...document.querySelectorAll('[role="alert"]')].map(e => e.textContent.replace(/\s+/g, ' ').trim()).find(t => /healthcare/i.test(t) && t.includes(name)) || null, spouse.name);
    const rowBack = await page.evaluate((name) => [...document.querySelectorAll('[data-person-row] input')].some(i => i.value === name), spouse.name);
    check(r2 && r2.status() === 400, `P2 D7: a linked removal is refused with 400, never 500 (status ${r2 && r2.status()})`);
    check(!!refusal && rowBack && JSON.stringify(saved().persons) === before, `P2 D7: the refusal names the entry, the row stays, nothing saved (alert ${JSON.stringify(refusal)}, row ${rowBack})`);
    // P3 — new rows.
    await load();
    await page.click('#add-person-row-btn'); await page.waitForTimeout(200);
    const newName = page.locator('[data-person-row] input[name="person_name[]"]').last();
    await newName.fill('New Kid'); await newName.blur();
    await page.waitForTimeout(1500); await settle(page);
    check(!posts.includes('/whatif/settings'), `P3 D7: a name-only new row sends no request (posts ${JSON.stringify(posts)})`);
    const p3b = await post('/whatif/settings', personsForm([{ id: '', name: 'New Kid', birth_month: '', role: 'other' }]));
    check(p3b.status === 400 && /birth/i.test(p3b.text), `P3 D7: a birth-month-less row posted directly → 400 naming the birth month (status ${p3b.status}, ${JSON.stringify(p3b.text.slice(0, 120))})`);
    const p3c = await post('/whatif/settings', personsForm([{ id: '', name: 'Future Kid', birth_month: '2030-01', role: 'other' }]));
    check(p3c.status === 400 && !/needs a birth month/i.test(p3c.text) && /(after|start)/i.test(p3c.text), `P3 D7: a birth month after the start date → 400 with an accurate message (status ${p3c.status}, ${JSON.stringify(p3c.text.slice(0, 140))})`);
    // P3d (v2, WS5.3 primary): a birth month that is PRESENT but unparseable
    // must not be reported as missing, and must name the person.
    const p3d = await post('/whatif/settings', personsForm([{ id: '', name: 'Typo Kid', birth_month: '19711-08', role: 'other' }]));
    check(p3d.status === 400 && !/needs a birth month/i.test(p3d.text) && /Typo Kid/.test(p3d.text),
          `P3 D7: a present-but-unparseable birth month → 400 naming the person, not "needs a birth month" (status ${p3d.status}, ${JSON.stringify(p3d.text.slice(0, 140))})`);
    // P3e (v2): an invalid projection start date is reported as a start-date problem.
    const bad = new URLSearchParams(personsForm()); bad.set('start_date', '2026-13');
    const p3e = await post('/whatif/settings', bad.toString());
    check(p3e.status === 400 && /start date/i.test(p3e.text) && !/invalid person data/i.test(p3e.text),
          `P3 D7: an invalid start date → 400 described as a start-date problem (status ${p3e.status}, ${JSON.stringify(p3e.text.slice(0, 140))})`);
  } catch (e) { out.push('FAIL probe error: ' + String(e && e.stack || e).slice(0, 400)); }
  await browser.close();
  console.log(out.join('\n'));
  process.exit(out.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
