// WS4 probe: drive every error path of the /whatif page in real Chromium and
// emit one PASS/FAIL line per observation. usage: node probe.js <base> <saved-whatif.json> <scenario>
//   scenario = background   (fresh server: loader/poll/trajectory failures)
//            = forms        (add rejections, edit rejection, dedupe, validity, text/plain)
const { chromium } = require('playwright');
const fs = require('fs');

const [base, savedPath, scenario] = process.argv.slice(2);
const results = [];
const check = (ok, msg) => results.push(`${ok ? 'PASS' : 'FAIL'} [${scenario}] ${msg}`);

let inflight = 0, lastActivity = Date.now();
async function settle(page, quietMs = 800) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (inflight === 0 && Date.now() - lastActivity >= quietMs) return;
    await page.waitForTimeout(100);
  }
  throw new Error('network never went quiet');
}
const ERRBODY = msg => `<div class="p-4"><p>${msg}</p></div>`;

// Every visible element carrying an alert/status role, with nesting info.
const ALERTS = () => [...document.querySelectorAll('[role="alert"],[role="status"]')]
  .filter(e => (e.textContent || '').trim() !== '')
  .map(e => ({ text: e.textContent.replace(/\s+/g, ' ').trim().slice(0, 160),
               nested: !!(e.parentElement && e.parentElement.closest('[role="alert"],[role="status"]')),
               inResults: !!e.closest('#whatif-results') }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  page.on('request', () => { inflight++; lastActivity = Date.now(); });
  const done = () => { inflight = Math.max(0, inflight - 1); lastActivity = Date.now(); };
  page.on('requestfinished', done); page.on('requestfailed', done);
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.addInitScript(() => {
    window.__rv = 0;
    for (const P of [HTMLFormElement.prototype, HTMLInputElement.prototype]) {
      const orig = P.reportValidity;
      P.reportValidity = function () { window.__rv++; return orig.call(this); };
    }
  });
  try {
    if (scenario === 'background') {
      // Requests no user initiated: the async results loader, the 2 s poll
      // sentinel and a body-sourced htmx.ajax. Their failures must insert nothing.
      const MSG = 'oracle background failure';
      for (const pat of ['**/whatif/results-full*', '**/whatif/poll*', '**/whatif/spending-trajectory*']) {
        await page.route(pat, r => r.fulfill({ status: 500, contentType: 'text/html', body: ERRBODY(MSG) }));
      }
      await page.goto(base + '/whatif', { waitUntil: 'domcontentloaded' });
      const loaderPresent = await page.evaluate(() => !!document.getElementById('whatif-async-loader'));
      check(loaderPresent, `harness precondition: cold load has the async results loader (${loaderPresent})`);
      const gridBefore = await page.evaluate(() => [...document.getElementById('whatif-results').parentElement.children].map(c => c.id || c.className.slice(0, 30)));
      await page.evaluate(() => window.htmx && htmx.ajax('GET', '/whatif/spending-trajectory', { target: '#phase-preview-body', swap: 'innerHTML' }));
      await page.waitForTimeout(5500); // at least two poll cycles
      const st = await page.evaluate((MSG) => ({
        grid: [...document.getElementById('whatif-results').parentElement.children].map(c => c.id || c.className.slice(0, 30)),
        htmlFirst: document.documentElement.firstElementChild.tagName,
        bodyChildrenWithMsg: [...document.body.children].filter(c => (c.textContent || '').includes(MSG)).length,
        anyMsgOutsideTargets: [...document.querySelectorAll('*')].filter(e => e.children.length === 0 && (e.textContent || '').includes(MSG) && !e.closest('#phase-preview-body')).length,
      }), MSG);
      check(JSON.stringify(st.grid) === JSON.stringify(gridBefore), `R2: page layout grid unchanged by background failures (${JSON.stringify(gridBefore)} -> ${JSON.stringify(st.grid)})`);
      check(st.htmlFirst === 'HEAD', `R2: nothing inserted before <head> (first child ${st.htmlFirst})`);
      check(st.anyMsgOutsideTargets === 0, `R2: no background-failure message inserted anywhere (found ${st.anyMsgOutsideTargets})`);
      check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2)})`);
    } else {
      await page.goto(base + '/whatif', { waitUntil: 'domcontentloaded' });
      await settle(page);

      async function submitAdd(formSel, fields) {
        for (const [sel, v] of Object.entries(fields)) await page.fill(`${formSel} ${sel}`, v);
        const resp = page.waitForResponse(r => r.request().method() === 'POST' && new URL(r.url()).pathname === formSel.match(/hx-post="([^"]+)"/)[1], { timeout: 15000 }).catch(() => null);
        await page.evaluate(sel => document.querySelector(sel).requestSubmit(), formSel);
        const r = await resp; await settle(page);
        return r ? r.status() : null;
      }
      async function fieldValues(formSel, names) {
        return page.evaluate(({ formSel, names }) => names.map(n => document.querySelector(`${formSel} ${n}`).value), { formSel, names });
      }
      async function slotAlerts(slot) {
        return page.evaluate(slot => {
          const s = document.querySelector(slot);
          if (!s) return null;
          const roles = [...s.querySelectorAll('[role="alert"],[role="status"]')].concat(s.matches('[role="alert"],[role="status"]') ? [s] : []);
          const withText = roles.filter(e => (e.textContent || '').trim() !== '');
          return { text: (s.textContent || '').replace(/\s+/g, ' ').trim(), roles: withText.length,
                   nested: withText.some(e => e.parentElement && e.parentElement.closest('[role="alert"],[role="status"]') && s.contains(e.parentElement.closest('[role="alert"],[role="status"]'))) };
        }, slot);
      }

      // --- AC1/R1/AC4: retargeted Add rejections keep input, show one alert.
      const adds = [
        { label: 'income', form: 'form[hx-post="/whatif/income"]', slot: '#whatif-add-income-error',
          bad: { 'input[name="name"]': 'Oracle Pension', 'input[name="amount"]': '1234', 'input[name="start_month"]': '2027-06', 'input[name="end_month"]': '2027-01' },
          fix: { 'input[name="end_month"]': '' }, keep: ['input[name="name"]', 'input[name="amount"]', 'input[name="start_month"]', 'input[name="end_month"]'],
          saved: d => (d.income_sources || []).some(x => x.name === 'Oracle Pension') },
        { label: 'expense', form: 'form[hx-post="/whatif/expense"]', slot: '#whatif-add-expense-error',
          bad: { 'input[name="name"]': 'Oracle Travel', 'input[name="amount"]': '321', 'input[name="start_month"]': '2027-06', 'input[name="end_month"]': '2027-01' },
          fix: { 'input[name="end_month"]': '' }, keep: ['input[name="name"]', 'input[name="amount"]', 'input[name="start_month"]', 'input[name="end_month"]'],
          saved: d => (d.expense_sources || []).some(x => x.name === 'Oracle Travel') },
        { label: 'one-time', form: 'form[hx-post="/whatif/onetime"]', slot: '#whatif-add-onetime-error',
          bad: { 'input[name="description"]': 'Oracle Roof', 'input[name="month"]': '2070-01', 'input[name="amount"]': '20000' },
          fix: { 'input[name="month"]': '2029-04' }, keep: ['input[name="description"]', 'input[name="month"]', 'input[name="amount"]'],
          saved: d => (d.one_time_expenses || []).some(x => x.description === 'Oracle Roof') },
      ];
      for (const a of adds) {
        const typed = Object.values(a.bad);
        const st1 = await submitAdd(a.form, a.bad);
        check(st1 >= 400 && st1 < 500, `${a.label} add: server rejects (status ${st1})`);
        const kept = await fieldValues(a.form, a.keep);
        check(JSON.stringify(kept) === JSON.stringify(typed), `AC1 ${a.label} add: typed values kept after rejection (${JSON.stringify(kept)})`);
        const sa = await slotAlerts(a.slot);
        check(sa && sa.text.length > 0, `AC1 ${a.label} add: message shown in its slot (${sa && sa.text.slice(0, 90)})`);
        check(sa && sa.roles === 1 && !sa.nested, `R1/AC4 ${a.label} add: exactly one alert role, none nested (roles ${sa && sa.roles}, nested ${sa && sa.nested})`);
        const st2 = await submitAdd(a.form, a.fix);
        const cleared = await fieldValues(a.form, [a.keep[0]]);
        check(st2 === 200 && cleared[0] === '', `AC1 ${a.label} add: accepted add clears the form (status ${st2}, first field ${JSON.stringify(cleared[0])})`);
        const sa2 = await slotAlerts(a.slot);
        check(!sa2 || sa2.text === '', `${a.label} add: message gone after success (${sa2 && sa2.text.slice(0, 60)})`);
        const d = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
        check(a.saved(d), `${a.label} add: accepted item saved`);
      }

      // --- AC2/R3: a non-retargeted edit rejection next to its entry; dedupe; clears.
      const d0 = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
      const id = d0.income_sources.find(x => x.name !== 'Oracle Pension').id;
      const form = `form[hx-put="/whatif/income/${id}"]`;
      const put = () => page.waitForResponse(r => r.request().method() === 'PUT' && new URL(r.url()).pathname === `/whatif/income/${id}`, { timeout: 15000 }).catch(() => null);
      let p = put(); await page.fill(`#income-start-${id}`, '2027-06'); let r = await p; await settle(page);
      check(r && r.status() === 200, `AC2 harness: moving the income start is accepted (${r && r.status()})`);
      p = put(); await page.fill(`#income-end-${id}`, '2027-01'); r = await p; await settle(page);
      check(r && r.status() === 400, `AC2: Through before Starts is rejected, non-retargeted (${r && r.status()}, HX-Retarget ${r && r.headers()['hx-retarget']})`);
      const near = await page.evaluate(form => {
        const f = document.querySelector(form);
        const host = f && f.parentElement;
        const inHost = host ? [...host.querySelectorAll('[role="alert"]')].filter(e => /before/i.test(e.textContent)) : [];
        return { count: inHost.length, nested: inHost.some(e => e.parentElement.closest('[role="alert"],[role="status"]')),
                 verdictBar: !!document.getElementById('whatif-verdict-bar') };
      }, form);
      check(near.count === 1 && !near.nested, `AC2/R1: exactly one un-nested alert with the message next to that income entry (${near.count}, nested ${near.nested})`);
      check(near.verdictBar, 'AC2: results panel not replaced by the error');
      await page.evaluate(form => { const a = [...document.querySelector(form).parentElement.querySelectorAll('[role="alert"]')].find(e => /before/i.test(e.textContent)); if (a) a.__oracleMark = 1; }, form);
      p = put(); await page.evaluate(form => document.querySelector(form).dispatchEvent(new Event('change', { bubbles: true })), form); r = await p; await settle(page);
      const dedupe = await page.evaluate(form => { const as = [...document.querySelector(form).parentElement.querySelectorAll('[role="alert"]')].filter(e => /before/i.test(e.textContent)); return { n: as.length, same: as.length === 1 && as[0].__oracleMark === 1 }; }, form);
      check(r && r.status() === 400 && dedupe.n === 1 && dedupe.same, `R3: the same rejection again keeps one alert, same node, no re-announce (${r && r.status()}, n ${dedupe.n}, same ${dedupe.same})`);
      p = put(); await page.fill(`#income-end-${id}`, ''); r = await p; await settle(page);
      const after = await page.evaluate(form => [...document.querySelector(form).parentElement.querySelectorAll('[role="alert"]')].filter(e => /before/i.test(e.textContent)).length, form);
      check(r && r.status() === 200 && after === 0, `AC2: a later success from that form clears the message (${r && r.status()}, remaining ${after})`);

      // --- R4: a text/plain error body is shown as text, no throw.
      await page.route(`**/whatif/income/${id}`, rt => rt.request().method() === 'PUT'
        ? rt.fulfill({ status: 400, contentType: 'text/plain', body: 'Plain oracle failure' }) : rt.continue());
      p = put(); await page.fill(`#income-start-${id}`, '2027-07'); r = await p; await settle(page);
      const plain = await page.evaluate(form => [...document.querySelector(form).parentElement.querySelectorAll('[role="alert"]')].filter(e => e.textContent.includes('Plain oracle failure')).length, form);
      check(plain === 1, `R4: text/plain body shown once as an alert next to the form (${plain})`);
      await page.unroute(`**/whatif/income/${id}`);

      // --- AC3: a browser-invalid value reports validity instead of silently not saving.
      let sentSettings = 0;
      page.on('request', rq => { if (rq.method() === 'POST' && new URL(rq.url()).pathname === '/whatif/settings') sentSettings++; });
      const rv0 = await page.evaluate(() => window.__rv);
      await page.fill('#monthly-property-tax-input', '-500');
      await page.press('#monthly-property-tax-input', 'Tab');
      await page.waitForTimeout(2000);
      const v = await page.evaluate(() => ({ rv: window.__rv, active: document.activeElement && document.activeElement.id,
        msg: document.getElementById('monthly-property-tax-input').validationMessage }));
      check(v.rv > rv0 && v.msg !== '', `AC3: reportValidity called for the invalid value (calls ${v.rv - rv0}, message ${JSON.stringify(v.msg)})`);
      check(v.active === 'monthly-property-tax-input', `AC3: focus moved to the invalid field (${v.active})`);
      check(sentSettings === 0, `AC3: the invalid value was not sent (${sentSettings} POSTs)`);
      const all = await page.evaluate(ALERTS);
      check(!all.some(a => a.nested), `R1: no nested alert/status roles anywhere on the page (${JSON.stringify(all.filter(a => a.nested)).slice(0, 200)})`);
      check(pageErrors.length === 0, `no page errors (${pageErrors.slice(0, 2)})`);
    }
  } catch (e) {
    results.push(`FAIL [${scenario}] probe error: ${String(e && e.stack || e).slice(0, 400)}`);
  }
  await browser.close();
  console.log(results.join('\n'));
  process.exit(results.some(l => l.startsWith('FAIL')) ? 1 : 0);
})();
