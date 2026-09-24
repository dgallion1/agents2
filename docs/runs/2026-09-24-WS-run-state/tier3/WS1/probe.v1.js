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
  } catch (e) {
    out.error = String(e && e.stack || e);
  }
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})();
