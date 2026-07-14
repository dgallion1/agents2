// dashboard/lib/render.mjs
// Pure ES module: render(state) -> complete HTML document string.
// No I/O, no imports, no network. Same state in -> same string out.

/** Escape untrusted text for safe interpolation into HTML. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Format a token count for display, humanized, with exact value in a title. */
function humanizeTokens(n) {
  const num = Number(n);
  const value = Number.isFinite(num) ? num : 0;
  const abs = Math.abs(value);
  let display;
  if (abs >= 1e6) {
    const scaled = value / 1e6;
    display = (Math.abs(scaled) >= 100 ? Math.round(scaled).toString() : trimZero(scaled)) + 'M';
  } else if (abs >= 1e3) {
    const scaled = value / 1e3;
    display = (Math.abs(scaled) >= 100 ? Math.round(scaled).toString() : trimZero(scaled)) + 'k';
  } else {
    display = String(Math.round(value));
  }
  return `<span title="${esc(String(value))}">${esc(display)}</span>`;
}

function trimZero(n) {
  return n.toFixed(1).replace(/\.0$/, '');
}

function formatDollars(n) {
  const num = Number(n);
  const value = Number.isFinite(num) ? num : 0;
  return '$' + value.toFixed(2);
}

function formatPercent(n) {
  const num = Number(n);
  const value = Number.isFinite(num) ? num : 0;
  return Math.round(value) + '%';
}

const FAMILY_LABELS = new Set(['anthropic', 'glm', 'local']);

function familyClass(family) {
  return FAMILY_LABELS.has(family) ? `family-${family}` : 'family-unknown';
}

function familyBadge(family) {
  const label = family || 'unknown';
  return `<span class="badge ${familyClass(family)}">${esc(label)}</span>`;
}

/** Infer a display family for a worker alias string (defensive heuristic —
 * the state contract does not carry a family field on tasks directly). */
function inferWorkerFamily(worker) {
  const name = String(worker || '').toLowerCase();
  if (name.includes('local')) return 'local';
  if (name.includes('glm')) return 'glm';
  if (name.includes('anthropic') || name.includes('coder') || name.includes('claude') || name.includes('judge')) return 'anthropic';
  return null;
}

