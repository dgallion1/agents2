// WS1 probe: in real Chromium, submit every stored-value /whatif form exactly
// as a user action would (untouched), then exercise the touched path of the
// converted sliders. Reports saved-plan snapshots and per-form outcomes.
// usage: node probe.js <base-url> <saved-whatif.json>
const { chromium } = require('playwright');
const fs = require('fs');

const [base, savedPath] = process.argv.slice(2);
const readSaved = () => JSON.parse(fs.readFileSync(savedPath, 'utf8'));

// Forms that hold a stored value. Add/create forms (POST /whatif/income,
// /expense, /healthcare, /bigticket, /onetime, /scenarios, /chain) are
// deliberately excluded: submitting them creates items.
const STORED = /^\/whatif\/(settings|glide-path|spending-phases|guardrails|roth-conversion|social-security)$|^\/whatif\/(income|expense|healthcare)\/[^/]+$/;

// Network quiet: no request in flight for 800 ms. (waitForLoadState
// ('networkidle') resolves immediately after the first navigation, so it
// cannot see htmx's follow-up results-full loads — a late swap of that
// kind would otherwise wipe a form between its change event and its
// delayed request.)
let inflight = 0, lastActivity = Date.now();
function trackNetwork(page) {
  page.on('request', () => { inflight++; lastActivity = Date.now(); });
  const done = () => { inflight = Math.max(0, inflight - 1); lastActivity = Date.now(); };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
}
async function settle(page) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (inflight === 0 && Date.now() - lastActivity >= 800) return;
    await page.waitForTimeout(100);
  }
  throw new Error('network never went quiet');
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  trackNetwork(page);
  const out = { forms: [], touched: {} };
  try {
    await page.goto(base + '/whatif', { waitUntil: 'networkidle' });
    await settle(page);
    out.s0 = readSaved();

    const keys = await page.evaluate((re) => {
      const rx = new RegExp(re);
      const seen = {};
      return [...document.querySelectorAll('form[hx-post],form[hx-put],select[hx-put]')].map(el => {
        const verb = el.hasAttribute('hx-put') ? 'PUT' : 'POST';
        const url = el.getAttribute(verb === 'PUT' ? 'hx-put' : 'hx-post');
        const k = `${el.tagName} ${verb} ${url}`;
        seen[k] = (seen[k] || 0) + 1;
        return { tag: el.tagName, verb, url, nth: seen[k] - 1 };
      }).filter(x => rx.test(x.url));
    }, STORED.source);

    for (const k of keys) {
      const handle = await page.evaluateHandle(({ tag, verb, url, nth }) => {
        const attr = verb === 'PUT' ? 'hx-put' : 'hx-post';
        return [...document.querySelectorAll(`${tag.toLowerCase()}[${attr}]`)].filter(e => e.getAttribute(attr) === url)[nth] || null;
      }, k);
      const el = handle.asElement();
      const rec = { ...k };
      if (!el) { rec.missing = true; out.forms.push(rec); continue; }
      if (k.tag === 'FORM') {
        rec.valid = await el.evaluate(f => f.checkValidity());
        rec.invalid = await el.evaluate(f => [...f.elements].filter(e => e.willValidate && !e.validity.valid).map(e => `${e.name}=${e.value} (${e.validationMessage})`));
      }
      const resp = page.waitForResponse(r => r.url().replace(/^https?:\/\/[^/]+/, '') === k.url && r.request().method() === k.verb, { timeout: 15000 }).catch(() => null);
      await el.evaluate(e => {
        // A user action on an untouched form: a change event where the form
        // listens for one, otherwise the form's own submit.
        if (e.tagName === 'SELECT' || e.hasAttribute('hx-trigger')) {
          e.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          e.requestSubmit();
        }
      });
      const r = await resp;
      rec.sent = !!r;
      rec.status = r ? r.status() : null;
      out.forms.push(rec);
      await settle(page);
    }
    out.s1 = readSaved();

    // Touched path (criterion 3) and exact display (criterion 4).
    const hp1 = out.s1.healthcare_persons[1].id;
    await page.goto(base + '/whatif', { waitUntil: 'networkidle' });
    await settle(page);
    out.touched.display = await page.evaluate((id) => {
      const r = document.getElementById('healthcare-monthly-cost-' + id);
      const d = document.querySelector(`#whatif-healthcare-card [data-quick-adjust-display="healthcare:${id}:current_monthly_cost"], form[hx-put="/whatif/healthcare/${id}"] [data-quick-adjust-display="healthcare:${id}:current_monthly_cost"]`);
      return { range_type: r && r.type, range_named: !!(r && r.name), aria_valuetext: r && r.getAttribute('aria-valuetext'), display: d && d.textContent.trim() };
    }, hp1);

    async function setRange(selector, value, url, verb) {
      const resp = page.waitForResponse(r => r.url().replace(/^https?:\/\/[^/]+/, '').startsWith(url) && r.request().method() === verb, { timeout: 15000 }).catch(() => null);
      await page.evaluate(({ selector, value }) => {
        const el = document.querySelector(selector);
        el.value = String(value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
      }, { selector, value });
      const r = await resp;
      await settle(page);
      return r ? r.status() : null;
    }
    out.touched.hc_status = await setRange('#healthcare-monthly-cost-' + hp1, 1800, '/whatif/healthcare/' + hp1, 'PUT');
    out.touched.hc_saved = readSaved().healthcare_persons[1].current_monthly_cost;
    out.touched.pf_status = await setRange('#portfolio-slider', 2500000, '/whatif/settings', 'POST');
    out.touched.pf_saved = readSaved().portfolio_value;
    await page.click('#quick-adjust-toggle').catch(() => {});
    await page.waitForTimeout(300);
    out.touched.qa_status = await setRange('#qa-healthcare-monthly-cost-' + hp1, 1900, '/whatif/healthcare/' + hp1, 'PUT');
    out.touched.qa_saved = readSaved().healthcare_persons[1].current_monthly_cost;

    // ---- Extended checks (added 2026-09-23 after WS1.1 checker-tests FAIL) ----
    await page.goto(base + '/whatif', { waitUntil: 'networkidle' });
    await settle(page);
    // E1: every converted (unnamed) slider and its Quick Adjust mirror carries
    // aria-valuetext equal to its own display text.
    out.ext = {};
    out.ext.e1 = await page.evaluate(() => {
      const norm = t => (t || '').replace(/\s+/g, ' ').trim();
      return [...document.querySelectorAll('input[type="range"]:not([name])')].map(r => {
        const key = r.dataset.quickAdjustKey || '';
        const canon = key ? [...document.querySelectorAll('[data-quick-adjust-key]')].find(c => c.dataset.quickAdjustKey === key && !c.hasAttribute('data-quick-adjust-mirror')) : null;
        if (canon && canon.type === 'range' && canon.name) return null; // not a converted field
        const inQA = !!r.closest('#quick-adjust-panel');
        const displays = key ? [...document.querySelectorAll('[data-quick-adjust-display]')].filter(d => d.dataset.quickAdjustDisplay === key) : [];
        const disp = displays.find(d => !!d.closest('#quick-adjust-panel') === inQA) || displays[0] || null;
        return { id: r.id, key, aria: r.getAttribute('aria-valuetext'), display: disp ? norm(disp.textContent) : null };
      }).filter(Boolean);
    });
    // E2: no float artifacts in anything a user sees or hears.
    out.ext.e2 = await page.evaluate(() => {
      const rx = /\d\.\d*(?:0{6,}[1-9]|9{6,}\d)/;
      const seen = [];
      document.querySelectorAll('input[type="number"],input[type="text"]').forEach(i => { if (rx.test(i.value)) seen.push(`${i.name || i.id}=${i.value}`); });
      document.querySelectorAll('[aria-valuetext]').forEach(i => { if (rx.test(i.getAttribute('aria-valuetext'))) seen.push(`${i.id} aria=${i.getAttribute('aria-valuetext')}`); });
      document.querySelectorAll('[data-quick-adjust-display]').forEach(d => { if (rx.test(d.textContent)) seen.push(`display ${d.dataset.quickAdjustDisplay}=${d.textContent.trim()}`); });
      return seen;
    });
    // E3 (R1): the Quick Adjust portfolio slider follows the range select.
    const geo = () => page.evaluate(() => {
      const a = document.getElementById('portfolio-slider'), q = document.getElementById('qa-portfolio-value');
      return { main: a && [a.min, a.max, a.step].join(','), qa: q && [q.min, q.max, q.step].join(','),
               sel: document.getElementById('portfolio-range') && document.getElementById('portfolio-range').value };
    });
    out.ext.e3 = [await geo()];
    const opts = await page.evaluate(() => [...document.getElementById('portfolio-range').options].map(o => o.value));
    const small = opts.find(v => v.split(',')[1] === '1000000') || opts[0];
    await page.selectOption('#portfolio-range', small); await page.waitForTimeout(300);
    out.ext.e3.push(await geo());
    await page.click('#quick-adjust-toggle').catch(() => {});
    await page.waitForTimeout(300);
    const big = opts.find(v => v.split(',')[1] === '5000000') || opts[opts.length - 1];
    await page.selectOption('#quick-adjust-portfolio-range', big); await page.waitForTimeout(300);
    out.ext.e3.push(await geo());
    // E4 (R2) and E5 (R3): Quick Adjust drags update the in-card display and
    // the per-account amounts live (input events only; no save needed).
    out.ext.e4 = await page.evaluate(() => {
      const q = document.getElementById('qa-investment-return');
      const d = document.getElementById('investment-return-display');
      const before = d && d.textContent.replace(/\s+/g, ' ').trim();
      q.value = '3'; q.dispatchEvent(new Event('input', { bubbles: true }));
      return { before, after: d && d.textContent.replace(/\s+/g, ' ').trim() };
    });
    out.ext.e5 = await page.evaluate(() => {
      const ids = ['td-amount-display', 'roth-amount-display', 'taxable-amount-display'];
      const read = () => ids.map(i => (document.getElementById(i) || {}).textContent || '');
      const q = document.getElementById('qa-portfolio-value');
      const before = read();
      q.value = String(Number(q.max) >= 4000000 ? 4000000 : Number(q.max)); q.dispatchEvent(new Event('input', { bubbles: true }));
      return { before, after: read(), set: q.value };
    });
  } catch (e) {
    out.error = String(e && e.stack || e);
  }
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})();
