// parse.mjs — pure reader for the `.swarm/` layout (SPEC.md §2a/§2b).
//
// Contract: `parse(swarmDir)` is synchronous, side-effect free (no HTTP, no
// process.exit, no console output) and returns a plain state object. It must
// never throw on malformed input — malformed lines/files land in
// `state.errors` instead. This module is the trust boundary the rest of the
// dashboard depends on: `derived.state` must never claim `accepted` unless a
// real PASS-quorum exists in the verdict files for the task's *current*
// attempt (the anti-lie property).
//
// Quorum rules mirror `swarm/gate.sh` exactly so the dashboard never
// disagrees with the mechanical gate about what is actually accepted.

import fs from 'node:fs';
import path from 'node:path';

const VALID_VERDICTS = new Set(['PASS', 'FAIL', 'UPHOLD', 'OVERRULE']);
// FAMILY names an independence LANE (gate.sh load_verdict): anthropic /
// adversarial / impact are current; glm and local validate only so
// pre-2026-08-19 verdicts still parse.
const VALID_FAMILIES = new Set(['anthropic', 'adversarial', 'impact', 'glm', 'local']);
const VERDICT_FILENAME_RE = /^(.+)\.(\d+)\.(.+)\.verdict$/;
const REQUIRED_VERDICT_HEADERS = ['VERDICT', 'CHECKER', 'FAMILY', 'TASK', 'ATTEMPT'];

// ---------------------------------------------------------------------------
// small fs helpers (all synchronous, all tolerant of missing files/dirs)
// ---------------------------------------------------------------------------

