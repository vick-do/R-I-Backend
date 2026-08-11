const { MONTH_LABELS } = require('../utils/period');

/**
 * Mappings for the two existing workbooks.
 *
 * Both files stack many small, unrelated tables into each sheet, so a "sheet"
 * is not the unit of import — a *block* is. Each entry below describes one
 * block: where it sits, which programme and metric it feeds, and which
 * dimension it is broken down by.
 *
 * These double as the seed for saved MappingTemplates, so the same blocks can
 * be re-imported from a refreshed workbook without being re-mapped by hand.
 */

const DATA_SUMMARY = 'Data Summary Sheet.xlsx';
const EDTECH = 'EdTech Mondays Analytics 2026.xlsx';

const ALL_TIME = { periodType: 'all_time' };

/** A vertical "label / value" block: dimension names down one column. */
function breakdown({ name, sheet, program, metric, labelColumn, valueColumn, firstRow, lastRow, dimension }) {
  return {
    name,
    file: DATA_SUMMARY,
    sheet,
    program,
    mapping: {
      layout: 'long',
      headerRow: firstRow - 1,
      firstDataRow: firstRow,
      lastDataRow: lastRow,
      defaultPeriod: ALL_TIME,
      columns: [
        { column: labelColumn, matchBy: 'letter', role: 'dimension', target: dimension },
        { column: valueColumn, matchBy: 'letter', role: 'metric', target: metric },
      ],
    },
  };
}

/** A single cell holding a programme-level total (no breakdown). */
function scalar({ name, sheet, program, metric, column, row }) {
  return {
    name,
    file: DATA_SUMMARY,
    sheet,
    program,
    mapping: {
      layout: 'long',
      headerRow: row - 1,
      firstDataRow: row,
      lastDataRow: row,
      defaultPeriod: ALL_TIME,
      columns: [{ column, matchBy: 'letter', role: 'metric', target: metric }],
    },
  };
}

const dataSummaryBlocks = [
  // ---- Web3 ---------------------------------------------------------------
  // Row 1 reads "Total no of ppl" and is recognised as a stated total, so it
  // reconciles the male/female rows instead of being imported as a fact.
  breakdown({
    name: 'Web3 — learners by gender',
    sheet: 'Web3 sum', program: 'digital-skills-web3', metric: 'learners_total',
    labelColumn: 'A', valueColumn: 'B', firstRow: 1, lastRow: 4, dimension: 'gender',
  }),

  // ---- Pre Mest -----------------------------------------------------------
  scalar({
    name: 'Pre Mest — total learners',
    sheet: 'Pre Mest', program: 'digital-skills-pre-mest', metric: 'learners_total',
    column: 'A', row: 2,
  }),
  breakdown({
    name: 'Pre Mest — learners by gender',
    sheet: 'Pre Mest', program: 'digital-skills-pre-mest', metric: 'learners_total',
    labelColumn: 'C', valueColumn: 'D', firstRow: 2, lastRow: 4, dimension: 'gender',
  }),
  breakdown({
    name: 'Pre Mest — learners by track',
    sheet: 'Pre Mest', program: 'digital-skills-pre-mest', metric: 'learners_total',
    labelColumn: 'A', valueColumn: 'B', firstRow: 15, lastRow: 17, dimension: 'track',
  }),
  scalar({
    name: 'Pre Mest — graduates',
    sheet: 'Pre Mest', program: 'digital-skills-pre-mest', metric: 'graduates',
    column: 'B', row: 28,
  }),

  // ---- Grow ---------------------------------------------------------------
  scalar({
    name: 'Grow — total learners',
    sheet: 'Grow', program: 'digital-skills-grow', metric: 'learners_total',
    column: 'A', row: 4,
  }),
  breakdown({
    name: 'Grow — learners by gender',
    sheet: 'Grow', program: 'digital-skills-grow', metric: 'learners_total',
    labelColumn: 'D', valueColumn: 'E', firstRow: 4, lastRow: 6, dimension: 'gender',
  }),
  breakdown({
    name: 'Grow — learners by hub',
    sheet: 'Grow', program: 'digital-skills-grow', metric: 'learners_total',
    labelColumn: 'H', valueColumn: 'I', firstRow: 4, lastRow: 6, dimension: 'hub',
  }),
  scalar({
    name: 'Grow — total mothers',
    sheet: 'Grow', program: 'digital-skills-grow', metric: 'mothers',
    column: 'K', row: 4,
  }),
  breakdown({
    name: 'Grow — mothers by hub',
    sheet: 'Grow', program: 'digital-skills-grow', metric: 'mothers',
    labelColumn: 'O', valueColumn: 'P', firstRow: 11, lastRow: 14, dimension: 'hub',
  }),
  scalar({
    name: 'Grow — total graduates employed',
    sheet: 'Grow', program: 'digital-skills-grow', metric: 'graduates_employed',
    column: 'N', row: 4,
  }),
  breakdown({
    name: 'Grow — graduates employed by hub',
    sheet: 'Grow', program: 'digital-skills-grow', metric: 'graduates_employed',
    labelColumn: 'O', valueColumn: 'P', firstRow: 25, lastRow: 27, dimension: 'hub',
  }),

  // ---- MEST Scale & Express (note the trailing space in the sheet name) ----
  scalar({
    name: 'MEST Scale — total enterprises',
    sheet: 'MEST Scale & Express ', program: 'venture-support-mest-scale', metric: 'enterprises_total',
    column: 'A', row: 2,
  }),
  breakdown({
    name: 'MEST Scale — enterprises by gender',
    sheet: 'MEST Scale & Express ', program: 'venture-support-mest-scale', metric: 'enterprises_total',
    labelColumn: 'C', valueColumn: 'D', firstRow: 2, lastRow: 4, dimension: 'gender',
  }),
  breakdown({
    name: 'MEST Scale — enterprises by stage',
    sheet: 'MEST Scale & Express ', program: 'venture-support-mest-scale', metric: 'enterprises_total',
    labelColumn: 'A', valueColumn: 'B', firstRow: 15, lastRow: 17, dimension: 'enterprise_stage',
  }),
  breakdown({
    name: 'MEST Scale — enterprises by region',
    sheet: 'MEST Scale & Express ', program: 'venture-support-mest-scale', metric: 'enterprises_total',
    labelColumn: 'A', valueColumn: 'B', firstRow: 29, lastRow: 33, dimension: 'region',
  }),
  breakdown({
    name: 'MEST Scale — enterprises by sector',
    sheet: 'MEST Scale & Express ', program: 'venture-support-mest-scale', metric: 'enterprises_total',
    labelColumn: 'A', valueColumn: 'B', firstRow: 43, lastRow: 52, dimension: 'sector',
  }),
];