function workerBadge(worker) {
  const label = worker || 'unknown';
  const family = inferWorkerFamily(worker);
  const cls = family ? familyClass(family) : 'family-unknown';
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

const TIER_STYLES = { '1': 'tier-1', '2': 'tier-2', '3': 'tier-3' };

function tierBadge(tier) {
  const key = String(tier);
  const cls = TIER_STYLES[key] || 'tier-unknown';
  const label = TIER_STYLES[key] ? `T${key}` : 'T?';
  return `<span class="badge badge-tier ${cls}" aria-label="tier ${esc(key)}">${esc(label)}</span>`;
}

const STATUS_META = {
  building: { icon: '○', label: 'building', cls: 'status-building' },
  checking: { icon: '⟳', label: 'checking', cls: 'status-checking' },
  disputed: { icon: '⚠', label: 'disputed', cls: 'status-disputed' },
  accepted: { icon: '✓', label: 'accepted', cls: 'status-accepted' },
  flagged: { icon: '⚑', label: 'flagged', cls: 'status-flagged' },
  blocked: { icon: '✕', label: 'blocked', cls: 'status-blocked' },
};

function statusBadge(stateKey) {
  const meta = STATUS_META[stateKey] || { icon: '?', label: stateKey || 'unknown', cls: 'status-unknown' };
  return `<span class="badge status ${meta.cls}"><span aria-hidden="true">${meta.icon}</span> ${esc(meta.label)}</span>`;
}

const VERDICT_META = {
  PASS: { icon: '✓', cls: 'verdict-pass' },
  FAIL: { icon: '✕', cls: 'verdict-fail' },
  UPHOLD: { icon: '▲', cls: 'verdict-uphold' },
  OVERRULE: { icon: '▼', cls: 'verdict-overrule' },
};

function verdictBadge(verdict) {
  const meta = VERDICT_META[verdict] || { icon: '?', cls: 'verdict-unknown' };
  const label = verdict || 'unknown';
  return `<span class="badge verdict ${meta.cls}"><span aria-hidden="true">${meta.icon}</span> ${esc(label)}</span>`;
}

function isCheckerVerdict(v) {
  return v && (v.verdict === 'PASS' || v.verdict === 'FAIL');
}
function isJudgeVerdict(v) {
  return v && (v.verdict === 'UPHOLD' || v.verdict === 'OVERRULE');
}

function evidenceBlock(checker, evidence) {
  const name = checker || 'unknown checker';
  const text = evidence === null || evidence === undefined || evidence === '' ? '(no evidence recorded)' : evidence;
  return `<div class="evidence" tabindex="0" role="region" aria-label="evidence from ${esc(name)}"><pre>${esc(text)}</pre></div>`;
}

function verdictCard(v, headingLevel) {
  const checker = v && v.checker ? v.checker : 'unknown checker';
  const family = v && v.family;
  const verdict = v && v.verdict;
  const evidence = v ? v.evidence : '';
  const h = headingLevel || 'h4';
  return `<article class="verdict-card">
    <${h} class="verdict-card-title">${esc(checker)}</${h}>
    <div class="verdict-card-meta">${familyBadge(family)} ${verdictBadge(verdict)}</div>
    ${evidenceBlock(checker, evidence)}
  </article>`;
}

function emptyState(message) {
  return `<p class="empty-state">${esc(message)}</p>`;
}

function warningState(message) {
  return `<p class="empty-state warning"><span aria-hidden="true">⚠</span> ${esc(message)}</p>`;
}

function renderErrorsStrip(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return '';
  const items = errors
    .map((e) => {
      const file = e && e.file ? e.file : 'unknown file';
      const message = e && e.message ? e.message : 'unknown error';
      return `<li><span class="error-file">${esc(file)}</span><span class="error-message">${esc(message)}</span></li>`;
    })
    .join('');
  return `<section class="errors-strip" aria-labelledby="errors-heading">
    <h2 id="errors-heading"><span aria-hidden="true">⚠</span> Ledger discrepancies &amp; parse errors</h2>
    <ul class="errors-list">${items}</ul>
  </section>`;
}

function renderFlagsStrip(tasks) {
  const flagged = tasks.filter((t) => t && t.flag);
  if (flagged.length === 0) return '';
  const items = flagged
    .map((t) => {
      const targetTier = t.flag && t.flag.targetTier;
      const reason = (t.flag && t.flag.reason) || '—';
      return `<li>
        <span class="flag-task">${esc(t.id)}</span>
        <span class="flag-target">target ${tierBadge(targetTier)}</span>
        <span class="flag-reason">${esc(reason)}</span>
      </li>`;
    })
    .join('');
  return `<section class="flags-strip" aria-labelledby="flags-heading">
    <h2 id="flags-heading"><span aria-hidden="true">⚑</span> Open flags</h2>
    <ul class="flags-list">${items}</ul>
  </section>`;
}

function renderLedgerTable(tasks) {
  if (tasks.length === 0) {
    return `<section aria-labelledby="ledger-heading">
      <h2 id="ledger-heading">Ledger</h2>
      ${emptyState('no tasks recorded yet.')}
    </section>`;
  }
  const rows = tasks
    .map((t) => {
      const id = t && t.id ? t.id : 'unknown';
      const checks = Array.isArray(t && t.checks) && t.checks.length ? t.checks.filter(Boolean).join(', ') : '—';
      const attempt = t && (t.attempt || t.attempt === 0) ? t.attempt : '—';
      const stateKey = t && t.derived && t.derived.state ? t.derived.state : (t && t.status) || 'unknown';
      return `<tr>
        <th scope="row"><a class="task-link" href="?task=${encodeURIComponent(id)}">${esc(id)}</a></th>
        <td>${tierBadge(t && t.tier)}</td>
        <td>${esc(checks)}</td>
        <td>${esc(String(attempt))}</td>
        <td>${workerBadge(t && t.worker)}</td>
        <td>${statusBadge(stateKey)}</td>
      </tr>`;
    })
    .join('');
  return `<section aria-labelledby="ledger-heading">
    <h2 id="ledger-heading">Ledger</h2>
    <div class="table-scroll" role="region" aria-label="Ledger table" tabindex="0">
      <table class="ledger-table">
        <thead>
          <tr>
            <th scope="col">task</th>
            <th scope="col">tier</th>
            <th scope="col">checks</th>
            <th scope="col">attempt</th>
            <th scope="col">worker</th>
            <th scope="col">status</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </section>`;
}

function renderManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) {
    return emptyState('no manifest recorded yet.');
  }
  const items = manifest.map((p) => `<li><code>${esc(p)}</code></li>`).join('');
  return `<ul class="manifest-list">${items}</ul>`;
}