function readFileIfExists(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

function listDirIfExists(dirPath) {
  try {
    return fs.readdirSync(dirPath);
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// ledger.tsv
// ---------------------------------------------------------------------------

function parseLedger(swarmDir, errors) {
  const filePath = path.join(swarmDir, 'ledger.tsv');
  const content = readFileIfExists(filePath);
  const rows = [];
  if (content === null) return rows;

  const lines = content.split(/\r?\n/);
  lines.forEach((rawLine, idx) => {
    const lineNo = idx + 1;
    if (rawLine === '' || rawLine.startsWith('#')) return;

    const fields = rawLine.split('\t');
    if (fields.length !== 7) {
      errors.push({
        file: 'ledger.tsv',
        message: `line ${lineNo}: expected 7 tab-separated fields, got ${fields.length}`,
      });
      return;
    }

    const [id, tierRaw, checksRaw, status, attemptRaw, worker, reason] = fields;

    if (!/^[123]$/.test(tierRaw)) {
      errors.push({ file: 'ledger.tsv', message: `line ${lineNo}: bad tier '${tierRaw}'` });
      return;
    }
    if (!/^\d+$/.test(attemptRaw)) {
      errors.push({ file: 'ledger.tsv', message: `line ${lineNo}: bad attempt '${attemptRaw}'` });
      return;
    }

    const checks = checksRaw === '-' || checksRaw === '' ? [] : checksRaw.split(',');

    rows.push({
      id,
      tier: Number.parseInt(tierRaw, 10),
      checks,
      status,
      attempt: Number.parseInt(attemptRaw, 10),
      worker,
      reason,
    });
  });

  return rows;
}

// ---------------------------------------------------------------------------
// manifests/<task>.<attempt>.files
// ---------------------------------------------------------------------------

function parseManifest(swarmDir, taskId, attempt) {
  const filePath = path.join(swarmDir, 'manifests', `${taskId}.${attempt}.files`);
  const content = readFileIfExists(filePath);
  if (content === null) return null;
  return content
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

// ---------------------------------------------------------------------------
// verdicts/<task>.<attempt>.<checker>.verdict
// ---------------------------------------------------------------------------

function parseHeaderAndEvidence(content) {
  const lines = content.split('\n');
  let sepIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    // Exact `---` line required (gate.sh uses grep -qx -- '---').
    if (lines[i] === '---') {
      sepIndex = i;
      break;
    }
  }
  const hasSeparator = sepIndex !== -1;
  const headerLines = hasSeparator ? lines.slice(0, sepIndex) : lines;
  const evidence = hasSeparator ? lines.slice(sepIndex + 1).join('\n') : '';

  const headers = {};
  for (const line of headerLines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return { headers, evidence, hasSeparator };
}

/**
 * Validate a verdict against SPEC.md §2a + filename/header agreement.
 * Returns { ok: true, verdict } or { ok: false, message }.
 * Mirrors swarm/gate.sh load_verdict().
 */
function validateVerdictRecord(filename, headers, hasSeparator, fileTask, fileAttempt, fileChecker) {
  if (!hasSeparator) {
    return { ok: false, message: `missing '---' separator` };
  }

  for (const key of REQUIRED_VERDICT_HEADERS) {
    if (headers[key] === undefined || headers[key] === '') {
      return { ok: false, message: `missing ${key}` };
    }
  }

  const verdictValue = headers.VERDICT;
  if (!VALID_VERDICTS.has(verdictValue)) {
    return { ok: false, message: `invalid VERDICT value: ${verdictValue}` };
  }

  const family = headers.FAMILY;
  if (!VALID_FAMILIES.has(family)) {
    return { ok: false, message: `invalid FAMILY value: ${family}` };
  }

  if (!/^\d+$/.test(headers.ATTEMPT)) {
    return { ok: false, message: `invalid ATTEMPT value: ${headers.ATTEMPT}` };
  }

  if (headers.CHECKER !== fileChecker) {
    return {
      ok: false,
      message: `CHECKER '${headers.CHECKER}' != filename checker '${fileChecker}'`,
    };
  }
  if (headers.TASK !== fileTask) {
    return {
      ok: false,
      message: `TASK '${headers.TASK}' != filename task '${fileTask}'`,
    };
  }
  if (headers.ATTEMPT !== String(fileAttempt)) {
    return {
      ok: false,
      message: `ATTEMPT '${headers.ATTEMPT}' != filename attempt '${fileAttempt}'`,
    };
  }

  return {
    ok: true,
    verdict: {
      checker: headers.CHECKER,
      family,
      verdict: verdictValue,
      task: headers.TASK,
      attempt: fileAttempt,
    },
  };
}

// Scans the whole verdicts/ dir once. Returns:
//   byTaskAttempt — Map keyed by `${task}.${attempt}` -> array of verdict
//     objects (all belonging to that task+attempt, any checker). Invalid
//     files are excluded from this map and reported in errors[].
//   filenames — every entry in verdicts/, verbatim, so per-task blocking can
//     later mirror gate.sh's glob semantics (see blockingVerdictFiles).
function parseAllVerdicts(swarmDir, errors) {
  const dirPath = path.join(swarmDir, 'verdicts');
  const filenames = listDirIfExists(dirPath);
  const byTaskAttempt = new Map();

  for (const filename of filenames) {
    const match = VERDICT_FILENAME_RE.exec(filename);
    if (!match) {
      if (filename.endsWith('.verdict')) {
        errors.push({
          file: `verdicts/${filename}`,
          message: `unparseable verdict filename`,
        });
      }
      continue;
    }
    const [, task, attemptStr, checker] = match;
    const attempt = Number.parseInt(attemptStr, 10);

    const filePath = path.join(dirPath, filename);
    const content = readFileIfExists(filePath);
    if (content === null) continue; // vanished between readdir and read; ignore

    const { headers, evidence, hasSeparator } = parseHeaderAndEvidence(content);
    const validated = validateVerdictRecord(
      filename,
      headers,
      hasSeparator,
      task,
      attempt,
      checker
    );

    if (!validated.ok) {
      errors.push({
        file: `verdicts/${filename}`,
        message: validated.message,
      });
      continue; // excluded entirely from quorum
    }

    const verdictObj = {
      checker: validated.verdict.checker,
      family: validated.verdict.family,
      verdict: validated.verdict.verdict,
      task: validated.verdict.task,
      attempt: validated.verdict.attempt,
      evidence,
      path: filePath,
      filename,
    };

    const key = `${task}.${attempt}`;
    if (!byTaskAttempt.has(key)) byTaskAttempt.set(key, []);
    byTaskAttempt.get(key).push(verdictObj);
  }

  return { byTaskAttempt, filenames };
}

// gate.sh walk_verdicts (tiers 2/3) globs `<task>.<attempt>.*.verdict` and
// hard-FAILS the task on ANY matching file it cannot load as a valid verdict
// for exactly that task+attempt — bad headers, filename/header mismatch, an
// unparseable filename, even a perfectly valid verdict belonging to a
// dot-prefix sibling task (task `A.1.b` attempt 2 lands in task A attempt 1's
// glob). Mirror the glob exactly: `*` matches anything, including nothing and
// dots, so match = prefix + suffix without overlap. Anything the glob catches
// that did not validate as this task+attempt's own verdict blocks the task.
// Tier 1 is different — gate.sh only loads the named checkers' exact files —
// so callers must apply this only at tiers 2/3.
function blockingVerdictFiles(filenames, validVerdicts, taskId, attempt) {
  const prefix = `${taskId}.${attempt}.`;
  const suffix = '.verdict';
  const validNames = new Set(validVerdicts.map((v) => v.filename));
  return filenames.filter(
    (fn) =>
      fn.startsWith(prefix) &&
      fn.endsWith(suffix) &&
      fn.length >= prefix.length + suffix.length &&
      !validNames.has(fn)
  );
}

// ---------------------------------------------------------------------------
// flags/<task>.flag
// ---------------------------------------------------------------------------

function parseFlag(swarmDir, taskId, ledgerTier) {
  const filePath = path.join(swarmDir, 'flags', `${taskId}.flag`);
  const content = readFileIfExists(filePath);
  if (content === null) return null;

  const lines = content.split(/\r?\n/);
  let targetTier = null;
  let reason = null;
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key === 'TARGET_TIER') targetTier = Number.parseInt(value, 10);
    else if (key === 'REASON') reason = value;
  }

  if (targetTier === null || Number.isNaN(targetTier)) return null;

  // A flag is OPEN only if ledger tier < target tier; otherwise it is
  // resolved and treated as absent.
  if (!(ledgerTier < targetTier)) return null;

  return { targetTier, reason };
}

// ---------------------------------------------------------------------------
// tier3/<task>/report.md
// ---------------------------------------------------------------------------

function splitTableRow(line) {
  let trimmed = line.trim();
  if (trimmed.startsWith('|')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('|')) trimmed = trimmed.slice(0, -1);
  return trimmed.split('|').map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

function parseTier3Matrix(content) {
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;

    const headerCells = splitTableRow(line);
    const checkColIdx = headerCells.findIndex((c) => c.toLowerCase().includes('check'));
    if (checkColIdx === -1) continue; // not the table we're looking for

    // next non-empty line should be the separator row
    let j = i + 1;
    if (j >= lines.length || !isSeparatorRow(splitTableRow(lines[j].trim()))) {
      continue; // malformed table; skip
    }
    j += 1;

    const otherCols = headerCells
      .map((_, idx) => idx)
      .filter((idx) => idx !== checkColIdx);
    const [aColIdx, bColIdx] = otherCols;

    const matrix = [];
    while (j < lines.length && lines[j].trim().startsWith('|')) {
      const cells = splitTableRow(lines[j].trim());
      const check = cells[checkColIdx] ?? '';
      const a = aColIdx !== undefined ? cells[aColIdx] ?? '' : '';
      const b = bColIdx !== undefined ? cells[bColIdx] ?? '' : '';
      matrix.push({ check, a, b, agree: a === b });
      j += 1;
    }
    return matrix; // first matching table wins
  }
  return [];
}

// Mirrors gate.sh `tail -n1`: a trailing newline does not add an empty last
// line, but any other trailing content (extra blank line, \r) counts as-is.
function lastLine(content) {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines[lines.length - 1];
}

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function parseTier3(swarmDir, taskId, attempt) {
  const dirPath = path.join(swarmDir, 'tier3', taskId);
  if (!isDirectory(dirPath)) return null;

  const reportPath = path.join(dirPath, 'report.md');
  const reportContent = readFileIfExists(reportPath);
  const hasReport = reportContent !== null;
  const content = reportContent ?? '';

  const lines = content.split(/\r?\n/);
  let resolution = null;
  for (const line of lines) {
    if (line.startsWith('RESOLUTION:')) {
      resolution = line.slice('RESOLUTION:'.length).trim();
      break;
    }
  }

  // Oracle-first contract (gate.sh check_tier3, 2026-08-26): only consulted
  // when no report.md exists, but always reported for display.
  const scriptPath = path.join(dirPath, 'accept.sh');
  const logContent = readFileIfExists(path.join(dirPath, `oracle.${attempt}.log`));
  const oracle = {
    scriptExists: fs.existsSync(scriptPath),
    scriptExecutable: isExecutable(scriptPath),
    logExists: logContent !== null,
    oraclePass: logContent !== null && lastLine(logContent) === 'ORACLE PASS',
  };

  return {
    hasReport,
    hasResolution: resolution !== null,
    resolution,
    matrix: parseTier3Matrix(content),
    oracle,
  };
}

// The tier-3 evidence contract (gate.sh check_tier3): a report.md switches the
// directory to the legacy blind-arm contract (RESOLUTION line required, oracle
// ignored); otherwise the oracle contract applies in full.
function tier3ContractOk(tier3) {
  if (!tier3) return false;
  if (tier3.hasReport) return tier3.hasResolution;
  const o = tier3.oracle;
  return o.scriptExists && o.scriptExecutable && o.logExists && o.oraclePass;
}

function tier3ContractReason(tier3) {
  if (!tier3) return 'no tier-3 oracle (accept.sh) and no legacy report.md';
  if (tier3.hasReport) return 'no RESOLUTION line in tier-3 report';
  const o = tier3.oracle;
  if (!o.scriptExists) return 'no tier-3 oracle (accept.sh) and no legacy report.md';
  if (!o.scriptExecutable) return 'tier-3 oracle accept.sh is not executable';
  if (!o.logExists) return 'no oracle run log at the current attempt';
  return 'oracle log does not end with ORACLE PASS';
}

// ---------------------------------------------------------------------------
// spend.jsonl
// ---------------------------------------------------------------------------

function parseSpendRows(swarmDir, errors) {
  const filePath = path.join(swarmDir, 'spend.jsonl');
  const content = readFileIfExists(filePath);
  if (content === null) return null;

  const rows = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    if (line.trim() === '') return;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      errors.push({ file: 'spend.jsonl', message: `line ${idx + 1}: invalid JSON` });
      return;
    }
    if (
      typeof obj.alias !== 'string' ||
      typeof obj.family !== 'string' ||
      typeof obj.prompt_tokens !== 'number' ||
      typeof obj.completion_tokens !== 'number' ||
      typeof obj.cost_usd !== 'number'
    ) {
      errors.push({ file: 'spend.jsonl', message: `line ${idx + 1}: missing/invalid required fields` });
      return;
    }
    rows.push(obj);
  });

  return rows;
}