/**
 * EdTech Mondays monthly channel totals.
 *
 * Each monthly sheet carries a per-channel summary block whose position drifts
 * between months, so the blocks are located by their anchor label rather than
 * by fixed cell addresses. The block's internal shape is constant:
 *
 *   V6  MEST TOTAL          ← anchor
 *   V7  Metrics   W7 Grand Total
 *   V8  Posts     W8 13
 *   …
 */
const EDTECH_CHANNELS = [
  { anchor: 'MEST TOTAL', channel: 'mest-africa' },
  { anchor: 'CitiFM TOTAL', channel: 'citi-fm' },
];

const EDTECH_MONTHS = [
  { sheet: 'February 2026', year: 2026, month: 2 },
  { sheet: 'March 2026', year: 2026, month: 3 },
  { sheet: 'April 2026', year: 2026, month: 4 },
  { sheet: 'May 2026', year: 2026, month: 5 },
  { sheet: 'June 2026', year: 2026, month: 6 },
  { sheet: 'July 2026', year: 2026, month: 7 },
  { sheet: 'August 2026', year: 2026, month: 8 },
  { sheet: 'September 2026', year: 2026, month: 9 },
  { sheet: 'October 2026', year: 2026, month: 10 },
  { sheet: 'November 2026', year: 2026, month: 11 },
];

const edtechBlocks = EDTECH_MONTHS.flatMap(({ sheet, year, month }) =>
  EDTECH_CHANNELS.map(({ anchor, channel }) => ({
    name: `EdTech Mondays — ${MONTH_LABELS[month - 1]} ${year} — ${channel}`,
    file: EDTECH,
    sheet,
    program: 'ecosystem-edtech-mondays',
    mapping: {
      layout: 'crosstab',
      defaultPeriod: { periodType: 'month', year, month },
      fixedDimensions: { channel },
      crosstab: {
        headerRole: 'none',
        defaultYear: year,
        anchor: {
          text: anchor,
          headerRowOffset: 1,
          firstDataRowOffset: 2,
          lastDataRowOffset: 12,
          labelColumnOffset: 0,
          dataColumnOffset: 1,
        },
      },
    },
  }))
);

module.exports = { dataSummaryBlocks, edtechBlocks, DATA_SUMMARY, EDTECH };