function renderVerdicts(verdicts) {
  if (!Array.isArray(verdicts) || verdicts.length === 0) {
    return emptyState('no verdicts recorded yet.');
  }
  return `<div class="verdict-cards">${verdicts.map(verdictCard).join('')}</div>`;
}

function renderDisputePanel(task) {
  const verdicts = Array.isArray(task.verdicts) ? task.verdicts : [];
  const checkerVerdicts = verdicts.filter(isCheckerVerdict);
  const judgeVerdicts = verdicts.filter(isJudgeVerdict);
  const overruleCount = judgeVerdicts.filter((v) => v.verdict === 'OVERRULE').length;
  const upholdCount = judgeVerdicts.filter((v) => v.verdict === 'UPHOLD').length;

  const checkerHtml = checkerVerdicts.length
    ? `<div class="verdict-cards side-by-side">${checkerVerdicts.map((v) => verdictCard(v, 'h5')).join('')}</div>`
    : emptyState('no checker verdicts recorded yet.');
  const judgeHtml = judgeVerdicts.length
    ? `<div class="verdict-cards side-by-side">${judgeVerdicts.map((v) => verdictCard(v, 'h5')).join('')}</div>`
    : emptyState('no judge verdicts recorded yet.');

  return `<section class="dispute-panel" aria-labelledby="dispute-heading">
    <h3 id="dispute-heading">Dispute panel</h3>
    <h4>Checker verdicts</h4>
    ${checkerHtml}
    <h4>Judge verdicts</h4>
    ${judgeHtml}
    <p class="vote-count">overrule ${overruleCount} – uphold ${upholdCount}</p>
  </section>`;
}

function renderTier3Diff(tier3) {
  const matrix = Array.isArray(tier3.matrix) ? tier3.matrix : [];
  const rows = matrix.length
    ? matrix
        .map((row) => {
          const diverges = row && row.agree === false;
          const tag = diverges
            ? '<span class="tag tag-diverge"><span aria-hidden="true">⚠</span> diverges</span>'
            : '<span class="tag tag-agree"><span aria-hidden="true">✓</span> agrees</span>';
          return `<tr class="${diverges ? 'row-diverge' : ''}">
            <td>${esc(row && row.check)}</td>
            <td>${esc(row && row.a)}</td>
            <td>${esc(row && row.b)}</td>
            <td>${tag}</td>
          </tr>`;
        })
        .join('')
    : '';
  const tableHtml = matrix.length
    ? `<div class="table-scroll" role="region" aria-label="Tier-3 comparison matrix" tabindex="0">
        <table class="tier3-table">
          <thead>
            <tr>
              <th scope="col">check</th>
              <th scope="col">worktree A</th>
              <th scope="col">worktree B</th>
              <th scope="col">status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`
    : emptyState('no comparison matrix recorded yet.');

  const resolutionHtml = tier3.hasResolution
    ? `<h4>Resolution</h4><div class="evidence" tabindex="0" role="region" aria-label="tier-3 resolution"><pre>${esc(tier3.resolution)}</pre></div>`
    : warningState('no RESOLUTION recorded.');

  return `<section class="tier3-panel" aria-labelledby="tier3-heading">
    <h3 id="tier3-heading">Tier-3 diff</h3>
    ${tableHtml}
    ${resolutionHtml}
  </section>`;
}

