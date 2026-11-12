/**
 * Seed catalog.
 *
 * Programmes mirror the dashboard navigation tree (frontend src/data/navItems.ts),
 * keyed by the same `pageKey` values so the two stay aligned.
 *
 * Metrics and dimensions are derived from the two source workbooks:
 *   • Data Summary Sheet.xlsx           (Web3, Grow, MEST Scale & Express, Pre Mest)
 *   • EdTech Mondays Analytics 2026.xlsx (monthly + annual social reporting)
 *
 * Aliases are the literal spellings found in those sheets; the importer uses
 * them to auto-suggest a mapping rather than making the user match every column
 * by hand.
 */

// Year nodes ("2026", "2027") are navigation-level period filters, not separate
// programmes. They are seeded as non-reportable so facts always attach to the
// parent programme and are sliced by period at read time.
/**
 * The ten figures every Venture Support page leads with.
 *
 * One row, the same on the roll-up and on each programme under it, so a
 * reader moving between them compares like with like instead of re-reading a
 * different set of cards on every page. A programme that has not reported one
 * of them shows it empty, which is itself worth knowing.
 */
const VENTURE_SUPPORT_CARDS = [
  'enterprises_total', 'jobs_created', 'edtech_learners_impacted', 'educators_trained',
  'users_reached', 'institutions_reached', 'employees_hired', 'partnerships',
  'revenue', 'monthly_revenue',
];

