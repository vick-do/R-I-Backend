/**
 * Turns a downloaded service-account key into the two .env lines, and checks
 * that Google accepts it.
 *
 *   node scripts/setup-google.js ~/Downloads/your-key.json
 *   node scripts/setup-google.js ~/Downloads/your-key.json <spreadsheetId>
 *
 * The second form also tries to read the sheet, which is the only way to tell
 * "credentials are wrong" apart from "the sheet was never shared".
 */
const fs = require('fs');
const jwt = require('jsonwebtoken');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

const [, , keyPath, spreadsheetId] = process.argv;

if (!keyPath) {
  console.error('Usage: node scripts/setup-google.js <path-to-key.json> [spreadsheetId]');
  process.exit(2);
}

let key;
try {
  key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
} catch (err) {
  console.error(`Could not read ${keyPath}: ${err.message}`);
  process.exit(1);
}

if (!key.client_email || !key.private_key) {
  console.error('That file has no client_email / private_key — is it the service account key JSON?');
  process.exit(1);
}

(async () => {
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwt.sign(
    { iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 },
    key.private_key,
    { algorithm: 'RS256' }
  );

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    console.error(`\n✗ Google rejected the key: ${body.error_description ?? body.error ?? res.status}`);
    if (/invalid_grant/.test(body.error ?? '')) {
      console.error('  invalid_grant usually means the machine clock is off, or the key was deleted.');
    }
    process.exit(1);
  }
  console.log('\n✓ Google accepted the service account.');

  if (spreadsheetId) {
    const check = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=properties.title,sheets.properties.title`,
      { headers: { Authorization: `Bearer ${body.access_token}` } }
    );
    const sheet = await check.json().catch(() => ({}));

    if (check.status === 403) {
      console.error(`\n✗ The key works, but this sheet is not shared with it.`);
      console.error(`  Open the sheet → Share → add ${key.client_email} as Viewer.`);
      process.exit(1);
    }
    if (check.status === 404) {
      console.error('\n✗ No spreadsheet with that id. Check the id in the URL between /d/ and /edit.');
      process.exit(1);
    }
    if (!check.ok) {
      console.error(`\n✗ ${sheet?.error?.message ?? check.status}`);
      if (/has not been used|disabled/.test(sheet?.error?.message ?? '')) {
        console.error('  Enable the Google Sheets API for this project in the Cloud console.');
      }
      process.exit(1);
    }

    console.log(`✓ Can read "${sheet.properties.title}"`);
    console.log(`  Tabs: ${(sheet.sheets ?? []).map((s) => s.properties.title).join(', ')}`);
  }

  console.log('\nAdd these two lines to .env:\n');
  console.log(`GOOGLE_CLIENT_EMAIL=${key.client_email}`);
  console.log(`GOOGLE_PRIVATE_KEY="${key.private_key.replace(/\n/g, '\\n')}"`);
  console.log(`\nThen share each spreadsheet with ${key.client_email} (Viewer) and restart the API.`);
})();
