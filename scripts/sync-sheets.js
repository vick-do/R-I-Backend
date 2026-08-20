/**
 * Pulls every enabled sheet. Run from cron:
 *   0 3 * * *  cd /path/to/ri-api && npm run sync:sheets
 */
require('../src/config/env');
const mongoose = require('mongoose');
const { env } = require('../src/config/env');
const { logger } = require('../src/utils/logger');
require('../src/models');
const { syncAll } = require('../src/services/sheetSync.service');

(async () => {
  await mongoose.connect(env.MONGODB_URI);
  const results = await syncAll();

  for (const r of results) {
    const name = r.source ? `${r.source.spreadsheetTitle} › ${r.source.tabName}` : 'unknown';
    if (r.status === 'synced') logger.info(`✓ ${name} — ${r.source.lastMessage}`);
    else if (r.status === 'needs_review') logger.warn(`⚠ ${name} held for review — ${r.reasons[0]}`);
    else logger.error(`✗ ${name} — ${r.message}`);
  }

  await mongoose.disconnect();
  process.exit(results.some((r) => r.status === 'failed') ? 1 : 0);
})();
