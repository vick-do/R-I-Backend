/**
 * Puts a sheet source on a freshness window, so viewing its programme re-reads
 * the sheet when the stored figures are older than that.
 *
 *   node scripts/set-live-refresh.js "EdTech Mondays " 5
 *   node scripts/set-live-refresh.js "EdTech Mondays " off
 *
 * Meant for a sheet still being filled in. A finished workbook should stay on
 * the nightly job — re-reading it on every page view spends Google's quota to
 * learn nothing.
 */
require('../src/config/env');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
require('../src/models');
const SheetSource = require('../src/models/SheetSource.model');

const [tab, minutes] = process.argv.slice(2);

(async () => {
  await mongoose.connect(env.MONGODB_URI);

  if (!tab) {
    const all = await SheetSource.find().populate('program', 'name').lean();
    console.log('\nConnected sheets:\n');
    for (const s of all) {
      const every = s.refreshIntervalMinutes ? `every ${s.refreshIntervalMinutes} min on view` : 'nightly only';
      console.log(`  ${String(s.program?.name ?? '?').padEnd(26)} "${s.tabName}"  ${every}`);
    }
    console.log('');
    await mongoose.disconnect();
    return;
  }

  const source = await SheetSource.findOne({ tabName: tab });
  if (!source) throw new Error(`No connected sheet with the tab "${tab}".`);

  source.refreshIntervalMinutes = minutes === 'off' ? null : Number(minutes);
  if (source.refreshIntervalMinutes !== null && !(source.refreshIntervalMinutes > 0)) {
    throw new Error('The interval must be a positive number of minutes, or "off".');
  }
  await source.save();

  console.log(
    source.refreshIntervalMinutes
      ? `"${tab}" now re-reads on view when its figures are more than ${source.refreshIntervalMinutes} minutes old.`
      : `"${tab}" is back to refreshing only on the nightly job.`
  );
  await mongoose.disconnect();
})().catch((err) => { console.error('Failed:', err.message); process.exit(1); });
