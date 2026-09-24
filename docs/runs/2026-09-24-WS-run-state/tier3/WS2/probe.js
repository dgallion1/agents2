// WS2 probe: drive the real Rate Assumptions form in Chromium and report the
// rendered calendar month of every scheduled item plus the saved offsets,
// before and after one user action.
// usage: node probe.js <base-url> <saved-whatif.json> <action> [arg]
//   action = date <YYYY-MM>   type a new Projection Start Date
//          = tick             tick "Use current month"
//          = statetax <rate>  change an unrelated field on the same form
const { chromium } = require('playwright');
const fs = require('fs');

const [base, savedPath, action, arg] = process.argv.slice(2);

function saved() {
  const d = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
  const pick = (xs, f) => Object.fromEntries((xs || []).map(x => [x.id, f(x)]));
  const range = x => [x.start_month, x.end_month === undefined ? null : x.end_month];
  return {
    start_date: d.start_date,
    use_current_month: !!d.use_current_month,
    income: pick(d.income_sources, range),
    expense: pick(d.expense_sources, range),
    removed_expense: pick(d.removed_expense_sources, range),
    removed_income: pick(d.removed_income_sources, range),
    onetime: pick(d.one_time_expenses, x => x.month),
    bigticket: pick(d.big_ticket_items, x => x.month),
    onetime_names: pick(d.one_time_expenses, x => x.description),
    bigticket_names: pick(d.big_ticket_items, x => x.name),
  };
}

async function rendered(page) {
  return page.evaluate(() => {
    const val = sel => Object.fromEntries([...document.querySelectorAll(sel)].map(e => [e.id.replace(/^(income|expense)-(start|end)-/, ''), e.value]));
    const label = el => {
      const m = (el.innerText || '').match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}( \(past\))?/);
      return m ? m[0] : null;
    };
    const items = (sel, prefix) => Object.fromEntries([...document.querySelectorAll(sel)].map(b => {
      const name = b.getAttribute('aria-label').slice(prefix.length);
      let c = b.parentElement;
      while (c && !label(c)) c = c.parentElement;
      return [name, c ? label(c) : null];
    }));
    return {
      income_start: val('input[id^="income-start-"]'),
      income_end: val('input[id^="income-end-"]'),
      expense_start: val('input[id^="expense-start-"]'),
      expense_end: val('input[id^="expense-end-"]'),
      onetime: items('button[aria-label^="Remove one-time expense "]', 'Remove one-time expense '),
      bigticket: items('button[aria-label^="Delete big ticket "]', 'Delete big ticket '),
      start_input: document.getElementById('projection-start-date')?.value || null,
    };
  });
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const out = { action, arg };
  try {
    await page.goto(base + '/whatif', { waitUntil: 'networkidle' });
    out.before = { rendered: await rendered(page), saved: saved() };
    const form = page.locator('form[hx-post="/whatif/settings"]:has(#projection-start-date)');
    out.form_valid_before = await form.evaluate(f => f.checkValidity());
    const post = page.waitForResponse(r => r.url().endsWith('/whatif/settings') && r.request().method() === 'POST', { timeout: 15000 });
    if (action === 'date') {
      await page.fill('#projection-start-date', arg);
    } else if (action === 'tick') {
      await form.locator('input[name="use_current_month"]').check();
    } else if (action === 'statetax') {
      // hx-trigger's "input … from:find input[type=number]" only watches the
      // FIRST number field; any other number field saves on change (blur),
      // exactly as a user leaving the field.
      await page.fill('#state-income-tax-rate-input', arg);
      await page.press('#state-income-tax-rate-input', 'Tab');
    } else {
      throw new Error('unknown action ' + action);
    }
    const resp = await post;
    out.post_status = resp.status();
    out.post_body_head = (await resp.text()).slice(0, 300).replace(/\s+/g, ' ');
    await page.waitForTimeout(300);
    await page.goto(base + '/whatif', { waitUntil: 'networkidle' });
    out.after = { rendered: await rendered(page), saved: saved() };
  } catch (e) {
    out.error = String(e && e.message || e);
  }
  await browser.close();
  process.stdout.write(JSON.stringify(out));
})();
