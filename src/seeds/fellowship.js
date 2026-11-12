/**
 * Where the Mastercard Foundation EdTech Fellowship sits in the consolidated
 * workbook, and how to read it.
 *
 * The tab is a master dashboard: a two-column list down the left, where column
 * B names a figure and column C holds it, and a set of cohort tables down the
 * right. The list mixes counts, currency, free text and section headings, and
 * only some of its rows are figures at all, so every figure is read as a single
 * cell on a known row rather than as a range.
 *
 * This is also the tab that answers one of the Overview's headline questions.
 * "Learners impacted with EdTech solutions" reads from here.
 *
 * Every audience is reported several ways over: a total, a gender split, and a
 * run of inclusion counts — rural, displaced or refugee, living with a
 * disability. Those overlap each other and overlap gender, so they land on
 * their own signature and are never added together.
 *
 * The reach figures are apportioned rather than counted, which is why several
 * arrive fractional. They are stored as the sheet reports them; rounding on
 * import would quietly disagree with the source.
 *
 * The programme targets beside the list are read too, into their own
 * collection rather than into facts — see `TARGETS` at the foot of this file.
 *
 * The per-company learner table (E11:L48) is read on the `cohort` × `company`
 * axes — one figure per company per year, and its all-time total. That
 * signature is its own bucket, so it is never added to the headline total.
 * One cell of the 2024 column (G17, Inspiring Teachers) reads "47%" where a
 * learner count belongs; the row's own total (J17 = 2025 + 2026) shows it is
 * really nothing, so that row is skipped for 2024 rather than read as 47.
 *
 * Still not imported, and worth knowing about:
 *   · per-company female and rural counts (K, L) — a third axis on top of
 *     cohort × company, which the summary does not chart
 *   · investment raised and the free-text rows, which are notes rather than
 *     figures
 */

const SPREADSHEET_ID = '1g_XYCeCXCM5z6O7DELzZ4bQi-SX-JNpPGh1CnoIC0VE';
const TAB = 'Fellowship';
const PROGRAM = 'venture-support-edtech-fellowship';
const ALL_TIME = { periodType: 'all_time' };

const val = (column, metric) => ({ column, matchBy: 'letter', role: 'metric', target: metric });
const dim = (column, target) => ({ column, matchBy: 'letter', role: 'dimension', target });

/** One figure, at one cell, on one row. */
const cell = (name, row, column, metric, fixedDimensions = {}) => ({
  name,
  mapping: {
    layout: 'long', headerRow: 1, firstDataRow: row, lastDataRow: row,
    defaultPeriod: ALL_TIME, aggregate: 'sum', fixedDimensions,
    columns: [val(column, metric)],
  },
});

/** One figure, at one cell, counted against a single year. */
const yearCell = (name, row, column, metric, year, fixedDimensions = {}) => ({
  name,
  mapping: {
    layout: 'long', headerRow: 1, firstDataRow: row, lastDataRow: row,
    defaultPeriod: { periodType: 'year', year }, aggregate: 'sum', fixedDimensions,
    columns: [val(column, metric)],
  },
});

/** A run of rows where one column names the value and another holds the figure. */
const run = (name, first, last, labelColumn, target, valueColumn, metric, fixedDimensions = {}) => ({
  name,
  mapping: {
    layout: 'long', headerRow: 1, firstDataRow: first, lastDataRow: last,
    defaultPeriod: ALL_TIME, aggregate: 'sum', fixedDimensions,
    columns: [dim(labelColumn, target), val(valueColumn, metric)],
  },
});

/**
 * A run of the per-company table: column E holds the cohort number, F the
 * company, and `valueColumn` the learners for `period`.
 */
const companyRun = (name, first, last, valueColumn, period) => ({
  name,
  mapping: {
    layout: 'long', headerRow: 1, firstDataRow: first, lastDataRow: last,
    defaultPeriod: period, aggregate: 'sum', fixedDimensions: {},
    columns: [dim('E', 'cohort'), dim('F', 'company'), val(valueColumn, 'edtech_learners_impacted')],
  },
});

