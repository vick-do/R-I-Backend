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
const programs = [
  { pageKey: 'overview', name: 'Overview', category: 'container', isReportable: false },

  { pageKey: 'ai-startup-lab', name: 'AI Startup Lab', category: 'lab',
    metricKeys: ['satisfaction', 'skill_confidence_before', 'skill_confidence_after'], allowsManualEntry: false,
    description: 'Monthly satisfaction and before-and-after skill confidence across the Tech, Business and Product disciplines.' },
  { pageKey: 'ai-startup-lab-2026', name: '2026', parent: 'ai-startup-lab', category: 'container', isReportable: false },
  { pageKey: 'ai-startup-lab-2027', name: '2027', parent: 'ai-startup-lab', category: 'container', isReportable: false },
  { pageKey: 'ai-startup-lab-2028', name: '2028', parent: 'ai-startup-lab', category: 'container', isReportable: false },

  { pageKey: 'portfolio', name: 'Portfolio', category: 'portfolio',
    metricKeys: ['enterprises_total', 'amount_invested', 'jobs_created'] },

  { pageKey: 'mest-x', name: 'MEST X', category: 'container', isReportable: false },

  { pageKey: 'digital-skills', name: 'Digital Skills', parent: 'mest-x', category: 'container', isReportable: false },
  { pageKey: 'digital-skills-web3', name: 'Web3', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total'], allowsManualEntry: false },
  { pageKey: 'digital-skills-pre-mest', name: 'Pre-Mest', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total', 'graduates', 'graduation_rate'], allowsManualEntry: false },
  { pageKey: 'digital-skills-grow', name: 'Grow', parent: 'digital-skills', category: 'digital_skills',
    // `graduates` sits beside `graduates_employed` because the cohort entry form
    // records a plain graduate count, which the summary sheet never stated.
    metricKeys: ['learners_total', 'mothers', 'graduates', 'graduates_employed'] },
  // Cohort-based training programmes with the same shape as the three above:
  // a roster of participants, a gender split, and employment outcomes.
  { pageKey: 'digital-skills-hospitality', name: 'Hospitality', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total', 'graduates_employed'], allowsManualEntry: false,
    description: 'Hospitality and tourism training. Figures are counted from the applicant roster, which states no totals of its own.' },
  { pageKey: 'digital-skills-doulogic', name: 'Doulogic', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total'], allowsManualEntry: false,
    description: 'Doulogic cohort. The roster and the tally block in the source sheet disagree — see Data quality.' },

  { pageKey: 'venture-support', name: 'Venture Support', parent: 'mest-x', category: 'container', isReportable: false },
  { pageKey: 'venture-support-early-stage', name: 'Early stage', parent: 'venture-support', category: 'container', isReportable: false },
  { pageKey: 'venture-support-usl', name: 'USL', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'] },
  { pageKey: 'venture-support-pre-mest', name: 'Pre Mest', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'], isArchived: true },
  { pageKey: 'venture-support-undp', name: 'UNDP-YAI', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'] },
  // The page key stays `venture-support-absa`: it is the address the connected
  // Absa sheet, the URL and every recorded figure's provenance point at.
  { pageKey: 'venture-support-absa', name: 'Females supported by MEST', navLabel: 'Absa partnership program',
    parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'] },
  { pageKey: 'venture-support-mest-express', name: 'MEST Express', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total', 'jobs_created'],
    description: 'The 88 enterprises in the MEST Express cohort. Four later transitioned into MEST Scale and appear in both rosters.' },
  { pageKey: 'venture-support-grow-stage', name: 'Growth stage', parent: 'venture-support', category: 'container', isReportable: false },
  { pageKey: 'venture-support-edtech-fellowship', name: 'EdTech fellowship', parent: 'venture-support-grow-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'] },
  { pageKey: 'venture-support-mest-scale', name: 'MEST Scale', parent: 'venture-support-grow-stage', category: 'venture_support',
    metricKeys: ['enterprises_total', 'jobs_created'],
    description: 'The 24 enterprises in the MEST Scale cohort, counted from the partner roster.' },

  { pageKey: 'ecosystem', name: 'Ecosystem', parent: 'mest-x', category: 'container', isReportable: false },
  { pageKey: 'ecosystem-edtech-mondays', name: 'EdTech Mondays', parent: 'ecosystem', category: 'ecosystem',
    metricKeys: [
      'posts', 'impressions', 'reach', 'engagement', 'reactions', 'comments',
      'shares', 'clicks', 'video_views', 'article_reach',
    ], allowsManualEntry: false },
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
  {
    key: 'graduates_employed', displayOrder: 30, label: 'Graduates employed', category: 'people',
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

  // ---- Enterprise ---------------------------------------------------------
  {
    key: 'enterprises_total', displayOrder: 60, label: 'Enterprises supported', category: 'enterprise',
    unit: 'count', aggregation: 'sum', rollsUpToOrgTotal: true,
    headlineOrder: 2, headlineLabel: 'Total no. of businesses supported',
    allowedDimensions: ['gender', 'enterprise_stage', 'region', 'district', 'sector',
      'hub', 'cohort', 'venture_stage', 'venture_status', 'program_stage', 'open_source'],
    aliases: ['Total Enterprises', 'Enterprises', 'Businesses supported', 'Total Startups', 'Total startups', 'Total Companies'],
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
    allowedDimensions: ['region', 'gender', 'cohort'],
    aliases: ['Learners impacted', 'EdTech learners', 'Learners reached', 'Total Number of learners'],
  },
  {
    key: 'amount_invested', displayOrder: 80, label: 'Amount invested', category: 'investment',
    unit: 'currency', aggregation: 'sum', currency: 'USD', rollsUpToOrgTotal: true,
    headlineOrder: 5, headlineLabel: 'Amount invested',
    allowedDimensions: ['sector', 'region'],
    aliases: ['Amount invested', 'Capital deployed', 'Investment'],
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
    allowedDimensions: ['gender', 'region', 'cohort'],
    aliases: ['Educators (teachers) trained', 'Educators trained'],
  },
  {
    key: 'users_reached', displayOrder: 97, label: 'Users and customers reached', category: 'people',
    unit: 'count', aggregation: 'sum',
    description: 'End users of the products these ventures build. A reach figure reported by the ventures themselves, not a count MEST verified.',
    allowedDimensions: ['gender', 'region', 'cohort'],
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
    allowedDimensions: ['gender', 'employment_type', 'cohort'],
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

  {
    key: 'satisfaction', displayOrder: 104, label: 'Satisfaction', category: 'people',
    unit: 'percent', aggregation: 'avg',
    description: 'Participant satisfaction, as reported in the monthly survey.',
    allowedDimensions: ['discipline', 'cohort', 'gender'],
    aliases: ['Satisfaction', 'General Satisfaction'],
  },
  // Before and after are separate metrics rather than one metric split by an
  // assessment axis, because a headline card has to state a number somebody can
  // quote. Averaging the two into "skill confidence: 56%" describes nobody: not
  // the people who started, not the people who finished.
  {
    key: 'skill_confidence_before', displayOrder: 105, label: 'Skill confidence — before', category: 'people',
    unit: 'percent', aggregation: 'avg',
    description: 'Self-rated confidence before the teaching, averaged across every topic assessed in a discipline.',
    allowedDimensions: ['discipline', 'cohort'],
    aliases: ['Skill confidence before', 'Confidence before', 'BEFORE'],
  },
  {
    key: 'skill_confidence_after', displayOrder: 106, label: 'Skill confidence — after', category: 'people',
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
      { value: 'undisclosed', label: 'Prefer not to disclose', aliases: ['Prefer not to disclose', 'Not disclosed'], order: 3 },
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
