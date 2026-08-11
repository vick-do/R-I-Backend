const Metric = require('../models/Metric.model');
const Dimension = require('../models/Dimension.model');
const Fact = require('../models/Fact.model');
const { readText, readNumber, columnLetter, columnIndex, sourceRef } = require('../utils/workbook');
const { parsePeriodLabel, buildPeriod, yearFromText } = require('../utils/period');
const { buildDimensionFields, slugify } = require('../utils/dimensions');
const facts = require('./facts.service');

/**
 * Spreadsheet import.
 *
 * Turns a mapped worksheet into candidate facts, without writing anything.
 * Callers run `plan()` to preview, then `commit()` to persist. Every stage is
 * reversible and every produced fact carries a `file › sheet › cell` reference.
 */

const DEFAULT_TOTAL_LABELS = ['total', 'totals', 'grand total', 'sum', 'overall'];

function normalizeLabel(text) {
  return String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Builds a lookup from every known spelling of a metric onto its document. */
function buildMetricIndex(metrics) {
  const index = new Map();
  for (const metric of metrics) {
    const spellings = [metric.key, metric.label, ...(metric.aliases ?? [])];
    for (const spelling of spellings) {
      const norm = normalizeLabel(spelling);
      // First writer wins, so a metric's own key/label beats another's alias.
      if (norm && !index.has(norm)) index.set(norm, metric);
    }
  }
  return index;
}

function buildDimensionIndex(dimensions) {
  return new Map(dimensions.map((d) => [d.name, d]));
}

/**
 * Resolves a raw dimension label onto a canonical value, adding it when the
 * axis is open.
 *
 * Delegates to the same `resolveOrCreate` the manual entry form uses, so a
 * cohort typed into the form and a cohort read out of a spreadsheet resolve to
 * one value rather than two near-duplicates.
 */
async function resolveDimensionValue(dimension, raw, issues, ref) {
  if (!dimension) return null;

  const resolved = await dimension.resolveOrCreate(raw);

  if (!resolved.value) {
    if (resolved.closed) {
      issues.push({
        severity: 'error',
        message: `"${raw}" is not a recognised ${dimension.label}. Add it to the ${dimension.label} list first, or correct the spelling.`,
        sourceRef: ref,
      });
    }
    return null;
  }

  if (resolved.created) {
    issues.push({
      severity: 'info',
      message: `Added "${resolved.label}" as a new ${dimension.label}.`,
      sourceRef: ref,
    });
  }

  return resolved.value;
}

function isTotalLabel(label, totalRowLabels) {
  const norm = normalizeLabel(label);
  const labels = (totalRowLabels?.length ? totalRowLabels : DEFAULT_TOTAL_LABELS).map(normalizeLabel);
  return labels.some((t) => norm === t || norm.startsWith(`${t} `) || norm.endsWith(` ${t}`));
}

/** Applies the mapping's percent convention so rates are stored consistently. */
function scaleValue(value, metric, percentScale) {
  if (metric.unit !== 'percent') return value;
  return percentScale === 'fraction' ? value * 100 : value;
}

/**
 * Reads a worksheet through a mapping and returns candidate facts plus the
 * stated totals to reconcile against. Nothing is written.
 */
async function extract({ worksheet, mapping, fileName, programId }) {
  const metrics = await Metric.find({ isArchived: false });
  const dimensions = await Dimension.find();
  const metricIndex = buildMetricIndex(metrics);
  const dimensionIndex = buildDimensionIndex(dimensions);

  const candidates = [];
  const statedTotals = [];
  const issues = [];

  const fixedDimensions = mapping.fixedDimensions
    ? Object.fromEntries(
        mapping.fixedDimensions instanceof Map ? mapping.fixedDimensions : Object.entries(mapping.fixedDimensions)
      )
    : {};

  if (mapping.layout === 'crosstab') {
    await extractCrosstab({
      worksheet, mapping, fileName, programId, metricIndex, dimensionIndex,
      fixedDimensions, candidates, statedTotals, issues,
    });
  } else {
    await extractLong({
      worksheet, mapping, fileName, programId, metricIndex, dimensionIndex,
      fixedDimensions, candidates, statedTotals, issues,
    });
  }

  return { candidates, statedTotals, issues };
}

/** One observation per row: each column is a metric, a dimension, or the period. */
async function extractLong({
  worksheet, mapping, fileName, programId, metricIndex, dimensionIndex,
  fixedDimensions, candidates, statedTotals, issues,
}) {
  const headerRow = mapping.headerRow ?? 1;
  const firstDataRow = mapping.firstDataRow ?? headerRow + 1;
  const lastDataRow = mapping.lastDataRow ?? worksheet.rowCount;

  // Resolve header-matched columns to letters once, up front.
  const rules = mapping.columns.map((rule) => {
    if (rule.matchBy !== 'header') return rule;
    for (let c = 1; c <= worksheet.columnCount; c += 1) {
      if (normalizeLabel(readText(worksheet.getCell(headerRow, c))) === normalizeLabel(rule.column)) {
        return { ...rule, column: columnLetter(c) };
      }
    }
    issues.push({ severity: 'warning', message: `Column "${rule.column}" was not found in row ${headerRow}.` });
    return null;
  }).filter(Boolean);

  const metricRules = rules.filter((r) => r.role === 'metric');
  const dimensionRules = rules.filter((r) => r.role === 'dimension');
  const periodRule = rules.find((r) => r.role === 'period');

  for (let row = firstDataRow; row <= lastDataRow; row += 1) {
    const rowDimensions = { ...fixedDimensions };
    let skipRow = false;
    // A row that should carry a dimension but doesn't is a spacer or a stray
    // subtotal. Importing it would produce an unlabelled fact that silently
    // competes with the programme total, so it is skipped.
    let missingDimension = false;

    for (const rule of dimensionRules) {
      const raw = rule.fixedValue ?? readText(worksheet.getCell(`${rule.column}${row}`));
      if (!raw) {
        missingDimension = true;
        continue;
      }
      const ref = sourceRef(fileName, worksheet.name, `${rule.column}${row}`);

      if (isTotalLabel(raw, mapping.totalRowLabels)) {
        skipRow = true; // Stated total — handled per metric below.
        break;
      }

      const value = await resolveDimensionValue(dimensionIndex.get(rule.target), raw, issues, ref);
      if (value) rowDimensions[rule.target] = value;
      else missingDimension = true;
    }

    if (missingDimension && !skipRow) continue;

    let period;
    if (periodRule) {
      const raw = readText(worksheet.getCell(`${periodRule.column}${row}`));
      period = parsePeriodLabel(raw, { defaultYear: mapping.crosstab?.defaultYear ?? yearFromText(fileName) });
    }
    period = period ?? buildPeriod(mapping.defaultPeriod ?? { periodType: 'all_time' });

    for (const rule of metricRules) {
      const address = `${rule.column}${row}`;
      const value = readNumber(worksheet.getCell(address));
      if (value === null) continue;

      const metric = metricIndex.get(normalizeLabel(rule.target)) ?? metricIndex.get(normalizeLabel(rule.column));
      if (!metric) {
        issues.push({
          severity: 'error',
          message: `No metric matches "${rule.target}". Pick one from the metric list or add it first.`,
          sourceRef: sourceRef(fileName, worksheet.name, address),
        });
        continue;
      }

      const scaled = scaleValue(value, metric, mapping.percentScale);
      const ref = sourceRef(fileName, worksheet.name, address);

      if (skipRow) {
        statedTotals.push({ metric, dimensions: rowDimensions, period, value: scaled, sourceRef: ref });
      } else {
        candidates.push({ programId, metric, period, dimensions: rowDimensions, value: scaled, sourceRef: ref });
      }
    }
  }
}

/**
 * Finds an anchor label and derives concrete block coordinates from it, so a
 * mapping survives a block moving between columns or rows from month to month.
 */
function locateAnchoredBlock(worksheet, anchor) {
  const needle = normalizeLabel(anchor.text);
  const maxRow = Math.min(worksheet.rowCount, 200);
  const maxCol = Math.min(worksheet.columnCount, 60);

  for (let r = 1; r <= maxRow; r += 1) {
    for (let c = 1; c <= maxCol; c += 1) {
      if (normalizeLabel(readText(worksheet.getCell(r, c))) !== needle) continue;

      const labelCol = c + (anchor.labelColumnOffset ?? 0);
      const dataCol = c + (anchor.dataColumnOffset ?? 1);
      return {
        headerRow: r + (anchor.headerRowOffset ?? 1),
        firstDataRow: r + (anchor.firstDataRowOffset ?? 2),
        lastDataRow: r + (anchor.lastDataRowOffset ?? 12),
        labelColumn: columnLetter(labelCol),
        firstDataColumn: columnLetter(dataCol),
        lastDataColumn: columnLetter(dataCol),
      };
    }
  }

  return null;
}

/**
 * Metrics down a label column, periods (or dimension values) across a header
 * row. The block is melted into one fact per populated cell.
 */
async function extractCrosstab({
  worksheet, mapping, fileName, programId, metricIndex, dimensionIndex,
  fixedDimensions, candidates, statedTotals, issues,
}) {
  let ct = mapping.crosstab ?? {};

  if (ct.anchor?.text) {
    const located = locateAnchoredBlock(worksheet, ct.anchor);
    if (!located) {
      issues.push({
        severity: 'error',
        message: `Could not find "${ct.anchor.text}" anywhere in sheet "${worksheet.name}". The sheet may have been restructured.`,
      });
      return;
    }
    ct = { ...ct, ...located };
  }

  const headerRow = ct.headerRow;
  const labelCol = columnIndex(ct.labelColumn);
  const firstRow = ct.firstDataRow ?? headerRow + 1;
  const lastRow = ct.lastDataRow ?? worksheet.rowCount;
  const firstCol = ct.firstDataColumn ? columnIndex(ct.firstDataColumn) : labelCol + 1;
  const lastCol = ct.lastDataColumn ? columnIndex(ct.lastDataColumn) : worksheet.columnCount;
  const defaultYear = ct.defaultYear ?? yearFromText(fileName);

  if (!headerRow || !ct.labelColumn) {
    issues.push({
      severity: 'error',
      message: 'A cross-tab mapping needs both a header row and a label column.',
    });
    return;
  }

  // Resolve the header axis once — each column means the same thing all the way down.
  const headers = new Map();
  const headerDimension = ct.headerRole === 'dimension' ? dimensionIndex.get(ct.headerDimension) : null;

  // A single value column belonging to the mapping's default period — the
  // vertical "metric name / value" block. Several such columns would all claim
  // the same coordinate, so that is rejected rather than silently collapsed.
  if (ct.headerRole === 'none') {
    if (lastCol > firstCol) {
      issues.push({
        severity: 'error',
        message: `This block has more than one value column (${ct.firstDataColumn}–${ct.lastDataColumn}). Give the columns a period or dimension meaning, or narrow the range to one column.`,
      });
      return;
    }
    headers.set(firstCol, { kind: 'default' });
  }

  for (let c = firstCol; ct.headerRole !== 'none' && c <= lastCol; c += 1) {
    const raw = readText(worksheet.getCell(headerRow, c));
    if (!raw) continue;
    const ref = sourceRef(fileName, worksheet.name, `${columnLetter(c)}${headerRow}`);

    if (ct.headerRole === 'dimension') {
      const value = await resolveDimensionValue(headerDimension, raw, issues, ref);
      if (value) headers.set(c, { kind: 'dimension', name: ct.headerDimension, value });
      continue;
    }

    // A "TOTAL" column in a period axis restates the row — keep it for
    // reconciliation rather than importing it as another period.
    if (isTotalLabel(raw, mapping.totalRowLabels)) {
      headers.set(c, { kind: 'total' });
      continue;
    }

    const period = parsePeriodLabel(raw, { defaultYear });
    if (period) {
      headers.set(c, { kind: 'period', period });
    } else {
      issues.push({
        severity: 'warning',
        message: `Column ${columnLetter(c)} header "${raw}" is not a period — that column was skipped.`,
        sourceRef: ref,
      });
    }
  }

  if (headers.size === 0) {
    issues.push({
      severity: 'error',
      message: `No usable column headers were found in row ${headerRow}.`,
    });
    return;
  }

  const fallbackPeriod = buildPeriod(mapping.defaultPeriod ?? { periodType: 'all_time' });

  for (let row = firstRow; row <= lastRow; row += 1) {
    const label = readText(worksheet.getCell(row, labelCol));
    if (!label) continue;

    const metric = metricIndex.get(normalizeLabel(label));
    if (!metric) continue; // Section headings and blank rows fall through harmlessly.

    for (const [col, header] of headers) {
      const address = `${columnLetter(col)}${row}`;
      const value = readNumber(worksheet.getCell(row, col));
      if (value === null) continue;

      const scaled = scaleValue(value, metric, mapping.percentScale);
      const ref = sourceRef(fileName, worksheet.name, address);
      const dimensions = { ...fixedDimensions };
      let period = fallbackPeriod;

      if (header.kind === 'period') {
        period = header.period;
      } else if (header.kind === 'dimension') {
        dimensions[header.name] = header.value;
      } else if (header.kind === 'total') {
        statedTotals.push({ metric, dimensions, period: fallbackPeriod, value: scaled, sourceRef: ref });
        continue;
      }

      candidates.push({ programId, metric, period, dimensions, value: scaled, sourceRef: ref });
    }
  }
}

/**
 * Compares candidates against what is already stored and reconciles them
 * against the sheet's own stated totals. Read-only — this is the dry run.
 */
async function plan({ worksheet, mapping, fileName, programId }) {
  const { candidates, statedTotals, issues } = await extract({ worksheet, mapping, fileName, programId });

  const diff = { created: [], updated: [], unchanged: [], conflicts: [] };
  const seen = new Map();

  for (const candidate of candidates) {
    const dimFields = buildDimensionFields(candidate.dimensions);
    const coordinate = [
      String(candidate.programId),
      String(candidate.metric._id),
      candidate.period.periodType,
      candidate.period.periodStart?.toISOString() ?? 'null',
      dimFields.dimensionKey,
    ].join('::');

    // Two cells in the same sheet claiming the same coordinate is a source
    // error worth surfacing, not something to silently last-write-wins.
    if (seen.has(coordinate)) {
      const first = seen.get(coordinate);
      if (first.value !== candidate.value) {
        diff.conflicts.push({
          ...summarise(candidate, dimFields),
          message: `This figure appears twice in the sheet with different values (${first.value} at ${first.sourceRef}, ${candidate.value} here).`,
        });
      }
      continue;
    }
    seen.set(coordinate, candidate);

    const existing = await Fact.findOne({
      program: candidate.programId,
      metric: candidate.metric._id,
      periodType: candidate.period.periodType,
      periodStart: candidate.period.periodStart,
      dimensionKey: dimFields.dimensionKey,
      isCurrent: true,
    });

    if (!existing) diff.created.push(summarise(candidate, dimFields));
    else if (existing.value === candidate.value) diff.unchanged.push(summarise(candidate, dimFields));
    else diff.updated.push({ ...summarise(candidate, dimFields), previousValue: existing.value });
  }

  const checks = reconcile(candidates, statedTotals);

  return {
    candidates: [...seen.values()],
    diff,
    checks,
    issues,
    summary: {
      created: diff.created.length,
      updated: diff.updated.length,
      unchanged: diff.unchanged.length,
      conflicts: diff.conflicts.length,
      errors: issues.filter((i) => i.severity === 'error').length,
      checksFailed: checks.filter((c) => c.status === 'fail').length,
    },
  };
}

function summarise(candidate, dimFields) {
  return {
    metric: candidate.metric.key,
    metricLabel: candidate.metric.label,
    period: candidate.period.periodLabel,
    dimensions: dimFields.dimensions,
    value: candidate.value,
    sourceRef: candidate.sourceRef,
  };
}

/**
 * Checks each total the spreadsheet states against the sum of the leaf facts
 * we are importing. Stated totals are never stored — this is what they are for.
 */
function reconcile(candidates, statedTotals) {
  return statedTotals.map((stated) => {
    const siblings = candidates.filter(
      (c) =>
        String(c.metric._id) === String(stated.metric._id) &&
        c.period.periodType === stated.period.periodType &&
        (c.period.periodStart?.getTime() ?? null) === (stated.period.periodStart?.getTime() ?? null)
    );

    const actual = siblings.reduce((sum, c) => sum + c.value, 0);
    const difference = Number((actual - stated.value).toFixed(6));
    // Tolerate float dust on percentages; anything else is a genuine mismatch.
    const status = Math.abs(difference) < 0.005 ? 'pass' : 'fail';

    return {
      label: `${stated.metric.label} — ${stated.period.periodLabel}`,
      expected: stated.value,
      actual,
      difference,
      status,
      sourceRef: stated.sourceRef,
    };
  });
}

/** Persists a previously planned import as one reversible batch. */
async function commit({ planResult, batch, user, session = null }) {
  let created = 0;
  let updated = 0;

  for (const candidate of planResult.candidates) {
    const { outcome } = await facts.writeFact({
      program: candidate.programId,
      metric: candidate.metric,
      period: candidate.period,
      dimensions: candidate.dimensions,
      value: candidate.value,
      source: 'import',
      sourceRef: candidate.sourceRef,
      batch: batch._id,
      user,
      session,
    });

    if (outcome === 'created') created += 1;
    if (outcome === 'updated') updated += 1;
  }

  return { created, updated };
}

/**
 * Undoes a batch: removes the facts it wrote and restores whatever each of
 * them superseded, so the data returns to its exact pre-import state.
 */
async function rollback({ batch, user }) {
  const written = await Fact.find({ batch: batch._id }).sort({ version: -1 });

  let restored = 0;
  for (const fact of written) {
    if (fact.supersedes) {
      const previous = await Fact.findById(fact.supersedes);
      // Only restore versions this batch did not itself write, otherwise a
      // re-imported coordinate would resurrect an intermediate value.
      if (previous && String(previous.batch ?? '') !== String(batch._id)) {
        previous.isCurrent = true;
        await previous.save();
        restored += 1;
      }
    }
    await Fact.deleteOne({ _id: fact._id });
  }

  batch.status = 'rolled_back';
  batch.rolledBackAt = new Date();
  batch.rolledBackBy = user?._id ?? user ?? null;
  await batch.save();

  return { removed: written.length, restored };
}

/**
 * Proposes a mapping for a sheet the operator has not seen before.
 *
 * The suggestion is always shown for confirmation, never applied silently —
 * the point is to reduce a 30-column mapping exercise to a review, not to
 * guess at the data unsupervised.
 */
async function suggestMapping({ worksheet, fileName }) {
  const metrics = await Metric.find({ isArchived: false });
  const metricIndex = buildMetricIndex(metrics);
  const defaultYear = yearFromText(worksheet.name) ?? yearFromText(fileName);

  const scanRows = Math.min(worksheet.rowCount, 40);
  const scanCols = Math.min(worksheet.columnCount, 40);

  // A cross-tab is identifiable by a row carrying several period labels.
  let best = null;
  for (let r = 1; r <= scanRows; r += 1) {
    let periodCols = 0;
    let firstPeriodCol = null;
    let lastPeriodCol = null;

    for (let c = 1; c <= scanCols; c += 1) {
      const text = readText(worksheet.getCell(r, c));
      if (!text) continue;
      if (parsePeriodLabel(text, { defaultYear })) {
        periodCols += 1;
        firstPeriodCol = firstPeriodCol ?? c;
        lastPeriodCol = c;
      }
    }

    if (periodCols >= 3 && (!best || periodCols > best.periodCols)) {
      best = { row: r, periodCols, firstPeriodCol, lastPeriodCol };
    }
  }

  if (best) {
    // The label column is whichever column to the left of the period block
    // contains the most recognisable metric names.
    let labelCol = 1;
    let bestHits = -1;
    for (let c = 1; c < best.firstPeriodCol; c += 1) {
      let hits = 0;
      for (let r = best.row + 1; r <= scanRows; r += 1) {
        if (metricIndex.has(normalizeLabel(readText(worksheet.getCell(r, c))))) hits += 1;
      }
      if (hits > bestHits) {
        bestHits = hits;
        labelCol = c;
      }
    }

    return {
      confidence: bestHits > 0 ? 'high' : 'low',
      layout: 'crosstab',
      crosstab: {
        headerRow: best.row,
        labelColumn: columnLetter(labelCol),
        firstDataRow: best.row + 1,
        lastDataRow: worksheet.rowCount,
        firstDataColumn: columnLetter(best.firstPeriodCol),
        lastDataColumn: columnLetter(best.lastPeriodCol),
        headerRole: 'period',
        defaultYear,
      },
      percentScale: 'fraction',
      notes: [
        `Row ${best.row} looks like a period header (${best.periodCols} periods found).`,
        `Column ${columnLetter(labelCol)} looks like the metric names (${bestHits} recognised).`,
      ],
    };
  }

  // Otherwise treat it as a tidy sheet and map whichever headers we recognise.
  const columns = [];
  const notes = [];
  for (let c = 1; c <= scanCols; c += 1) {
    const header = readText(worksheet.getCell(1, c));
    if (!header) continue;
    const metric = metricIndex.get(normalizeLabel(header));
    if (metric) {
      columns.push({ column: columnLetter(c), matchBy: 'letter', role: 'metric', target: metric.key });
      notes.push(`Column ${columnLetter(c)} "${header}" → ${metric.label}.`);
    }
  }

  return {
    confidence: columns.length > 0 ? 'medium' : 'low',
    layout: 'long',
    headerRow: 1,
    firstDataRow: 2,
    columns,
    percentScale: 'fraction',
    notes: notes.length ? notes : ['No familiar column headers were recognised — map this sheet by hand.'],
  };
}

module.exports = {
  extract,
  plan,
  commit,
  rollback,
  reconcile,
  suggestMapping,
  buildMetricIndex,
  normalizeLabel,
};
