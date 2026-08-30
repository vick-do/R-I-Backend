const Metric = require('../models/Metric.model');
const Dimension = require('../models/Dimension.model');
const Fact = require('../models/Fact.model');
const { readText, readNumber, columnLetter, columnIndex, sourceRef } = require('../utils/workbook');
const { parsePeriodLabel, buildPeriod, yearFromText } = require('../utils/period');
const { buildDimensionFields, slugify } = require('../utils/dimensions');
const facts = require('./facts.service');
const catalogCache = require('./catalog.cache');
const { invalidate: invalidateFigures } = require('../utils/memo');

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
    // The importer just widened the catalog, so anything holding a copy of it
    // is now behind.
    catalogCache.invalidate('dimensions');
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
 * Loads the metric and dimension catalog once, for a caller about to read
 * several blocks off one sheet.
 *
 * `extract` fetches both itself when it is handed nothing, which is right for a
 * single block. A tab with ten of them was fetching the same two collections
 * twenty times over — the dominant cost of a sync that reads a live sheet, and
 * one paid on a background refresh every few minutes.
 */
async function loadCatalog() {
  const [metrics, dimensions] = await Promise.all([
    Metric.find({ isArchived: false }),
    Dimension.find(),
  ]);
  return { metricIndex: buildMetricIndex(metrics), dimensionIndex: buildDimensionIndex(dimensions) };
}

/**
 * Reads a worksheet through a mapping and returns candidate facts plus the
 * stated totals to reconcile against. Nothing is written.
 */