function buildSpend(rows, acceptedCount) {
  if (rows === null) return null;

  const total = rows.reduce((sum, r) => sum + r.cost_usd, 0);

  const aliasMap = new Map();
  for (const r of rows) {
    const tokens = r.prompt_tokens + r.completion_tokens;
    if (!aliasMap.has(r.alias)) {
      aliasMap.set(r.alias, { alias: r.alias, family: r.family, tokens: 0, cost: 0 });
    }
    const entry = aliasMap.get(r.alias);
    entry.tokens += tokens;
    entry.cost += r.cost_usd;
  }
  const perAlias = Array.from(aliasMap.values());

  const tierMap = new Map();
  for (const r of rows) {
    if (r.tier === null || r.tier === undefined) continue;
    if (!tierMap.has(r.tier)) tierMap.set(r.tier, { cost: 0, tasks: new Set() });
    const entry = tierMap.get(r.tier);
    entry.cost += r.cost_usd;
    if (r.task !== null && r.task !== undefined) entry.tasks.add(r.task);
  }
  const perTier = Array.from(tierMap.entries()).map(([tier, v]) => ({
    tier,
    tasks: v.tasks.size,
    avgCost: v.tasks.size === 0 ? null : v.cost / v.tasks.size,
  }));

  const verificationCost = rows
    .filter((r) => r.alias.startsWith('checker-') || r.alias.startsWith('judge-'))
    .reduce((sum, r) => sum + r.cost_usd, 0);
  const disputeOverhead = rows
    .filter((r) => r.alias.startsWith('judge-'))
    .reduce((sum, r) => sum + r.cost_usd, 0);
  const localTokens = rows
    .filter((r) => r.family === 'local')
    .reduce((sum, r) => sum + r.prompt_tokens + r.completion_tokens, 0);

  const derived = {
    perAcceptedTask: acceptedCount > 0 ? total / acceptedCount : null,
    verificationSharePct: total > 0 ? Math.round((verificationCost / total) * 100) : 0,
    disputeOverhead,
    localTokens,
  };

  return { total, perAlias, perTier, derived };
}