const programs = [
  { pageKey: 'overview', name: 'Overview', category: 'container', isReportable: false },

  { pageKey: 'ai-startup-lab', name: 'AI Startup Lab', category: 'lab',
    metricKeys: [
      'people_trained',
      'satisfaction_general', 'satisfaction_team', 'satisfaction',
      'skill_confidence_before', 'skill_confidence_after',
    ], allowsManualEntry: false,
    description: 'Monthly satisfaction (general, team and by track) and before-and-after skill confidence across the Tech, Business and Product disciplines.' },
  { pageKey: 'ai-startup-lab-2026', name: '2026', parent: 'ai-startup-lab', category: 'container', isReportable: false },
  { pageKey: 'ai-startup-lab-2027', name: '2027', parent: 'ai-startup-lab', category: 'container', isReportable: false },
  { pageKey: 'ai-startup-lab-2028', name: '2028', parent: 'ai-startup-lab', category: 'container', isReportable: false },

  { pageKey: 'portfolio', name: 'Portfolio', category: 'portfolio',
    description: 'Every venture MEST has invested in since inception, and what has been committed and paid out to them.',
    metricKeys: ['enterprises_total', 'amount_invested', 'investment_promised', 'jobs_created'],
    headlineMetricKeys: ['enterprises_total', 'investment_promised', 'amount_invested', 'jobs_created'] },

  /**
   * The five figures MEST X leads with.
   *
   * A roll-up page shows whatever its children recorded, and between them the
   * programmes under MEST X report thirty-odd metrics — a card row that long
   * is a list, not a headline. Naming them here narrows the cards to these
   * five; everything else stays exactly where it was recorded, on the
   * programme page that holds it.
   *
   * This only narrows a page that rolls its figures up from below. A
   * programme holding its own facts shows all of them, listed here or not:
   * hiding part of what a page actually recorded would be a different thing
   * entirely.
   */
  { pageKey: 'mest-x', name: 'MEST X', category: 'container', isReportable: false,
    headlineMetricKeys: ['enterprises_total', 'jobs_created', 'educators_trained', 'partnerships', 'revenue'],
    description: 'Scaling impact through partnerships. A suite of collaborative programmes delivered with global partners to expand access to digital skills, entrepreneurial training and startup acceleration across Africa.' },

  { pageKey: 'digital-skills', name: 'Digital Skills', parent: 'mest-x', category: 'container', isReportable: false },
  { pageKey: 'digital-skills-web3', name: 'Web3', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total'], allowsManualEntry: false },
  { pageKey: 'digital-skills-pre-mest', name: 'Pre-Mest', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total', 'graduates', 'graduation_rate'], allowsManualEntry: false,
    description: 'Over 800 young people trained in web development and digital marketing across six regions of Ghana, half of them women. More than 750 secured dignified work, and some went on to MEST’s flagship programme.' },
  { pageKey: 'digital-skills-grow', name: 'GROW', parent: 'digital-skills', category: 'digital_skills',
    description: 'Ghana Remote and Online Work. Digital skills training for young people, mostly young women, run with Generation, the Mastercard Foundation and Soronko Academy.',
    // `graduates` sits beside `graduates_employed` because the cohort entry form
    // records a plain graduate count, which the summary sheet never stated.
    metricKeys: ['learners_total', 'mothers', 'graduates', 'graduates_employed'] },
  // Cohort-based training programmes with the same shape as the three above:
  // a roster of participants, a gender split, and employment outcomes.
  { pageKey: 'digital-skills-hospitality', name: 'Hospitality', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total', 'graduates_employed'], allowsManualEntry: false,
    description: 'Hospitality and tourism training. Figures are counted from the applicant roster, which states no totals of its own.' },
  // The page key stays `digital-skills-doulogic`: it is the address the URL and
  // every recorded figure's provenance point at, and the programme was seeded
  // under the old misspelling.
  { pageKey: 'digital-skills-doulogic', name: 'DIGILOGIC', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total'], allowsManualEntry: false,
    description: 'An EU-funded initiative connecting African and European startups and SMEs to co-create smart logistics solutions, built around ecosystem collaboration and cross-border innovation. The roster and the tally block in the source sheet disagree, so see Data quality.' },

  { pageKey: 'venture-support', name: 'Venture Support', parent: 'mest-x', category: 'container', isReportable: false,
    headlineMetricKeys: VENTURE_SUPPORT_CARDS },
  { pageKey: 'venture-support-early-stage', name: 'Early stage', parent: 'venture-support', category: 'container', isReportable: false,
    headlineMetricKeys: VENTURE_SUPPORT_CARDS },
  { pageKey: 'venture-support-usl', name: 'USL', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'], headlineMetricKeys: VENTURE_SUPPORT_CARDS },
  { pageKey: 'venture-support-pre-mest', name: 'Pre Mest', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'], isArchived: true },
  { pageKey: 'venture-support-undp', name: 'UNDP-YAI', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'], headlineMetricKeys: VENTURE_SUPPORT_CARDS,
    description: 'Young Africa Innovates, a UNDP and Mastercard Foundation initiative implemented with MEST. It finds and grows innovations from young people to create jobs and strengthen Ghana’s innovation ecosystem, focusing on underrepresented innovators: rural youth, women and people with disabilities.' },
  // The page key stays `venture-support-absa`: it is the address the connected
  // Absa sheet, the URL and every recorded figure's provenance point at.
  //
  // Titled by the partnership everyone knows it by, with what it reports —
  // females supported by MEST — read underneath.
  { pageKey: 'venture-support-absa', name: 'Absa partnership program',
    parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'], headlineMetricKeys: VENTURE_SUPPORT_CARDS,
    description: 'Females supported by MEST. Workshops that help informal businesses and SMEs refine their operations, improve performance and adopt digital solutions suited to their needs.' },
  { pageKey: 'venture-support-mest-express', name: 'MEST Express', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total', 'jobs_created'], headlineMetricKeys: VENTURE_SUPPORT_CARDS,
    description: 'A practical accelerator for early and growth-stage Ghanaian startups, run with the Mastercard Foundation: mentorship, business strategy and equity-free funding. Four of the 88 enterprises later transitioned into MEST Scale and appear in both rosters.' },
  { pageKey: 'venture-support-grow-stage', name: 'Growth stage', parent: 'venture-support', category: 'container', isReportable: false,
    headlineMetricKeys: VENTURE_SUPPORT_CARDS },
  /**
   * The ten Venture Support figures, and the six the fellowship reports that
   * no other programme does. Its page shows the first ten as the row every
   * Venture Support page carries, and reads the rest into panels of its own.
   */
  { pageKey: 'venture-support-edtech-fellowship', name: 'EdTech fellowship', parent: 'venture-support-grow-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'],
    headlineMetricKeys: [
      ...VENTURE_SUPPORT_CARDS,
      'active_users', 'active_learners', 'learners_outcomes', 'educators_using_edtech',
      'enterprises_youth_led',
    ],
    description: 'The Mastercard Foundation EdTech Fellowship, an acceleration programme for promising African EdTech ventures. It gives them business and financial support alongside grounding in the science of learning, to prepare them for scale and sustainability.' },
  { pageKey: 'venture-support-mest-scale', name: 'MEST Scale', parent: 'venture-support-grow-stage', category: 'venture_support',
    metricKeys: ['enterprises_total', 'jobs_created'], headlineMetricKeys: VENTURE_SUPPORT_CARDS,
    description: 'A scale-up accelerator for later-stage tech companies and SMEs in Ghana, covering strategic growth planning, operational optimisation and capital readiness. The 24 enterprises here are counted from the partner roster.' },

  { pageKey: 'ecosystem', name: 'Ecosystem', parent: 'mest-x', category: 'container', isReportable: false },
  { pageKey: 'ecosystem-edtech-mondays', name: 'EdTech Mondays', parent: 'ecosystem', category: 'ecosystem',
    metricKeys: [
      'posts', 'impressions', 'reach', 'engagement', 'reactions', 'comments',
      'shares', 'clicks', 'video_views', 'article_reach',
    ], allowsManualEntry: false,
    description: 'A monthly programme exploring and promoting educational technology in Ghana. It is a platform for educators, EdTech enthusiasts and stakeholders to exchange ideas and collaborate on bringing technology into teaching and learning.' },
  { pageKey: 'ecosystem-edtech-mondays-2026', name: '2026', parent: 'ecosystem-edtech-mondays', category: 'container', isReportable: false },
  { pageKey: 'ecosystem-edtech-mondays-2027', name: '2027', parent: 'ecosystem-edtech-mondays', category: 'container', isReportable: false },
  { pageKey: 'ecosystem-edtech-mondays-2028', name: '2028', parent: 'ecosystem-edtech-mondays', category: 'container', isReportable: false },
];

const PEOPLE_DIMS = ['gender', 'hub', 'cohort', 'track'];
const SOCIAL_DIMS = ['platform', 'channel', 'post_type'];

/**
 * The Overview's seven headline figures, in the order MEST reports them.
 *
 * These are fixed: a headline metric with no data recorded still appears on the
 * Overview, marked as not yet recorded, rather than quietly vanishing. That is
 * the difference between "we have not measured this" and "this is zero".
 */
const metrics = [
  // ---- People -------------------------------------------------------------
  /**
   * A placeholder headcount, typed in rather than imported.
   *
   * The AI Startup Lab sheet states satisfaction and skill confidence but no
   * roster, so nothing on it says how many people the programme trained. This
   * is deliberately NOT `learners_total`: that metric carries
   * `rollsUpToOrgTotal`, and a stand-in figure must not reach the
   * organisation's headline count of people trained. Point the page at
   * `learners_total` once a real roster is connected, and retire this.
   */
  {
    key: 'people_trained', displayOrder: 9, label: 'The number of people trained', category: 'people',
    unit: 'count', aggregation: 'sum',
    description: 'How many people the programme trained. A placeholder on the AI Startup Lab until its roster is connected.',
    allowedDimensions: ['gender', 'cohort', 'discipline'],
    aliases: ['People trained', 'Number of people trained'],
  },
  {
    key: 'learners_total', displayOrder: 10, label: 'Learners trained', category: 'people',
    unit: 'count', aggregation: 'sum', rollsUpToOrgTotal: true,
    headlineOrder: 1, headlineLabel: 'Total no. of people trained',
    allowedDimensions: PEOPLE_DIMS,
    aliases: ['Total Learners', 'Total learners', 'Total no of ppl', 'Total Number of Learners',
      'Total no of people trained', 'Learners', 'Total'],
  },
  {
    key: 'mothers', displayOrder: 40, label: 'Mothers enrolled', category: 'people',
    unit: 'count', aggregation: 'sum',
    allowedDimensions: PEOPLE_DIMS,
    aliases: ['Total Mothers', 'Mothers'],
  },
  {
    key: 'graduates', displayOrder: 20, label: 'Graduates', category: 'people',
    unit: 'count', aggregation: 'sum',
    allowedDimensions: PEOPLE_DIMS,
    aliases: ['Graduated', 'Graduates'],
  },
  // Called "Jobs created" on the Digital Skills pages, which is how the
  // programmes there report it. The key stays `graduates_employed`: it is the
  // coordinate every recorded figure and every sheet mapping points at, and it
  // keeps this apart from `jobs_created`, which counts jobs inside the
  // enterprises Venture Support backs rather than graduates finding work.
  {
    key: 'graduates_employed', displayOrder: 30, label: 'Jobs created', category: 'people',
    unit: 'count', aggregation: 'sum', rollsUpToOrgTotal: true,
    allowedDimensions: PEOPLE_DIMS,
    aliases: ['Graduate employed(Freelance or Full-time)', 'Total Graduate employed(Freelance or Full-time)',
      'Total Number Employed', 'Employed'],
  },
  {
    key: 'graduation_rate', displayOrder: 50, label: 'Graduation rate', category: 'people',
    unit: 'percent', aggregation: 'avg',
    allowedDimensions: PEOPLE_DIMS,
    aliases: ['Graduation rate'],
  },

  /**
   * Reached, and still there.
   *
   * The Fellowship reports every audience twice: everyone it has ever reached,
   * and how many of them were active. Kept as separate metrics rather than as
   * one metric split by a status axis, because the two are not parts of a
   * whole that add up — the active are a subset of the reached, and a chart
   * that stacked them would claim an audience half as large again as the one
   * the sheet reports.
   */
  {
    key: 'active_users', displayOrder: 97.5, label: 'Active users', category: 'people',
    unit: 'count', aggregation: 'sum',
    description: 'Users still active, of everyone the solutions have reached.',
    allowedDimensions: ['gender', 'inclusion', 'cohort'],
    aliases: ['Total Number of active users'],
  },
  {
    key: 'active_learners', displayOrder: 95.5, label: 'Active learners', category: 'people',
    unit: 'count', aggregation: 'sum',
    description: 'Learners still active, of everyone the solutions have reached.',
    allowedDimensions: ['gender', 'inclusion', 'cohort'],
    aliases: ['Total Number of active learners'],
  },
  {
    key: 'learners_outcomes', displayOrder: 95.6, label: 'Learners achieving outcomes', category: 'people',
    unit: 'count', aggregation: 'sum',
    description: 'Learners with evidence of a learning or skills outcome, as the fellowship reports it.',
    allowedDimensions: ['gender', 'inclusion', 'cohort'],
    aliases: ['Learners who have achieved learning outcomes'],
  },
  {
    key: 'educators_using_edtech', displayOrder: 96.5, label: 'Educators using EdTech', category: 'people',
    unit: 'count', aggregation: 'sum',
    description: 'Educators using an EdTech solution, which is more than the number trained on one.',
    allowedDimensions: ['gender', 'inclusion', 'cohort'],
    aliases: ['Educators (teachers) using EdTech solutions'],
  },

  // ---- Enterprise ---------------------------------------------------------
  {
    key: 'enterprises_total', displayOrder: 60, label: 'Enterprises supported', category: 'enterprise',
    unit: 'count', aggregation: 'sum', rollsUpToOrgTotal: true,
    headlineOrder: 2, headlineLabel: 'Total no. of businesses supported',
    allowedDimensions: ['gender', 'enterprise_stage', 'region', 'district', 'sector',
      'hub', 'cohort', 'venture_stage', 'venture_status', 'program_stage', 'open_source', 'company'],
    aliases: ['Total Enterprises', 'Enterprises', 'Businesses supported', 'Total Startups', 'Total startups', 'Total Companies'],
  },

  {
    key: 'enterprises_youth_led', displayOrder: 61, label: 'Youth-led ventures', category: 'enterprise',
    unit: 'count', aggregation: 'sum',
    description: 'Ventures led by someone aged 18 to 35, counted among the enterprises supported rather than beside them.',
    allowedDimensions: ['cohort', 'gender', 'region', 'sector'],
    aliases: ['Total Youth Led', 'Youth led', 'Youth-led companies'],
  },

  // ---- Investment ---------------------------------------------------------
  {
    key: 'jobs_created', displayOrder: 90, label: 'Jobs created', category: 'investment',
    unit: 'count', aggregation: 'sum', rollsUpToOrgTotal: true,
    headlineOrder: 3, headlineLabel: 'Total jobs created',
    allowedDimensions: ['gender', 'region', 'sector', 'hub', 'cohort', 'program_stage'],
    aliases: ['Jobs created', 'Total jobs created', 'SUM of Total Jobs', 'Total Number of Youth in Work Reported'],
  },
  {
    key: 'edtech_learners_impacted', displayOrder: 95, label: 'Learners reached by EdTech solutions',
    category: 'people', unit: 'count', aggregation: 'sum', rollsUpToOrgTotal: true,
    headlineOrder: 4, headlineLabel: 'Learners impacted with EdTech solutions',
    description:
      'End learners reached by EdTech products built or supported by MEST ventures. Distinct from people trained — these are the users of the solutions, not participants in a programme.',
    allowedDimensions: ['region', 'gender', 'inclusion', 'cohort'],
    aliases: ['Learners impacted', 'EdTech learners', 'Learners reached', 'Total Number of learners'],
  },
  {
    key: 'amount_invested', displayOrder: 80, label: 'Amount invested', category: 'investment',
    unit: 'currency', aggregation: 'sum', currency: 'USD', rollsUpToOrgTotal: true,
    headlineOrder: 5, headlineLabel: 'Amount invested',
    description: 'Money actually disbursed to the ventures, which is less than what was promised.',
    allowedDimensions: ['sector', 'region', 'venture_status', 'company'],
    aliases: ['Amount invested', 'Capital deployed', 'Investment', 'Funding Disbursed'],
  },
  /**
   * Committed, as against paid out.
   *
   * The portfolio reports both and they are far apart — $7.2m promised
   * against $4.5m disbursed — because a commitment is drawn down in stages
   * over the life of an investment. Kept as its own metric rather than as a
   * status on `amount_invested`, so nothing can add a promise to a payment
   * and call the result money invested.
   */
  {
    key: 'investment_promised', displayOrder: 79, label: 'Investment promised', category: 'investment',
    unit: 'currency', aggregation: 'sum', currency: 'USD',
    description: 'Money committed to the ventures, whether or not it has been paid out yet.',
    allowedDimensions: ['sector', 'region', 'venture_status', 'company'],
    aliases: ['Investment Promised', 'Funding committed', 'Committed'],
  },
  {
    key: 'edtech_advocacy', displayOrder: 98, label: 'EdTech advocacy initiatives',
    category: 'other', unit: 'count', aggregation: 'sum', rollsUpToOrgTotal: true,
    headlineOrder: 6, headlineLabel: 'EdTech advocacy',
    description:
      'Policy integrations, government partnerships, and ecosystem advocacy initiatives. DEFINITION TO CONFIRM — the previous dashboard quoted both "15 initiatives" and "24 active policy integrations" for this figure.',
    allowedDimensions: ['region'],
    aliases: ['EdTech Advocacy', 'Policy integrations', 'Advocacy initiatives'],
  },
  {
    key: 'venture_acceleration', displayOrder: 70, label: 'Venture acceleration impact',
    category: 'enterprise', unit: 'percent', aggregation: 'avg', rollsUpToOrgTotal: true,
    headlineOrder: 7, headlineLabel: 'Venture acceleration impact',
    description:
      'Share of accelerated ventures meeting their growth milestone. DEFINITION TO CONFIRM — the previous dashboard quoted "82% growth" in one place and "88% graduation rate" in another for the same named figure.',
    allowedDimensions: ['sector', 'enterprise_stage'],
    aliases: ['Venture Acceleration Impact', 'Graduation rate'],
  },

  {
    key: 'educators_trained', displayOrder: 96, label: 'Educators trained', category: 'people',
    unit: 'count', aggregation: 'sum',
    description: 'Teachers and trainers taken through an EdTech programme, as distinct from the learners they go on to reach.',
    allowedDimensions: ['gender', 'inclusion', 'region', 'cohort'],
    aliases: ['Educators (teachers) trained', 'Educators trained'],
  },
  {
    key: 'users_reached', displayOrder: 97, label: 'Users and customers reached', category: 'people',
    unit: 'count', aggregation: 'sum',
    description: 'End users of the products these ventures build. A reach figure reported by the ventures themselves, not a count MEST verified.',
    allowedDimensions: ['gender', 'inclusion', 'region', 'cohort'],
    aliases: ['Total Number of users', 'Total Users/Customers', 'Total number of users'],
  },
  {
    key: 'institutions_reached', displayOrder: 99, label: 'Institutions reached', category: 'other',
    unit: 'count', aggregation: 'sum',
    description: 'Schools and other learning institutions using a solution built by a supported venture.',
    allowedDimensions: ['region'],
    aliases: ['Learning institutions using EdTech solutions/Number of schools (secondary, post-secondary) engaged'],
  },
  {
    key: 'employees_hired', displayOrder: 100, label: 'Employees hired', category: 'enterprise',
    unit: 'count', aggregation: 'sum',
    description: 'People employed by the supported ventures. Distinct from jobs created, which the partner sheets report against the venture rather than the hire.',
    allowedDimensions: ['gender', 'inclusion', 'employment_type', 'cohort'],
    aliases: ['Employees hired', 'Employees Count'],
  },
  {
    key: 'partnerships', displayOrder: 101, label: 'Partnerships formed', category: 'other',
    unit: 'count', aggregation: 'sum',
    allowedDimensions: ['region', 'cohort'],
    aliases: ['Partnerships formed', 'Partnerships'],
  },
  {
    key: 'revenue', displayOrder: 102, label: 'Revenue reported', category: 'investment',
    unit: 'currency', aggregation: 'sum', currency: 'USD',
    description: 'Revenue the supported ventures report to date. Self-reported and unaudited.',
    allowedDimensions: ['hub', 'sector', 'region', 'program_stage', 'cohort'],
    aliases: ['SUM of Total Revenue', 'Total Revenue', 'Revenue'],
  },
  {
    key: 'monthly_revenue', displayOrder: 103, label: 'Monthly revenue', category: 'investment',
    unit: 'currency', aggregation: 'sum', currency: 'GHS',
    description: 'Reported monthly revenue. Kept apart from total revenue so a run rate is never added to a cumulative figure.',
    allowedDimensions: ['hub', 'sector', 'cohort'],
    aliases: ['Monthly revenue (GHS)'],
  },

  /**
   * The AI Startup sheet states satisfaction three times over, under three
   * headings of its own: General (row 4), Team (row 8) and Track (row 12).
   *
   * They are three questions, not one figure read three ways — January is
   * 89.3% general against 67.9% team — so each gets its own metric. Averaging
   * them into one "satisfaction" number would answer a question nobody asked.
   *
   * Only Track carries the discipline axis; the other two are one series each.
   */
  {
    key: 'satisfaction_general', displayOrder: 104, label: 'General satisfaction', category: 'people',
    unit: 'percent', aggregation: 'avg',
    description: 'Overall satisfaction with the programme, as reported in the monthly survey.',
    allowedDimensions: ['cohort', 'gender'],
    aliases: ['General Satisfaction'],
  },
  {
    key: 'satisfaction_team', displayOrder: 105, label: 'Team satisfaction', category: 'people',
    unit: 'percent', aggregation: 'avg',
    description: 'Satisfaction with the programme team, as reported in the monthly survey.',
    allowedDimensions: ['cohort', 'gender'],
    aliases: ['Team Satisfaction'],
  },
  // The key stays `satisfaction`: it is the coordinate the discipline figures
  // already imported are stored against.
  {
    key: 'satisfaction', displayOrder: 106, label: 'Track satisfaction', category: 'people',
    unit: 'percent', aggregation: 'avg',
    description: 'Satisfaction with the track — Tech, Business or Product — as reported in the monthly survey.',
    allowedDimensions: ['discipline', 'cohort', 'gender'],
    aliases: ['Track Satisfaction', 'Satisfaction'],
  },
  // Before and after are separate metrics rather than one metric split by an
  // assessment axis, because a headline card has to state a number somebody can
  // quote. Averaging the two into "skill confidence: 56%" describes nobody: not
  // the people who started, not the people who finished.
  {
    key: 'skill_confidence_before', displayOrder: 107, label: 'Skill confidence — before', category: 'people',
    unit: 'percent', aggregation: 'avg',
    description: 'Self-rated confidence before the teaching, averaged across every topic assessed in a discipline.',
    allowedDimensions: ['discipline', 'cohort'],
    aliases: ['Skill confidence before', 'Confidence before', 'BEFORE'],
  },
  {
    key: 'skill_confidence_after', displayOrder: 108, label: 'Skill confidence — after', category: 'people',
    unit: 'percent', aggregation: 'avg',
    description: 'Self-rated confidence after the teaching, averaged across every topic assessed in a discipline.',
    allowedDimensions: ['discipline', 'cohort'],
    aliases: ['Skill confidence after', 'Confidence after', 'AFTER'],
  },

  // ---- Social / EdTech Mondays -------------------------------------------
  {
    key: 'posts', displayOrder: 150, label: 'Posts', category: 'social', unit: 'count', aggregation: 'sum',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Total Posts', 'Posts', 'No. of Posts'],
  },
  {
    key: 'impressions', displayOrder: 110, label: 'Impressions', category: 'social', unit: 'count', aggregation: 'sum',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Total Impression', 'Total Impressions', 'Impressions', 'Impression'],
  },
  {
    key: 'reach', displayOrder: 120, label: 'Reach', category: 'social', unit: 'count', aggregation: 'sum',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Total Reach', 'Post Reach', 'Post reach', 'Reach', 'Audience reach', 'Total Reach/ Views', 'Total Reach / Views'],
  },
  {
    key: 'engagement', displayOrder: 130, label: 'Engagement', category: 'social', unit: 'count', aggregation: 'sum',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Total Engagement', 'Post Engagement', 'Engagement', 'Enagagement'],
  },
  {
    key: 'reactions', displayOrder: 160, label: 'Reactions', category: 'social', unit: 'count', aggregation: 'sum',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Total Reactions', 'Reactions', 'Reaction', 'Reactions/Likes', 'Likes'],
  },
  {
    key: 'comments', displayOrder: 170, label: 'Comments', category: 'social', unit: 'count', aggregation: 'sum',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Total Comments', 'Comments'],
  },
  {
    key: 'shares', displayOrder: 180, label: 'Shares', category: 'social', unit: 'count', aggregation: 'sum',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Total Shares', 'Shares', 'Reposts'],
  },
  {
    key: 'clicks', displayOrder: 190, label: 'Clicks', category: 'social', unit: 'count', aggregation: 'sum',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Total Clicks', 'Clicks'],
  },
  {
    key: 'video_views', displayOrder: 140, label: 'Video views', category: 'social', unit: 'count', aggregation: 'sum',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Total Video Views', 'Video Views', 'Views'],
  },
  {
    key: 'engagement_rate', displayOrder: 200, label: 'Engagement rate', category: 'social', unit: 'percent', aggregation: 'avg',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Engagement rate'],
  },
  {
    key: 'click_through_rate', displayOrder: 210, label: 'Click-through rate', category: 'social', unit: 'percent', aggregation: 'avg',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Click-through rate', 'CTR'],
  },
  {
    key: 'targeted_impressions', displayOrder: 220, label: 'Targeted impressions', category: 'social', unit: 'count', aggregation: 'sum',
    allowedDimensions: SOCIAL_DIMS,
    aliases: ['Targeted impressions', 'Target impressions'],
  },
  {
    key: 'article_reach', displayOrder: 230, label: 'Article reach', category: 'social',
    unit: 'count', aggregation: 'sum',
    description:
      'Readers reached by press coverage. Counted apart from social reach because the sheet reports the two separately and adding them would count one audience under two headings.',
    allowedDimensions: ['outlet'],
    aliases: ['Total Article Reach', 'Article reach'],
  },
];

const dimensions = [
  {
    name: 'gender', label: 'Gender', isClosed: true,
    values: [
      { value: 'male', label: 'Male', aliases: ['Males', 'M'], order: 1 },
      { value: 'female', label: 'Female', aliases: ['Females', 'F', 'Women', 'Woman'], order: 2 },
      // The aliases keep both of the sheets' own spellings matchable, whatever
      // the dashboard chooses to call it.
      { value: 'undisclosed', label: 'Not disclose', aliases: ['Prefer not to disclose', 'Not disclosed'], order: 3 },
    ],
  },
  {
    name: 'hub', label: 'Hub',
    values: [
      { value: 'accra', label: 'Accra', aliases: ['Accra (Web Dev)', 'Accra (Web development)'], order: 1 },
      { value: 'whizzy-academy', label: 'Whizzy Academy', aliases: ['Whizzy', 'Whizzy Academy (Digital Marketing)', 'Whizzy Academy (Digital Marketting)'], order: 2 },
      // The Grow sheet spells this hub four different ways across its blocks.
      { value: 'womans-haven-africa', label: "Woman's Haven Africa", aliases: [
        'Womans Haven Africa', 'Womans Haven', 'Womens Haven Africa',
        "Woman's Haven Africa (Digital Marketing)", "Women's Haven Africa (Digital Marketing)",
        'Womans Haven (Digital Marketting)',
      ], order: 3 },
      { value: 'plugin', label: 'Plugin', aliases: ['Plugin'], order: 4 },
      // The nine implementing hubs of the UNDP Youth Alliance Initiative. They
      // sit on the same axis as the Grow hubs because both answer the same
      // question — where the work happened — and no figure is ever recorded
      // against one from each set.
      { value: 'afridelf', label: 'AFRIDELF', order: 10 },
      { value: 'agrico-hub', label: 'Agrico Hub', order: 11 },
      { value: 'behive', label: 'Behive', order: 12 },
      { value: 'fab-hub-ashanti', label: 'Fab Hub Ashanti', order: 13 },
      { value: 'green-growth-africa', label: 'Green Growth Africa', order: 14 },
      { value: 'innovators-up', label: 'Innovators Up', order: 15 },
      { value: 'mest', label: 'MEST', order: 16 },
      { value: 'siasd', label: 'SIASD', order: 17 },
      { value: 'wan-hive', label: 'Wan-Hive', order: 18 },
    ],
  },
  {
    // Open, and seeded only with the cohorts that exist today. Cohort 7 and
    // beyond are added by whoever records them — from the entry form or an
    // import — without a code change.
    name: 'cohort', label: 'Cohort', labelTemplate: 'Cohort {value}',
    values: [1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `Cohort ${n}`, order: n })),
  },
  {
    name: 'track', label: 'Track',
    values: [
      { value: 'digital-marketing', label: 'Digital Marketing', aliases: ['DM', 'Digital Marketting'], order: 1 },
      { value: 'software-development', label: 'Software Development', aliases: ['SD', 'Softwared Development'], order: 2 },
      { value: 'web-development', label: 'Web Development', aliases: ['Web Dev'], order: 3 },
      { value: 'soronko-cohort', label: 'Soronko Cohort', aliases: ['SC'], order: 4 },
    ],
  },
  {
    // Every region of Ghana, each aliased to the "X Region" spelling the
    // partner sheets use — without which "Greater Accra Region" becomes a
    // second value sitting beside "Greater Accra".
    name: 'region', label: 'Region',
    values: [
      { value: 'greater-accra', label: 'Greater Accra', aliases: ['Greater Accra Region', 'GreaterAccra'], order: 1 },
      { value: 'ashanti', label: 'Ashanti', aliases: ['Ashanti Region'], order: 2 },
      { value: 'central', label: 'Central', aliases: ['Central Region'], order: 3 },
      { value: 'western', label: 'Western', aliases: ['Western Region'], order: 4 },
      { value: 'western-north', label: 'Western North', aliases: ['Western North Region'], order: 5 },
      { value: 'eastern', label: 'Eastern', aliases: ['Eastern Region'], order: 6 },
      { value: 'volta', label: 'Volta', aliases: ['Volta Region'], order: 7 },
      { value: 'oti', label: 'Oti', aliases: ['Oti Region'], order: 8 },
      { value: 'bono', label: 'Bono', aliases: ['Bono Region'], order: 9 },
      { value: 'bono-east', label: 'Bono East', aliases: ['Bono East Region'], order: 10 },
      { value: 'ahafo', label: 'Ahafo', aliases: ['Ahafo Region'], order: 11 },
      { value: 'northern', label: 'Northern', aliases: ['Northern Region'], order: 12 },
      { value: 'north-east', label: 'North East', aliases: ['North East Region'], order: 13 },
      { value: 'savannah', label: 'Savannah', aliases: ['Savannah Region'], order: 14 },
      { value: 'upper-east', label: 'Upper East', aliases: ['Upper East Region'], order: 15 },
      { value: 'upper-west', label: 'Upper West', aliases: ['Upper West Region'], order: 16 },
      { value: 'other', label: 'Other / outside Ghana', aliases: ['Other / Non-Ghana / Unclassified', 'Online', 'Remote'], order: 90 },
      { value: 'unknown', label: 'Information not available', aliases: ['Information Not Available'], order: 99 },
    ],
  },
  {
    name: 'sector', label: 'Sector',
    values: [
      { value: 'finance', label: 'Finance / Financial Services', aliases: ['Finance / Financial Services', 'Finance & Fintech'], order: 1 },
      { value: 'digital-economy', label: 'Digital Economy', aliases: ['Technology & Digital Solutions'], order: 2 },
      { value: 'agriculture', label: 'Agriculture', aliases: ['Agriculture & Food Systems'], order: 3 },
      { value: 'health', label: 'Health', aliases: ['Health & Nutrition'], order: 4 },
      { value: 'education-skills', label: 'Education & Skills', aliases: ['Education & Skills', 'Education', 'Skills, Employment & Human Capital'], order: 5 },
      { value: 'tourism-hospitality', label: 'Tourism & Hospitality', aliases: ['Tourism & Hospitality'], order: 6 },
      { value: 'enterprise-development', label: 'Enterprise / Business Development', aliases: ['Enterprise/Business Development'], order: 7 },
      { value: 'manufacturing', label: 'Manufacturing', order: 8 },
      // USL names its sectors more finely than the MEST partner sheets do.
      // Where the two mean the same thing the USL spelling is an alias, so a
      // sector chart spanning both programmes adds up; where USL covers ground
      // the MEST list has no word for, it becomes a value of its own.
      { value: 'wash', label: 'WASH (Water, Sanitation & Hygiene)', aliases: ['WASH (Water, Sanitation & Hygiene)', 'WASH'], order: 9 },
      { value: 'climate-energy', label: 'Climate Action & Renewable Energy', aliases: ['Climate Action & Renewable Energy'], order: 10 },
      { value: 'waste-circular-economy', label: 'Waste Management & Circular Economy', aliases: ['Waste Management & Circular Economy'], order: 11 },
      { value: 'social-protection', label: 'Social Protection & Civic Engagement', aliases: ['Social Protection & Civic Engagement'], order: 12 },
      { value: 'assistive-technology', label: 'Assistive Technology & Inclusion', aliases: ['Assistive Technology & Inclusion'], order: 13 },
      { value: 'ecommerce-logistics', label: 'E-commerce, Logistics & Retail', aliases: ['E-commerce, Logistics & Retail'], order: 14 },
      { value: 'other', label: 'Other', order: 90 },
      { value: 'unknown', label: 'Information not available', aliases: ['Information Not Available'], order: 99 },
    ],
  },
  /**
   * A named venture.
   *
   * Open, like district and hub: the portfolio's ninety-eight names are not a
   * list the catalog can hold and keep current, and new ones arrive with every
   * cohort. Values are created from the sheet as it is read.
   *
   * Not an axis to chart. Ninety-eight bars of one enterprise each says
   * nothing; it is here so a page can show the portfolio as a roster and so a
   * figure can be attributed to the venture that reported it.
   */
  {
    name: 'company', label: 'Company', values: [],
  },
  {
    name: 'district', label: 'District', values: [],
  },
  {
    name: 'enterprise_stage', label: 'Enterprise stage', isClosed: true,
    values: [
      { value: 'small', label: 'Small', order: 1 },
      { value: 'medium', label: 'Medium', order: 2 },
    ],
  },
  {
    // How far a venture's product has got. Deliberately separate from
    // `enterprise_stage`, which records how large the business is — a Small
    // enterprise can be Scaling and a Medium one still Piloting, so folding the
    // two into one axis would produce a chart that reads as a sequence and is
    // not one.
    name: 'venture_stage', label: 'Product stage',
    values: [
      { value: 'scaling', label: 'Scaling', order: 1 },
      { value: 'piloting', label: 'Piloting', order: 2 },
      { value: 'mvp', label: 'MVP', order: 3 },
      { value: 'prototype', label: 'Prototype', order: 4 },
      { value: 'unknown', label: 'Not recorded', aliases: ['N/A'], order: 99 },
    ],
  },
  {
    name: 'venture_status', label: 'Status',
    values: [
      { value: 'active', label: 'Active', order: 1 },
      { value: 'inactive', label: 'Inactive', order: 2 },
      { value: 'unknown', label: 'Not recorded', aliases: ['N/A'], order: 99 },
    ],
  },
  {
    // UNDP-YAI reports against a compound label that pairs the programme stage
    // with the cohort inside it ("2 Pilot", "1 Cohort 2"). Kept verbatim rather
    // than split, because the sheet never states the two parts separately and
    // inventing the split would put figures on an axis the source does not have.
    name: 'program_stage', label: 'Programme stage', values: [],
  },
  {
    // The three disciplines the AI Startup Lab teaches and reports against.
    name: 'discipline', label: 'Discipline', isClosed: true,
    values: [
      { value: 'tech', label: 'Tech', order: 1 },
      { value: 'business', label: 'Business', order: 2 },
      { value: 'product', label: 'Product / Design', aliases: ['Product/Design', 'Product / Design', 'Design'], order: 3 },
    ],
  },
  {
    name: 'open_source', label: 'Open source', isClosed: true,
    values: [
      { value: 'yes', label: 'Open source', aliases: ['Yes'], order: 1 },
      { value: 'no', label: 'Proprietary', aliases: ['No'], order: 2 },
      { value: 'unknown', label: 'Not recorded', aliases: ['N/A'], order: 99 },
    ],
  },
  /**
   * Who a figure reached, beyond how many.
   *
   * The Fellowship counts its learners, users and educators several ways over:
   * how many were in rural areas, how many are displaced or refugees, how many
   * live with a disability. These overlap each other and overlap gender — a
   * learner can be counted as female and as rural — so they are their own axis
   * rather than values of one. Facts land on their own signature and are never
   * added to the gender split or to each other.
   */
  {
    name: 'inclusion', label: 'Inclusion group', isClosed: true,
    values: [
      { value: 'rural', label: 'Rural areas', order: 1,
        aliases: ['Number in rural areas', 'Rural', 'Rural Learners'] },
      { value: 'pwd', label: 'Living with a disability', order: 2,
        aliases: ['Number who are PWD', 'PWD', 'Learners with Disabilities'] },
      { value: 'displaced', label: 'Displaced or refugee', order: 3,
        aliases: ['Number who are displaced refugees', 'Number who are displaced/refugees', 'RDP'] },
      { value: 'youth', label: 'Youth (18–35)', order: 4,
        aliases: ['Number between the ages of 18-35', 'Youth'] },
    ],
  },
  {
    name: 'employment_type', label: 'Employment type', isClosed: true,
    values: [
      { value: 'full-time', label: 'Full time', aliases: ['Full time', 'Fulltime'], order: 1 },
      { value: 'part-time', label: 'Part time', aliases: ['Part time', 'Parttime'], order: 2 },
    ],
  },
  {
    name: 'platform', label: 'Platform', isClosed: true,
    values: [
      { value: 'linkedin', label: 'LinkedIn', aliases: ['Linkedin', 'MEST LINKEDIN'], order: 1 },
      { value: 'facebook', label: 'Facebook', aliases: ['MEST FACEBOOK'], order: 2 },
      { value: 'youtube', label: 'YouTube', aliases: ['Youtube', 'MEST YOUTUBE'], order: 3 },
      { value: 'twitter', label: 'X (Twitter)', aliases: ['X', 'Twitter', 'MEST TWITTER'], order: 4 },
      { value: 'instagram', label: 'Instagram', aliases: ['MEST INSTAGRAM'], order: 5 },
      { value: 'tiktok', label: 'TikTok', aliases: ['Tikok', 'Tiktok'], order: 6 },
    ],
  },
  {
    name: 'channel', label: 'Channel', isClosed: true,
    values: [
      { value: 'mest-africa', label: 'MEST Africa', aliases: ['MEST AFRICA', 'MEST'], order: 1 },
      { value: 'citi-fm', label: 'Citi FM', aliases: ['CITI FM', 'CitiFM', 'Citi Fm'], order: 2 },
      { value: 'channel-one-tv', label: 'Channel One TV', aliases: ['CHANNEL ONE TV', 'CHANNEL ONE'], order: 3 },
      { value: 'panelists', label: 'Panelists', aliases: ['PANELISTS'], order: 4 },
      { value: 'plugin-digital', label: 'Plugin Digital', order: 5 },
    ],
  },
  {
    // News sites that carried EdTech Mondays coverage. Open, because the next
    // month's coverage will be somewhere new.
    name: 'outlet', label: 'Outlet',
    values: [
      { value: 'citi-news-room', label: 'Citi News Room', aliases: ['Citi News Room'], order: 1 },
      { value: 'myjoyonline', label: 'MyJoyOnline', aliases: ['myjoyonline', 'My Joy Online'], order: 2 },
      { value: 'ghanaweb', label: 'GhanaWeb', aliases: ['Ghanaweb'], order: 3 },
    ],
  },
  {
    name: 'post_type', label: 'Post type', isClosed: true,
    values: [
      { value: 'organic', label: 'Organic', order: 1 },
      { value: 'sponsored', label: 'Sponsored', order: 2 },
    ],
  },
];

module.exports = { programs, metrics, dimensions };