function renderDrawer(tasks, openTask) {
  if (!openTask) return '';
  const task = tasks.find((t) => t && t.id === openTask);
  if (!task) return '';

  const stateKey = task.derived && task.derived.state ? task.derived.state : task.status || 'unknown';
  const familiesPassed = task.derived && Array.isArray(task.derived.familiesPassed) ? task.derived.familiesPassed : [];
  const isDispute = !!(task.derived && task.derived.isDispute);

  const flagLine = task.flag
    ? `<div><dt>Escalation flag</dt><dd>target ${tierBadge(task.flag.targetTier)} — ${esc(task.flag.reason || '—')}</dd></div>`
    : '';

  return `<section class="task-drawer" id="task-drawer" aria-labelledby="drawer-heading">
    <h2 id="drawer-heading">Task detail: ${esc(task.id)}</h2>
    <dl class="drawer-meta">
      <div><dt>Status</dt><dd>${statusBadge(stateKey)}</dd></div>
      <div><dt>Tier</dt><dd>${tierBadge(task.tier)}</dd></div>
      <div><dt>Attempt</dt><dd>${esc(String(task.attempt !== undefined && task.attempt !== null ? task.attempt : '—'))}</dd></div>
      <div><dt>Worker</dt><dd>${workerBadge(task.worker)}</dd></div>
      <div><dt>Reason</dt><dd>${esc(task.reason || '—')}</dd></div>
      <div><dt>Families passed</dt><dd>${familiesPassed.length ? esc(familiesPassed.join(', ')) : '—'}</dd></div>
      ${flagLine}
    </dl>

    <h3>Manifest</h3>
    ${renderManifest(task.manifest)}

    ${isDispute
      ? renderDisputePanel(task)
      : `<h3>Verdicts</h3>${renderVerdicts(task.verdicts)}`}
    ${task.tier3 ? renderTier3Diff(task.tier3) : ''}
  </section>`;
}

function renderCostPanel(spend) {
  if (!spend) {
    return `<section aria-labelledby="cost-heading">
      <h2 id="cost-heading">Cost panel</h2>
      ${emptyState('no spend data — gateway callback not wired.')}
    </section>`;
  }

  const derived = spend.derived || {};
  const perAlias = Array.isArray(spend.perAlias) ? spend.perAlias : [];
  const perTier = Array.isArray(spend.perTier) ? spend.perTier : [];
  const total = spend.total || 0;

  const metricCards = `<div class="summary-cards" role="group" aria-label="cost summary">
    <div class="card metric-card">
      <span class="metric-value">${esc(formatDollars(total))}</span>
      <span class="metric-label">run spend</span>
    </div>
    <div class="card metric-card">
      <span class="metric-value">${esc(formatDollars(derived.perAcceptedTask))}</span>
      <span class="metric-label">per accepted task</span>
    </div>
    <div class="card metric-card">
      <span class="metric-value">${esc(formatPercent(derived.verificationSharePct))}</span>
      <span class="metric-label">verification share</span>
    </div>
    <div class="card metric-card">
      <span class="metric-value">${esc(formatDollars(derived.disputeOverhead))}</span>
      <span class="metric-label">dispute overhead</span>
    </div>
  </div>`;

  const aliasRows = perAlias.length
    ? perAlias
        .map((row) => {
          const share = total > 0 ? ((row.cost || 0) / total) * 100 : 0;
          return `<tr>
            <td>${esc(row.alias)}</td>
            <td>${familyBadge(row.family)}</td>
            <td>${humanizeTokens(row.tokens)}</td>
            <td>${esc(formatDollars(row.cost))}</td>
            <td>
              <span class="share-bar-wrap">
                <span class="share-bar" aria-hidden="true" style="width:${Math.max(0, Math.min(100, share)).toFixed(0)}%"></span>
                <span class="share-text">${esc(formatPercent(share))}</span>
              </span>
            </td>
          </tr>`;
        })
        .join('')
    : '';
  const aliasTable = perAlias.length
    ? `<div class="table-scroll" role="region" aria-label="Spend by alias" tabindex="0">
        <table class="alias-table">
          <thead>
            <tr>
              <th scope="col">alias</th>
              <th scope="col">family</th>
              <th scope="col">tokens</th>
              <th scope="col">cost</th>
              <th scope="col">share</th>
            </tr>
          </thead>
          <tbody>${aliasRows}</tbody>
        </table>
      </div>`
    : emptyState('no per-alias spend recorded yet.');

  const tierCards = perTier.length
    ? `<div class="tier-cost-cards">${perTier
        .map(
          (row) => `<div class="card tier-cost-card">
            ${tierBadge(row.tier)}
            <span class="tier-cost-tasks">${esc(String(row.tasks))} tasks</span>
            <span class="tier-cost-avg">avg ${esc(formatDollars(row.avgCost))}</span>
          </div>`
        )
        .join('')}</div>`
    : emptyState('no per-tier spend recorded yet.');

  return `<section aria-labelledby="cost-heading">
    <h2 id="cost-heading">Cost panel</h2>
    ${metricCards}
    <h3>Spend by alias</h3>
    ${aliasTable}
    <h3>Spend by tier</h3>
    ${tierCards}
  </section>`;
}