// ---------------------------------------------------------------------------
// derived.state — the anti-lie computation
// ---------------------------------------------------------------------------

/**
 * Count judge votes with unique CHECKER and FAMILY identities (mirrors gate.sh).
 * Duplicate judge checker or family identities are ignored for vote tallies and
 * surface as schema/identity problems via errors when the ledger claims accepted.
 */
function tallyJudges(verdicts) {
  const seenChecker = new Set();
  const seenFamily = new Set();
  let ups = 0;
  let ovs = 0;
  let identityError = null;

  for (const v of verdicts) {
    if (v.verdict !== 'UPHOLD' && v.verdict !== 'OVERRULE') continue;
    if (seenChecker.has(v.checker)) {
      identityError = identityError || `duplicate judge identity '${v.checker}'`;
      continue;
    }
    if (seenFamily.has(v.family)) {
      identityError = identityError || `duplicate judge family '${v.family}'`;
      continue;
    }
    seenChecker.add(v.checker);
    seenFamily.add(v.family);
    if (v.verdict === 'UPHOLD') ups += 1;
    else ovs += 1;
  }
  return { ups, ovs, identityError };
}

function computeQuorum(tier, checks, verdicts, tier3, hasFail, disputeResolved, majorityOverrule) {
  if (tier === 1) {
    if (checks.length === 0) return true;
    return checks.every((c) =>
      verdicts.some((v) => v.checker === `checker-${c}` && v.verdict === 'PASS')
    );
  }

  // Only validated verdicts reach this point (invalid files were excluded in
  // parseAllVerdicts; at tiers 2/3 computeDerived separately voids the quorum
  // when any current-attempt file failed validation, mirroring walk_verdicts'
  // hard fail). Any FAIL at the attempt replaces the PASS requirement with
  // the judge-panel quorum — at both tiers (gate.sh walk_verdicts).
  const passCheckers = new Set();
  const familiesPassed = new Set();
  for (const v of verdicts) {
    if (v.verdict !== 'PASS' || !v.family) continue;
    if (passCheckers.has(v.checker)) continue; // unique checker for PASS
    passCheckers.add(v.checker);
    familiesPassed.add(v.family);
  }
  const disputeQuorum = disputeResolved && majorityOverrule;

  if (tier === 2) {
    // Lean tier-2 contract (gate.sh check_tier2, 2026-08-31): PASS from every
    // checker named in the ledger checks column; an empty column is a hard
    // error; the two-lane span applies only when `second` is among the names.
    if (checks.length === 0) return false;
    if (hasFail) return disputeQuorum;
    if (!checks.every((c) => passCheckers.has(`checker-${c}`))) return false;
    if (checks.includes('second') && familiesPassed.size < 2) return false;
    return true;
  }

  // Tier 3 (gate.sh check_tier3): evidence contract first, then the
  // unconditional dual-lane quorum regardless of the checks column.
  const baseQuorum = hasFail ? disputeQuorum : familiesPassed.size >= 2;
  return tier3ContractOk(tier3) && baseQuorum;
}

