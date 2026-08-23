/**
 * Connects the Data Summary spreadsheet using the mappings the backfill already
 * proved against the exported .xlsx.
 *
 *   node scripts/connect-data-summary.js <spreadsheetId> [--dry-run]
 *
 * Blocks are grouped by tab, so one connected sheet covers every table on it.
 */
require('../src/config/env');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
require('../src/models');
const Program = require('../src/models/Program.model');
const SheetSource = require('../src/models/SheetSource.model');
const User = require('../src/models/User.model');
const sheets = require('../src/services/sheets.service');
const { dataSummaryBlocks } = require('../src/seeds/backfillMappings');

const [, , spreadsheetId, ...flags] = process.argv;
const dryRun = flags.includes('--dry-run');

if (!spreadsheetId) {
  console.error('Usage: node scripts/connect-data-summary.js <spreadsheetId> [--dry-run]');
  process.exit(2);
}

(async () => {
  await mongoose.connect(env.MONGODB_URI);

  const description = await sheets.describe(spreadsheetId);
  console.log(`\nSpreadsheet: ${description.title}`);

  const tabs = new Set(description.tabs.map((t) => t.name));
  const admin = await User.findOne({ role: 'admin' }).sort({ createdAt: 1 });

  // Group the flat block list by the tab each one reads.
  const byTab = new Map();
  for (const block of dataSummaryBlocks) {
    if (!byTab.has(block.sheet)) byTab.set(block.sheet, []);
    byTab.get(block.sheet).push(block);
  }

  let connected = 0;

  for (const [tabName, blocks] of byTab) {
    if (!tabs.has(tabName)) {
      console.log(`  ✗ "${tabName}" — not a tab in this spreadsheet, skipped`);
      continue;
    }

    const resolved = [];
    for (const block of blocks) {
      const program = await Program.findOne({ pageKey: block.program });
      if (!program) {
        console.log(`  ✗ ${block.name} — unknown programme "${block.program}"`);
        continue;
      }
      resolved.push({ name: block.name, program: program._id, mapping: block.mapping });
    }
    if (resolved.length === 0) continue;

    console.log(`  ✓ ${tabName} — ${resolved.length} block${resolved.length === 1 ? '' : 's'}`);
    for (const b of resolved) console.log(`      ${b.name}`);

    if (dryRun) continue;

    await SheetSource.findOneAndUpdate(
      { spreadsheetId, tabName },
      {
        spreadsheetId,
        tabName,
        spreadsheetTitle: description.title,
        // The tab's own programme is the first block's; per-block programmes
        // are what actually govern each write.
        program: resolved[0].program,
        blocks: resolved,
        mapping: {},
        createdBy: admin?._id ?? null,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    connected += 1;
  }

  console.log(
    dryRun
      ? '\nDry run — nothing was connected.'
      : `\nConnected ${connected} tab${connected === 1 ? '' : 's'}. Sync them from Connected sheets, or run npm run sync:sheets.`
  );

  await mongoose.disconnect();
})().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