function renderStyles() {
  return `<style>
    :root {
      --bg: #e3e3e8;
      --surface: #ffffff;
      --surface-2: #f2f2f6;
      --text: #17171c;
      --text-muted: #46464f;
      --border: #c7c7d1;
      --focus: #1450c7;

      --coral-fill: #f9e0d7;
      --coral-text: #742b11;
      --teal-fill: #d7f4ea;
      --teal-text: #0d5940;
      --gray-fill: #e6e6e6;
      --gray-text: #333333;
      --purple-fill: #e4e1f4;
      --purple-text: #2c2277;
      --pink-fill: #f4e1e6;
      --pink-text: #721d32;
      --green-fill: #d7f4e3;
      --green-text: #145d32;
      --blue-fill: #dceaf9;
      --blue-text: #12447d;
      --amber-fill: #f9e7c8;
      --amber-text: #6e3d0c;
      --red-fill: #f9dfdc;
      --red-text: #861d13;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #101013;
        --surface: #1e1e24;
        --surface-2: #26262e;
        --text: #f1f1f4;
        --text-muted: #b7b7c2;
        --border: #3d3d47;
        --focus: #7fb0ff;

        --coral-fill: #4f2617;
        --coral-text: #fabea8;
        --teal-fill: #183f32;
        --teal-text: #97edd0;
        --gray-fill: #383838;
        --gray-text: #dbdbdb;
        --purple-fill: #29244c;
        --purple-text: #b8b1f1;
        --pink-fill: #45212a;
        --pink-text: #f1b1c1;
        --green-fill: #163b26;
        --green-text: #a0eec0;
        --blue-fill: #152c47;
        --blue-text: #a1c9f7;
        --amber-fill: #493312;
        --amber-text: #f9d894;
        --red-fill: #471915;
        --red-text: #f8b1aa;
      }
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.5;
      overflow-x: hidden;
    }

    a { color: var(--focus); }

    a:focus-visible,
    button:focus-visible,
    [tabindex]:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }

    .skip-link {
      position: absolute;
      left: -9999px;
      top: 0;
      background: var(--surface);
      color: var(--text);
      padding: 0.75rem 1rem;
      z-index: 100;
      border: 2px solid var(--focus);
    }
    .skip-link:focus {
      left: 0.5rem;
      top: 0.5rem;
    }

    header, main, footer {
      max-width: 72rem;
      margin: 0 auto;
      padding: 1.25rem 1.5rem;
    }

    header h1 {
      font-size: 1.5rem;
      margin: 0 0 1rem 0;
    }

    main h2 {
      font-size: 1.15rem;
      margin: 2rem 0 0.75rem 0;
    }
    main h3 {
      font-size: 1rem;
      margin: 1.5rem 0 0.5rem 0;
    }
    main h4 {
      font-size: 0.9rem;
      margin: 1rem 0 0.5rem 0;
    }

    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 0.9rem 1rem;
    }

    .summary-cards {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .metric-card {
      min-width: 9rem;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .metric-value {
      font-size: 1.4rem;
      font-weight: 600;
    }
    .metric-label {
      color: var(--text-muted);
      font-size: 0.8rem;
    }

    .errors-strip {
      background: var(--red-fill);
      color: var(--red-text);
      border: 1px solid var(--red-text);
      border-radius: 0.5rem;
      padding: 1rem 1.25rem;
      margin-top: 1rem;
    }
    .errors-strip h2 { margin-top: 0; color: inherit; }
    .errors-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .errors-list li {
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem;
    }
    .error-file {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-weight: 600;
    }

    .flags-strip {
      background: var(--amber-fill);
      color: var(--amber-text);
      border: 1px solid var(--amber-text);
      border-radius: 0.5rem;
      padding: 1rem 1.25rem;
      margin-top: 1rem;
    }
    .flags-strip h2 { margin-top: 0; color: inherit; }
    .flags-list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .flags-list li {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
      align-items: baseline;
    }
    .flag-task {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-weight: 600;
    }

    .table-scroll {
      width: 100%;
      max-width: 100%;
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      background: var(--surface);
    }
    .table-scroll:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }
    table {
      width: 100%;
      min-width: 32rem;
      border-collapse: collapse;
      background: var(--surface);
    }
    .table-scroll table {
      border: none;
      border-radius: 0;
    }
    caption { text-align: left; }
    th, td {
      text-align: left;
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid var(--border);
      vertical-align: middle;
    }
    thead th {
      background: var(--surface-2);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--text-muted);
    }
    tbody tr:last-child td,
    tbody tr:last-child th {
      border-bottom: none;
    }

    .task-link {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      min-width: 24px;
      padding: 0.15rem 0.35rem;
      margin: -0.15rem -0.35rem;
      border-radius: 0.3rem;
      text-decoration: underline;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.2rem 0.5rem;
      border-radius: 999px;
      font-size: 0.8rem;
      font-weight: 600;
      line-height: 1.4;
      white-space: nowrap;
    }

    .family-anthropic { background: var(--coral-fill); color: var(--coral-text); }
    .family-glm { background: var(--teal-fill); color: var(--teal-text); }
    .family-local { background: var(--gray-fill); color: var(--gray-text); }
    .family-unknown { background: var(--gray-fill); color: var(--gray-text); }

    .badge-tier.tier-1 { background: var(--gray-fill); color: var(--gray-text); }
    .badge-tier.tier-2 { background: var(--purple-fill); color: var(--purple-text); }
    .badge-tier.tier-3 { background: var(--pink-fill); color: var(--pink-text); }
    .badge-tier.tier-unknown { background: var(--gray-fill); color: var(--gray-text); }

    .status-accepted, .verdict-pass { background: var(--green-fill); color: var(--green-text); }
    .status-checking, .status-building { background: var(--blue-fill); color: var(--blue-text); }
    .status-disputed, .verdict-uphold { background: var(--amber-fill); color: var(--amber-text); }
    .status-flagged, .status-blocked, .verdict-fail, .verdict-overrule { background: var(--red-fill); color: var(--red-text); }
    .status-unknown, .verdict-unknown { background: var(--gray-fill); color: var(--gray-text); }

    .empty-state {
      background: var(--surface-2);
      border: 1px dashed var(--border);
      border-radius: 0.5rem;
      padding: 0.9rem 1rem;
      color: var(--text-muted);
    }
    .empty-state.warning {
      background: var(--amber-fill);
      color: var(--amber-text);
      border: 1px solid var(--amber-text);
      font-weight: 600;
    }

    .task-drawer {
      margin-top: 2rem;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1.25rem 1.5rem;
    }

    .drawer-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
      gap: 0.75rem 1.5rem;
      margin: 0;
    }
    .drawer-meta > div {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .drawer-meta dt {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      color: var(--text-muted);
    }
    .drawer-meta dd {
      margin: 0;
    }

    .manifest-list {
      margin: 0;
      padding-left: 1.25rem;
    }
    .manifest-list code {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 0.85rem;
    }

    .verdict-cards {
      display: flex;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .verdict-cards.side-by-side > .verdict-card {
      flex: 1 1 18rem;
    }
    .verdict-card {
      background: var(--surface-2);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 0.9rem 1rem;
      flex: 1 1 20rem;
    }
    .verdict-card-title {
      margin: 0 0 0.4rem 0;
    }
    .verdict-card-meta {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 0.6rem;
    }

    .evidence {
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 0.4rem;
      max-height: 16rem;
      overflow: auto;
    }
    .evidence pre {
      margin: 0;
      padding: 0.75rem 0.9rem;
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 0.85rem;
      white-space: pre-wrap;
      word-break: break-word;
    }

    .vote-count {
      font-weight: 600;
      font-size: 1.05rem;
    }

    .tag {
      display: inline-flex;
      align-items: center;
      gap: 0.3rem;
      padding: 0.15rem 0.45rem;
      border-radius: 999px;
      font-size: 0.78rem;
      font-weight: 600;
    }
    .tag-diverge { background: var(--red-fill); color: var(--red-text); }
    .tag-agree { background: var(--green-fill); color: var(--green-text); }
    tr.row-diverge { background: var(--red-fill); }
    tr.row-diverge td { color: var(--red-text); }

    .share-bar-wrap {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 0.5rem;
      width: 8rem;
    }
    .share-bar {
      display: block;
      height: 0.55rem;
      background: var(--focus);
      border-radius: 999px;
      max-width: 5rem;
    }
    .share-text {
      font-size: 0.8rem;
      color: var(--text-muted);
    }

    .tier-cost-cards {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .tier-cost-card {
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
      min-width: 8rem;
    }

    footer {
      color: var(--text-muted);
      font-size: 0.85rem;
      border-top: 1px solid var(--border);
      margin-top: 2rem;
      display: flex;
      flex-wrap: wrap;
      gap: 0.5rem 1rem;
      align-items: baseline;
    }

    @media (prefers-reduced-motion: no-preference) {
      .task-link, .badge, .card {
        transition: background-color 0.15s ease, color 0.15s ease;
      }
    }
  </style>`;
}