function computeDerived(task, verdicts, flagOpen) {
  const hasFail = verdicts.some((v) => v.verdict === 'FAIL');
  const { ups, ovs, identityError } = tallyJudges(verdicts);

  const disputeOpen = hasFail && ups + ovs < 3;
  const disputeResolved = hasFail && ups + ovs >= 3;
  const majorityOverrule = disputeResolved && ovs > ups;
  const majorityUphold = disputeResolved && !majorityOverrule;

  const familiesPassed = Array.from(
    new Set(verdicts.filter((v) => v.verdict === 'PASS' && v.family).map((v) => v.family))
  );
  const isDispute = hasFail;

  let quorumHolds = computeQuorum(
    task.tier,
    task.checks,
    verdicts,
    task.tier3,
    hasFail,
    disputeResolved,
    majorityOverrule
  );
  // A dispute resolved only with duplicate judge identities is not a real quorum.
  if (hasFail && identityError) quorumHolds = false;
  // gate.sh walk_verdicts fails the whole task on any current-attempt file it
  // cannot validate (tiers 2/3 only — tier 1 loads only the named checkers'
  // files, so a stray malformed file does not block there).
  const invalidBlocking = task.tier >= 2 && task.invalidVerdicts.length > 0;
  if (invalidBlocking) quorumHolds = false;

  let state;
  let mismatch = null;

  // Mirror gate.sh cmd_check precedence: an OPEN escalation flag is checked
  // *before* tier acceptance and blocks 'accepted' outright, even when a
  // genuine PASS-quorum exists for the current attempt.
  if (flagOpen && task.status === 'accepted') {
    state = 'flagged';
    mismatch = `task ${task.id}: ledger says accepted but escalation flag open (target tier ${task.flag.targetTier})`;
  } else if (task.status === 'accepted') {
    if (quorumHolds) {
      state = 'accepted';
    } else {
      state = 'blocked';
      let reason;
      const missingChecker =
        task.tier === 2 && !hasFail
          ? task.checks.find(
              (c) => !verdicts.some((v) => v.checker === `checker-${c}` && v.verdict === 'PASS')
            )
          : undefined;
      if (task.tier === 3 && !tier3ContractOk(task.tier3)) {
        // gate.sh checks the tier-3 evidence contract before the quorum walk.
        reason = tier3ContractReason(task.tier3);
      } else if (task.tier === 2 && task.checks.length === 0) {
        // gate.sh check_tier2 fails on an empty checks column before walking
        // any verdict files, so this outranks invalid-file blocking too.
        reason = 'tier 2 requires named checkers in the ledger checks column';
      } else if (invalidBlocking) {
        reason = `invalid verdict file(s) at attempt ${task.attempt}: ${task.invalidVerdicts.join(', ')}`;
      } else if (identityError) {
        reason = identityError;
      } else if (disputeOpen) {
        reason = `open dispute (${ups} uphold / ${ovs} overrule, need >=3 judges)`;
      } else if (majorityUphold) {
        reason = `judges upheld the FAIL (${ovs} overrule / ${ups} uphold)`;
      } else if (hasFail) {
        reason = 'unresolved FAIL in current-attempt verdicts';
      } else if (task.tier === 1) {
        reason = 'not all required checkers returned PASS';
      } else if (missingChecker !== undefined) {
        reason = `missing PASS from checker-${missingChecker}`;
      } else if (task.tier === 2) {
        reason = `checks include 'second' but PASSes span ${familiesPassed.length} lane(s), need 2`;
      } else {
        reason = `only ${familiesPassed.length} distinct family PASS(es), need 2`;
      }
      mismatch = `task ${task.id}: ledger says accepted but ${reason}`;
    }
  } else if (majorityUphold) {
    state = 'blocked';
  } else if (disputeOpen) {
    state = 'disputed';
  } else if (flagOpen) {
    state = 'flagged';
  } else if (verdicts.length >= 1) {
    state = 'checking';
  } else {
    state = 'building';
  }

  return {
    derived: { state, familiesPassed, isDispute },
    mismatch,
  };
}