/** Rows of the per-company table, by cohort. Row 48 is its totals row. */
const COMPANY_ROWS = { first: 12, cohort1Last: 23, cohort2Last: 35, last: 47, badRow2024: 17 };

/**
 * One audience, as the sheet reports it: a total, then three gendered rows,
 * then a run of inclusion counts.
 *
 * The block repeats identically for users, learners, active users, active
 * learners, educators and learning outcomes — six times over, at six offsets —
 * which is exactly the kind of thing that goes wrong when it is typed out six
 * times. `first` is the row holding the total; everything else is counted from
 * it, and the anchors below check that the shape still holds.
 */
const audience = (name, first, metric) => [
  cell(`${name} — total`, first, 'C', metric),
  cell(`${name} — male`, first + 1, 'C', metric, { gender: 'male' }),
  cell(`${name} — female`, first + 2, 'C', metric, { gender: 'female' }),
  cell(`${name} — undisclosed`, first + 3, 'C', metric, { gender: 'undisclosed' }),
  cell(`${name} — rural`, first + 4, 'C', metric, { inclusion: 'rural' }),
  cell(`${name} — displaced or refugee`, first + 5, 'C', metric, { inclusion: 'displaced' }),
  cell(`${name} — living with a disability`, first + 6, 'C', metric, { inclusion: 'pwd' }),
];