/**
 * Render the full swarm mission-control dashboard as a single HTML document.
 * @param {object} state - see dashboard/lib state contract (SPEC.md §2b).
 * @returns {string} complete `<!doctype html>` document.
 */
export function render(state) {
  const s = state && typeof state === 'object' ? state : {};
  const tasks = Array.isArray(s.tasks) ? s.tasks.filter(Boolean) : [];
  const summary = s.summary && typeof s.summary === 'object' ? s.summary : {};
  const spend = s.spend && typeof s.spend === 'object' ? s.spend : null;
  const errors = Array.isArray(s.errors) ? s.errors : [];
  const runName = s.runName || 'swarm run';
  const openTask = s.openTask || null;

  const accepted = summary.accepted || 0;
  const inVerification = summary.inVerification || 0;
  const disputed = summary.disputed || 0;
  const flagsOpen = summary.flagsOpen || 0;

  const headerHtml = `<header>
    <h1>${esc(runName)}</h1>
    <div class="summary-cards" role="group" aria-label="run summary">
      <div class="card metric-card">
        <span class="metric-value">${esc(String(accepted))}</span>
        <span class="metric-label">accepted</span>
      </div>
      <div class="card metric-card">
        <span class="metric-value">${esc(String(inVerification))}</span>
        <span class="metric-label">in verification</span>
      </div>
      <div class="card metric-card">
        <span class="metric-value">${esc(String(disputed))}</span>
        <span class="metric-label">disputed</span>
      </div>
      <div class="card metric-card">
        <span class="metric-value">${esc(String(flagsOpen))}</span>
        <span class="metric-label">flags open</span>
      </div>
    </div>
  </header>`;

  const mainHtml = `<main id="main-content">
    ${renderErrorsStrip(errors)}
    ${renderFlagsStrip(tasks)}
    ${renderLedgerTable(tasks)}
    ${renderDrawer(tasks, openTask)}
    ${renderCostPanel(spend)}
  </main>`;

  const footerHtml = `<footer>
    <p>read-only view · status changes flow only through gate.sh</p>
    <span id="live-status" role="status" aria-live="polite"></span>
  </footer>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(runName)} — swarm mission control</title>
${renderStyles()}
</head>
<body>
<a class="skip-link" href="#main-content">Skip to content</a>
${headerHtml}
${mainHtml}
${footerHtml}
</body>
</html>`;
}