// ---------------------------------------------------------------------------
// main entry point
// ---------------------------------------------------------------------------

export function parse(swarmDir) {
  const errors = [];

  const ledgerRows = parseLedger(swarmDir, errors);
  const { byTaskAttempt: verdictsByTaskAttempt, filenames: verdictFilenames } =
    parseAllVerdicts(swarmDir, errors);

  const tasks = ledgerRows.map((row) => {
    const manifest = parseManifest(swarmDir, row.id, row.attempt);
    const verdicts = verdictsByTaskAttempt.get(`${row.id}.${row.attempt}`) ?? [];
    const flag = parseFlag(swarmDir, row.id, row.tier);
    const tier3 = parseTier3(swarmDir, row.id, row.attempt);
    const invalidVerdicts = blockingVerdictFiles(verdictFilenames, verdicts, row.id, row.attempt);

    const task = {
      id: row.id,
      tier: row.tier,
      checks: row.checks,
      status: row.status,
      attempt: row.attempt,
      worker: row.worker,
      reason: row.reason,
      manifest,
      verdicts,
      invalidVerdicts,
      flag,
      tier3,
      derived: null, // filled below
    };

    const { derived, mismatch } = computeDerived(task, verdicts, flag !== null);
    task.derived = derived;
    if (mismatch) errors.push({ file: 'ledger.tsv', message: mismatch });

    return task;
  });

  const summary = {
    accepted: 0,
    inVerification: 0,
    disputed: 0,
    flagsOpen: 0,
    byTier: { '1': 0, '2': 0, '3': 0 },
  };

  for (const task of tasks) {
    summary.byTier[String(task.tier)] = (summary.byTier[String(task.tier)] ?? 0) + 1;
    if (task.derived.state === 'accepted') summary.accepted += 1;
    if (task.derived.state === 'checking' || task.derived.state === 'disputed') {
      summary.inVerification += 1;
    }
    if (task.derived.state === 'disputed') summary.disputed += 1;
    if (task.flag) summary.flagsOpen += 1;
  }

  const spendRows = parseSpendRows(swarmDir, errors);
  const acceptedCount = tasks.filter((t) => t.derived.state === 'accepted').length;
  const spend = buildSpend(spendRows, acceptedCount);

  return { tasks, summary, spend, errors };
}