const BLOCKS = [
  // ---- the fellowship's ventures -----------------------------------------
  cell('Companies in the fellowship', 3, 'F', 'enterprises_total'),
  run('Companies by cohort', 7, 9, 'E', 'cohort', 'G', 'enterprises_total'),
  run('Youth-led companies by cohort', 7, 9, 'E', 'cohort', 'H', 'enterprises_youth_led'),
  // The cohort summary also splits users and female learners by cohort. Both
  // add to the all-time totals on rows 2 and 11, and sit on their own
  // signatures, so neither is added to those totals.
  run('Users by cohort', 7, 9, 'E', 'cohort', 'J', 'users_reached'),
  run('Female learners by cohort', 7, 9, 'E', 'cohort', 'L', 'edtech_learners_impacted', { gender: 'female' }),
  // The rest of the cohort table. Learners by cohort is read as stated (K)
  // rather than summed from the companies, so a cohort page shows the sheet's
  // own figure. Woman-led companies sit on enterprises_total × gender, the same
  // way the portfolio records its female-led businesses.
  run('Learners by cohort', 7, 9, 'E', 'cohort', 'K', 'edtech_learners_impacted'),
  run('Woman-led companies by cohort', 7, 9, 'E', 'cohort', 'I', 'enterprises_total', { gender: 'female' }),
  run('Rural learners by cohort', 7, 9, 'E', 'cohort', 'M', 'edtech_learners_impacted', { inclusion: 'rural' }),
  run('Learners with a disability by cohort', 7, 9, 'E', 'cohort', 'N', 'edtech_learners_impacted', { inclusion: 'pwd' }),
  run('Displaced or refugee learners by cohort', 7, 9, 'E', 'cohort', 'O', 'edtech_learners_impacted', { inclusion: 'displaced' }),

  // Each company's female, rural and disabled learners (K, L, M of the company
  // table), on company × gender / company × inclusion. The company names its
  // cohort already, so a third axis is not needed.
  run('Female learners by company', 12, 47, 'F', 'company', 'K', 'edtech_learners_impacted', { gender: 'female' }),
  run('Rural learners by company', 12, 47, 'F', 'company', 'L', 'edtech_learners_impacted', { inclusion: 'rural' }),
  run('Learners with a disability by company', 12, 47, 'F', 'company', 'M', 'edtech_learners_impacted', { inclusion: 'pwd' }),

  /**
   * Learners, year by year.
   *
   * 2024 and 2025 are the column totals under the per-company table; 2026 comes
   * from the actual stated beside that year's target. They add to 867,411 —
   * exactly the all-time total on row 9 — so the sheet is consistent with
   * itself, and the three years are a true split of it rather than a second
   * count of the same people.
   *
   * The all-time figure still wins wherever both exist, so nothing here is
   * added to it.
   */
  yearCell('Learners — 2024', 48, 'G', 'edtech_learners_impacted', 2024),
  yearCell('Learners — 2025', 48, 'H', 'edtech_learners_impacted', 2025),
  yearCell('Learners — 2026', 60, 'G', 'edtech_learners_impacted', 2026),
  yearCell('Learners — 2026, female', 61, 'G', 'edtech_learners_impacted', 2026, { gender: 'female' }),
  yearCell('Learners — 2026, rural', 62, 'G', 'edtech_learners_impacted', 2026, { inclusion: 'rural' }),
  yearCell('Learners — 2026, disability', 63, 'G', 'edtech_learners_impacted', 2026, { inclusion: 'pwd' }),
  yearCell('Learners — 2026, displaced', 64, 'G', 'edtech_learners_impacted', 2026, { inclusion: 'displaced' }),

  // ---- learners by company ------------------------------------------------
  // Only Cohort 1 ran in 2024, and Cohort 3 only from 2026, so each year reads
  // just the rows that can hold a figure. G17 is the "47%" cell — see the top.
  companyRun('Learners by company — 2024 (a)', COMPANY_ROWS.first, COMPANY_ROWS.badRow2024 - 1, 'G', { periodType: 'year', year: 2024 }),
  companyRun('Learners by company — 2024 (b)', COMPANY_ROWS.badRow2024 + 1, COMPANY_ROWS.cohort1Last, 'G', { periodType: 'year', year: 2024 }),
  companyRun('Learners by company — 2025', COMPANY_ROWS.first, COMPANY_ROWS.cohort2Last, 'H', { periodType: 'year', year: 2025 }),
  companyRun('Learners by company — 2026', COMPANY_ROWS.first, COMPANY_ROWS.last, 'I', { periodType: 'year', year: 2026 }),
  companyRun('Learners by company — all time', COMPANY_ROWS.first, COMPANY_ROWS.last, 'J', ALL_TIME),

  // ---- who the solutions reach -------------------------------------------
  ...audience('Users and customers', 2, 'users_reached'),
  ...audience('Learners', 9, 'edtech_learners_impacted'),
  ...audience('Active users', 16, 'active_users'),
  ...audience('Active learners', 23, 'active_learners'),
  ...audience('Educators trained', 30, 'educators_trained'),
  // Educators are the one audience with a youth count of their own, on the row
  // after the three inclusion rows.
  cell('Educators trained — youth', 37, 'C', 'educators_trained', { inclusion: 'youth' }),
  cell('Educators using EdTech solutions', 38, 'C', 'educators_using_edtech'),

  // ---- evidence of impact -------------------------------------------------
  ...audience('Learners achieving outcomes', 44, 'learners_outcomes'),

  // ---- reach and partnerships --------------------------------------------
  cell('Learning institutions reached', 40, 'C', 'institutions_reached'),
  cell('Partnerships formed', 42, 'C', 'partnerships'),

  // ---- the ventures as employers -----------------------------------------
  cell('Employees hired', 54, 'C', 'employees_hired'),
  cell('Employees hired — women', 55, 'C', 'employees_hired', { gender: 'female' }),
  cell('Employees hired — youth', 56, 'C', 'employees_hired', { inclusion: 'youth' }),
  cell('Employees hired — youth with a disability', 57, 'C', 'employees_hired', { inclusion: 'pwd' }),
  cell('Employees hired — displaced or refugee', 58, 'C', 'employees_hired', { inclusion: 'displaced' }),
  cell('Monthly revenue', 53, 'C', 'monthly_revenue'),
];

/**
 * What each block's cell should still say, so a restructured sheet is caught.
 *
 * Every figure above is a row number, which means one inserted row moves a
 * learner count into an educator's metric without anything looking wrong. These
 * are checked first, and a mismatch stops the import.
 */