async function extract({ worksheet, mapping, fileName, programId, catalog }) {
  const { metricIndex, dimensionIndex } = catalog ?? (await loadCatalog());

  const candidates = [];
  const statedTotals = [];
  const issues = [];

  const fixedDimensions = mapping.fixedDimensions
    ? Object.fromEntries(
        mapping.fixedDimensions instanceof Map ? mapping.fixedDimensions : Object.entries(mapping.fixedDimensions)
      )
    : {};

  if (mapping.layout === 'roster') {
    await extractRoster({
      worksheet, mapping, fileName, programId, metricIndex, dimensionIndex,
      fixedDimensions, candidates, statedTotals, issues,
    });
  } else if (mapping.layout === 'crosstab') {
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

  // A tally the sheet states about itself, wherever it sits — Absa's total is
  // in C79, seven rows below the last district. Handled here so every layout
  // can use it rather than only the roster reader.
  for (const cell of mapping.statedTotalCells ?? []) {
    const stated = readNumber(worksheet.getCell(cell));
    if (stated === null) continue;
    const metric = metricIndex.get(normalizeLabel(mapping.statedTotalMetric ?? mapping.metric ?? ''))
      ?? candidates[0]?.metric;
    if (!metric) continue;

    statedTotals.push({
      metric,
      dimensions: { ...fixedDimensions },
      period: candidates[0]?.period ?? buildPeriod(mapping.defaultPeriod ?? { periodType: 'all_time' }),
      value: stated,
      sourceRef: sourceRef(fileName, worksheet.name, cell),
    });
  }

  return { candidates, statedTotals, issues };
}

/**
 * One row per person, counted rather than read.
 *
 * The other layouts read figures a sheet already states. A roster states none —
 * the Hospitality tab is 145 applicants with no tally anywhere — so the figure
 * only exists once the rows are counted. A row counts when its identity column
 * holds something, which is what separates a participant from a spacer or a
 * stray note beneath the table.
 *
 * A block emits exactly one dimension signature: either the overall count, or
 * the count per value of one dimension. Emitting both would hand `reconcile`
 * the same people twice, since it sums every candidate for a metric and period
 * regardless of how they are broken down.
 */
async function extractRoster({
  worksheet, mapping, fileName, programId, metricIndex, dimensionIndex,
  fixedDimensions, candidates, statedTotals, issues,
}) {
  const metric = metricIndex.get(normalizeLabel(mapping.metric));
  if (!metric) {
    issues.push({ severity: 'error', message: `No metric matches "${mapping.metric}".` });
    return;
  }

  const identityCol = mapping.identityColumn;
  if (!identityCol) {
    issues.push({ severity: 'error', message: 'A roster mapping needs an identity column.' });
    return;
  }

  const firstRow = mapping.firstDataRow ?? (mapping.headerRow ?? 1) + 1;
  const lastRow = mapping.lastDataRow ?? worksheet.rowCount;
  const period = buildPeriod(mapping.defaultPeriod ?? { periodType: 'all_time' });
  const groupBy = mapping.groupBy ?? null;
  const dimension = groupBy ? dimensionIndex.get(groupBy.target) : null;

  let counted = 0;
  let unlabelled = 0;
  const groups = new Map();

  for (let row = firstRow; row <= lastRow; row += 1) {
    if (!readText(worksheet.getCell(`${identityCol}${row}`))) continue;
    counted += 1;
    if (!groupBy) continue;

    const raw = readText(worksheet.getCell(`${groupBy.column}${row}`));
    if (!raw) {
      unlabelled += 1;
      continue;
    }

    const ref = sourceRef(fileName, worksheet.name, `${groupBy.column}${row}`);
    const value = await resolveDimensionValue(dimension, raw, issues, ref);
    if (!value) {
      unlabelled += 1;
      continue;
    }
    groups.set(value, (groups.get(value) ?? 0) + 1);
  }

  const ref = sourceRef(fileName, worksheet.name, `${identityCol}${firstRow}:${identityCol}${lastRow}`);

  if (!groupBy) {
    if (counted > 0) {
      candidates.push({ programId, metric, period, dimensions: { ...fixedDimensions }, value: counted, sourceRef: ref });
    }
  } else {
    for (const [value, count] of groups) {
      candidates.push({
        programId, metric, period,
        dimensions: { ...fixedDimensions, [groupBy.target]: value },
        value: count,
        sourceRef: sourceRef(fileName, worksheet.name, `${groupBy.column} (${value})`),
      });
    }
    if (unlabelled > 0) {
      issues.push({
        severity: 'warning',
        message: `${unlabelled} of ${counted} rows have no ${groupBy.target} recorded, so they are absent from that breakdown.`,
        sourceRef: ref,
      });
    }
  }

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

  // A label written once above a run of rows — the Absa sheet names each region
  // on the first of its districts and leaves the rest blank. Carried down, so
  // the run is attributed rather than skipped as unlabelled.
  const carried = new Map();
  const localCandidates = [];

  for (let row = firstDataRow; row <= lastDataRow; row += 1) {
    const rowDimensions = { ...fixedDimensions };
    let skipRow = false;
    // A row that should carry a dimension but doesn't is a spacer or a stray
    // subtotal. Importing it would produce an unlabelled fact that silently
    // competes with the programme total, so it is skipped.
    let missingDimension = false;

    for (const rule of dimensionRules) {
      let raw = rule.fixedValue ?? readText(worksheet.getCell(`${rule.column}${row}`));

      if (rule.fillDown) {
        if (raw) carried.set(rule.target, raw);
        else raw = carried.get(rule.target) ?? '';
      }

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
        localCandidates.push({ programId, metric, period, dimensions: rowDimensions, value: scaled, sourceRef: ref });
      }
    }
  }

  /**
   * Several rows can legitimately land on one coordinate — twenty-nine Greater
   * Accra districts are all "region = greater-accra". Without this they collide
   * and the plan reports them as the same figure claimed twice.
   *
   * Only opt-in: elsewhere a repeated coordinate really is a source error, and
   * silently adding those together is how a total quietly doubles.
   *
   * `sum` adds them; `mean` averages them, for a rate that cannot be added.
   */
  if (mapping.aggregate === 'sum' || mapping.aggregate === 'mean') {
    const merged = new Map();
    for (const candidate of localCandidates) {
      const key = [
        String(candidate.metric._id),
        candidate.period.periodType,
        candidate.period.periodStart?.toISOString() ?? 'null',
        buildDimensionFields(candidate.dimensions).dimensionKey,
      ].join('::');

      const existing = merged.get(key);
      if (existing) {
        existing.value += candidate.value;
        existing.rows += 1;
      } else {
        merged.set(key, { ...candidate, rows: 1 });
      }
    }
    for (const c of merged.values()) {
      // `mean` is what a rate needs: the AI Startup sheet rates confidence in
      // thirty-odd topics per discipline, and the figure for that discipline is
      // their average, not their sum — six 80%s do not make 480%.
      const value = mapping.aggregate === 'mean' ? c.value / c.rows : c.value;
      candidates.push({
        ...c,
        value,
        sourceRef: `${c.sourceRef} (+${c.rows - 1} more)`.replace(' (+0 more)', ''),
      });
    }
    return;
  }

  candidates.push(...localCandidates);
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

  /**
   * Rows normally name the metric. They can instead name a value of one
   * dimension, with the metric fixed for the whole block — which is the shape
   * of the AI Startup satisfaction table, where the months run across the top
   * and Tech / Business / Product run down the side. This mirrors what
   * `headerRole: 'dimension'` already does for the column axis.
   */
  const labelIsDimension = ct.labelRole === 'dimension';
  const labelDimension = labelIsDimension ? dimensionIndex.get(ct.labelDimension) : null;
  const fixedMetric = labelIsDimension ? metricIndex.get(normalizeLabel(ct.metric ?? '')) : null;

  if (labelIsDimension && !fixedMetric) {
    issues.push({
      severity: 'error',
      message: `A cross-tab whose rows are ${ct.labelDimension} values needs a metric of its own; "${ct.metric}" matched none.`,
    });
    return;
  }

  for (let row = firstRow; row <= lastRow; row += 1) {
    const label = readText(worksheet.getCell(row, labelCol));
    if (!label) continue;

    let metric;
    let rowDimensions = null;

    if (labelIsDimension) {
      const ref = sourceRef(fileName, worksheet.name, `${columnLetter(labelCol)}${row}`);
      const value = await resolveDimensionValue(labelDimension, label, issues, ref);
      if (!value) continue; // A heading rather than a row of data.
      metric = fixedMetric;
      rowDimensions = { [ct.labelDimension]: value };
    } else {
      metric = metricIndex.get(normalizeLabel(label));
    }

    if (!metric) continue; // Section headings and blank rows fall through harmlessly.

    for (const [col, header] of headers) {
      const address = `${columnLetter(col)}${row}`;
      const value = readNumber(worksheet.getCell(row, col));
      if (value === null) continue;

      const scaled = scaleValue(value, metric, mapping.percentScale);
      const ref = sourceRef(fileName, worksheet.name, address);
      const dimensions = { ...fixedDimensions, ...(rowDimensions ?? {}) };
      let period = fallbackPeriod;

      if (header.kind === 'period') {
        period = header.period;
      } else if (header.kind === 'dimension') {
        dimensions[header.name] = header.value;
      } else if (header.kind === 'total') {
        // A total at the end of a period axis restates the row across every
        // month in it, so it is reconciled against all of them rather than
        // against the block's fallback period alone.
        const spansPeriods = [...headers.values()].some((h) => h.kind === 'period');
        statedTotals.push({ metric, dimensions, period: fallbackPeriod, value: scaled, sourceRef: ref, spansPeriods });
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
  return diffCandidates({ candidates, statedTotals, issues });
}

/**
 * Compares a set of candidates against what is already stored.
 *
 * Separate from `extract` so a caller holding several blocks can combine their
 * candidates first and diff the result once. A tab whose blocks each describe
 * part of one figure — the AI Startup sheet rates the same discipline in six
 * places — has to be reduced before it is compared, or the same coordinate is
 * diffed six times and the last one silently wins.
 */
async function diffCandidates({ candidates, statedTotals = [], issues = [] }) {
  const diff = { created: [], updated: [], unchanged: [], conflicts: [] };
  const seen = new Map();

  /**
   * Every stored figure these candidates could collide with, fetched once.
   *
   * This used to be one query per candidate. On a sheet of any size that is the
   * dominant cost of a sync — EdTech Mondays plans 370 figures, so a refresh
   * that found nothing changed still cost 370 round trips to the database, and
   * with the refresh now firing when a page is opened it was doing that while
   * someone waited for the page.
   */
  const existingByCoordinate = new Map();
  if (candidates.length > 0) {
    const stored = await Fact.find({
      isCurrent: true,
      program: { $in: [...new Set(candidates.map((c) => String(c.programId)))] },
      metric: { $in: [...new Set(candidates.map((c) => String(c.metric._id)))] },
    })
      .select('program metric periodType periodStart dimensionKey value')
      .lean();

    for (const fact of stored) {
      existingByCoordinate.set(
        [
          String(fact.program),
          String(fact.metric),
          fact.periodType,
          fact.periodStart?.toISOString() ?? 'null',
          fact.dimensionKey ?? '',
        ].join('::'),
        fact
      );
    }
  }

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

    const existing = existingByCoordinate.get(coordinate);

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
 *
 * A total is only compared against the rows it actually claims to cover:
 *
 *   · If it carries dimensions of its own — the EdTech Mondays sheet states one
 *     total per channel and platform — only candidates sharing those values
 *     count. Without this, MEST Facebook's 48 posts would be checked against
 *     every platform's posts added together and could never pass.
 *   · A total sitting at the end of a period axis restates the whole row rather
 *     than any one month, so it is summed across periods. Compared month by
 *     month it would find nothing, because no month is labelled "Total".
 *
 * A total with no dimensions still matches every candidate, which is what the
 * single-figure sheets rely on.
 */
function reconcile(candidates, statedTotals) {
  return statedTotals.map((stated) => {
    const covers = (c) =>
      Object.entries(stated.dimensions ?? {}).every(([name, value]) => c.dimensions?.[name] === value);
    const samePeriod = (c) =>
      c.period.periodType === stated.period.periodType &&
      (c.period.periodStart?.getTime() ?? null) === (stated.period.periodStart?.getTime() ?? null);

    const siblings = candidates.filter(
      (c) =>
        String(c.metric._id) === String(stated.metric._id) &&
        covers(c) &&
        (stated.spansPeriods || samePeriod(c))
    );

    const actual = siblings.reduce((sum, c) => sum + c.value, 0);
    const difference = Number((actual - stated.value).toFixed(6));
    // Tolerate float dust on percentages; anything else is a genuine mismatch.
    const status = Math.abs(difference) < 0.005 ? 'pass' : 'fail';

    return {
      label: [
        stated.metric.label,
        ...Object.values(stated.dimensions ?? {}),
        stated.spansPeriods ? 'all periods' : stated.period.periodLabel,
      ].join(' — '),
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
  // Undoing an import moves figures just as writing them does.
  invalidateFigures('summary::', 'org-totals::', 'scorecard::', 'compare::', 'funnel::');

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
  loadCatalog,
  diffCandidates,
  reconcile,
  plan,
  commit,
  rollback,
  reconcile,
  suggestMapping,
  buildMetricIndex,
  normalizeLabel,
};
