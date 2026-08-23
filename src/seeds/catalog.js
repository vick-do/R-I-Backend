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

  { pageKey: 'ai-startup-lab', name: 'AI Startup Lab', category: 'lab' },
  { pageKey: 'ai-startup-lab-2026', name: '2026', parent: 'ai-startup-lab', category: 'container', isReportable: false },
  { pageKey: 'ai-startup-lab-2027', name: '2027', parent: 'ai-startup-lab', category: 'container', isReportable: false },
  { pageKey: 'ai-startup-lab-2028', name: '2028', parent: 'ai-startup-lab', category: 'container', isReportable: false },

  { pageKey: 'portfolio', name: 'Portfolio', category: 'portfolio',
    metricKeys: ['enterprises_total', 'amount_invested', 'jobs_created'] },

  { pageKey: 'mest-x', name: 'MEST X', category: 'container', isReportable: false },

  { pageKey: 'digital-skills', name: 'Digital Skills', parent: 'mest-x', category: 'container', isReportable: false },
  { pageKey: 'digital-skills-web3', name: 'Web3', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total'] },
  { pageKey: 'digital-skills-pre-mest', name: 'Pre-Mest', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total', 'graduates', 'graduation_rate'] },
  { pageKey: 'digital-skills-grow', name: 'Grow', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total', 'mothers', 'graduates_employed'] },
  // Cohort-based training programmes with the same shape as the three above:
  // a roster of participants, a gender split, and employment outcomes.
  { pageKey: 'digital-skills-hospitality', name: 'Hospitality', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total', 'graduates_employed'],
    description: 'Hospitality and tourism training. Figures are counted from the applicant roster, which states no totals of its own.' },
  { pageKey: 'digital-skills-doulogic', name: 'Doulogic', parent: 'digital-skills', category: 'digital_skills',
    metricKeys: ['learners_total'],
    description: 'Doulogic cohort. The roster and the tally block in the source sheet disagree — see Data quality.' },

  { pageKey: 'venture-support', name: 'Venture Support', parent: 'mest-x', category: 'container', isReportable: false },
  { pageKey: 'venture-support-early-stage', name: 'Early stage', parent: 'venture-support', category: 'container', isReportable: false },
  { pageKey: 'venture-support-usl', name: 'USL', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'] },
  { pageKey: 'venture-support-pre-mest', name: 'Pre Mest', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'] },
  { pageKey: 'venture-support-undp', name: 'UNDP-YAI', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'] },
  { pageKey: 'venture-support-absa', name: 'Absa partnership program', parent: 'venture-support-early-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'] },
  { pageKey: 'venture-support-grow-stage', name: 'Grow stage', parent: 'venture-support', category: 'container', isReportable: false },
  { pageKey: 'venture-support-edtech-fellowship', name: 'EdTech fellowship', parent: 'venture-support-grow-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'] },
  { pageKey: 'venture-support-mest-scale', name: 'Mest scale', parent: 'venture-support-grow-stage', category: 'venture_support',
    metricKeys: ['enterprises_total'],
    description: 'MEST Scale & Express — enterprise support by stage, sector, and region.' },

  { pageKey: 'ecosystem', name: 'Ecosystem', parent: 'mest-x', category: 'container', isReportable: false },
  { pageKey: 'ecosystem-edtech-mondays', name: 'EdTech Mondays', parent: 'ecosystem', category: 'ecosystem',
    metricKeys: [
      'posts', 'impressions', 'reach', 'engagement', 'reactions', 'comments',
      'shares', 'clicks', 'video_views', 'engagement_rate', 'click_through_rate',
      'targeted_impressions',
    ] },
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
    allowedDimensions: ['gender', 'enterprise_stage', 'region', 'district', 'sector'],
    aliases: ['Total Enterprises', 'Enterprises', 'Businesses supported'],
  },

  // ---- Investment ---------------------------------------------------------
  {
    key: 'jobs_created', displayOrder: 90, label: 'Jobs created', category: 'investment',
    unit: 'count', aggregation: 'sum', rollsUpToOrgTotal: true,
    headlineOrder: 3, headlineLabel: 'Total jobs created',
    allowedDimensions: ['gender', 'region', 'sector'],
    aliases: ['Jobs created', 'Total jobs created'],
  },
  {
    key: 'edtech_learners_impacted', displayOrder: 95, label: 'Learners reached by EdTech solutions',
    category: 'people', unit: 'count', aggregation: 'sum', rollsUpToOrgTotal: true,
    headlineOrder: 4, headlineLabel: 'Learners impacted with EdTech solutions',
    description:
      'End learners reached by EdTech products built or supported by MEST ventures. Distinct from people trained — these are the users of the solutions, not participants in a programme.',
    allowedDimensions: ['region', 'gender'],
    aliases: ['Learners impacted', 'EdTech learners', 'Learners reached'],
  },
  {
    key: 'amount_invested', displayOrder: 80, label: 'Amount invested', category: 'investment',
    unit: 'currency', aggregation: 'sum', rollsUpToOrgTotal: true,
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
    aliases: ['Total Reach', 'Post Reach', 'Post reach', 'Reach', 'Audience reach'],
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
    aliases: ['Total Shares', 'Shares'],
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
      { value: 'finance', label: 'Finance / Financial Services', aliases: ['Finance / Financial Services'], order: 1 },
      { value: 'digital-economy', label: 'Digital Economy', order: 2 },
      { value: 'agriculture', label: 'Agriculture', order: 3 },
      { value: 'health', label: 'Health', order: 4 },
      { value: 'education-skills', label: 'Education & Skills', aliases: ['Education & Skills'], order: 5 },
      { value: 'tourism-hospitality', label: 'Tourism & Hospitality', aliases: ['Tourism & Hospitality'], order: 6 },
      { value: 'enterprise-development', label: 'Enterprise / Business Development', aliases: ['Enterprise/Business Development'], order: 7 },
      { value: 'manufacturing', label: 'Manufacturing', order: 8 },
      { value: 'other', label: 'Other', order: 99 },
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
    name: 'post_type', label: 'Post type', isClosed: true,
    values: [
      { value: 'organic', label: 'Organic', order: 1 },
      { value: 'sponsored', label: 'Sponsored', order: 2 },
    ],
  },
];

module.exports = { programs, metrics, dimensions };