const ANCHORS = [
  ['B2', 'Total Number of users'], ['B3', 'Number of males'], ['B4', 'Number of females'],
  ['B6', 'Number in rural areas'],
  ['B9', 'Total Number of learners'], ['B13', 'Number in rural areas'],
  ['B16', 'Total Number of active users'], ['B23', 'Total Number of active learners'],
  ['B30', 'Educators (teachers) trained'], ['B37', 'Number between the ages of 18-35'],
  ['B38', 'Educators (teachers) using EdTech solutions'],
  ['B42', 'Partnerships formed'],
  ['B44', 'Learners who have achieved learning outcomes'],
  ['B53', 'Monthly revenue (GHS)'], ['B54', 'Employees hired'],
  ['B55', 'No. of new women employees hired'],
  ['E3', 'Total Companies'], ['E6', 'Cohort'], ['E7', 'Cohort 1'],
  // The per-company table: its header, its first and last company, and that
  // the cohort boundaries still fall where the year runs above assume.
  ['J6', 'Total users'], ['L6', 'Total Female'], ['E9', 'Cohort 3'],
  ['I6', 'Total Woman Led'], ['K6', 'Total learners'], ['M6', 'Total Rural Learners'],
  ['N6', 'Total Learners with disability'], ['O6', 'Total Refugee/Displaced Learners'],
  ['K11', 'Total Female learners'], ['L11', 'Total Learners in Rural'], ['M11', 'PWD Learners'],
  ['E11', 'Cohort'], ['G11', 'learners 2024'], ['H11', 'Learners 2025'],
  ['I11', 'Learners 2026'], ['J11', 'Total Learners Reached'],
  ['F12', 'Aya Prep'], ['F17', 'Inspiring Teachers'], ['E23', '1'], ['E24', '2'],
  ['E35', '2'], ['E36', '3'], ['E47', '3'], ['E48', ''],
  ['E51', 'Program Targets'], ['E52', 'Metric'], ['E53', 'Total Learners'],
  ['E59', 'Metics'], ['E60', 'Learners'],
];

/**
 * What the fellowship committed to, and what the sheet states it has done.
 *
 * Two tables sit to the right of the list: an all-time set of programme targets
 * on rows 53-57, and a 2026 set on rows 60-64. Column F holds the target and
 * column G the actual the sheet states beside it.
 *
 * The stated actual is carried but never served as the actual — the facts hold
 * that. It is kept so the two can be shown disagreeing, which on row 56 they do:
 * the sheet states 16,684 learners with disabilities, which is its own
 * ACTIVE-learner figure from row 29, where the learner rows say 25,775.
 */
const TARGETS = [
  { row: 53, label: 'Total learners', metric: 'edtech_learners_impacted', dimensions: {} },
  { row: 54, label: 'Female learners', metric: 'edtech_learners_impacted', dimensions: { gender: 'female' } },
  { row: 55, label: 'Rural learners', metric: 'edtech_learners_impacted', dimensions: { inclusion: 'rural' } },
  { row: 56, label: 'Learners with disabilities', metric: 'edtech_learners_impacted', dimensions: { inclusion: 'pwd' } },
  { row: 57, label: 'Displaced and refugee learners', metric: 'edtech_learners_impacted', dimensions: { inclusion: 'displaced' } },

  { row: 60, year: 2026, label: 'Learners', metric: 'edtech_learners_impacted', dimensions: {} },
  { row: 61, year: 2026, label: 'Female learners', metric: 'edtech_learners_impacted', dimensions: { gender: 'female' } },
  { row: 62, year: 2026, label: 'Rural learners', metric: 'edtech_learners_impacted', dimensions: { inclusion: 'rural' } },
  { row: 63, year: 2026, label: 'Learners with disabilities', metric: 'edtech_learners_impacted', dimensions: { inclusion: 'pwd' } },
  { row: 64, year: 2026, label: 'Displaced and refugee learners', metric: 'edtech_learners_impacted', dimensions: { inclusion: 'displaced' } },
];

module.exports = { SPREADSHEET_ID, TAB, PROGRAM, BLOCKS, ANCHORS, TARGETS };
