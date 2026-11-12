const dotenv = require('dotenv');
dotenv.config();

const REQUIRED_VARS = [
  'NODE_ENV',
  'PORT',
  'MONGODB_URI',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'JWT_ACCESS_EXPIRES_IN',
  'JWT_REFRESH_EXPIRES_IN',
  'BCRYPT_SALT_ROUNDS',
  'CORS_ORIGIN',
];

function validateEnv() {
  const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(`[FATAL] Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
}

validateEnv();

// A browser's Origin header never ends in "/", so an origin saved with one
// (e.g. "https://app.netlify.app/") would never match and every request would
// fail CORS. Several origins can be given, comma-separated.
const stripSlash = (url) => url.trim().replace(/\/+$/, '');
const CORS_ORIGINS = process.env.CORS_ORIGIN.split(',').map(stripSlash).filter(Boolean);

const env = {
  NODE_ENV: process.env.NODE_ENV,
  PORT: parseInt(process.env.PORT, 10),
  MONGODB_URI: process.env.MONGODB_URI,
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN,
  JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,
  BCRYPT_SALT_ROUNDS: parseInt(process.env.BCRYPT_SALT_ROUNDS, 10),
  CORS_ORIGINS,
  // Where invite links point. Defaults to the first dashboard origin, which is
  // the same host in every deployment so far.
  APP_URL: stripSlash(process.env.APP_URL ?? CORS_ORIGINS[0]),
  INVITE_EXPIRY_DAYS: parseInt(process.env.INVITE_EXPIRY_DAYS ?? '7', 10),
  UPLOAD_MAX_BYTES: parseInt(process.env.UPLOAD_MAX_BYTES ?? '26214400', 10),
  SEED_ADMIN_EMAIL: process.env.SEED_ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD: process.env.SEED_ADMIN_PASSWORD,

  // Google service account used to read connected sheets. Optional: without it
  // the sheet endpoints report themselves as unconfigured rather than failing
  // at call time, so the rest of the API runs unchanged on a machine that has
  // no credentials.
  GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL ?? null,
  // Stored with literal \n escapes so it survives a single-line .env entry.
  GOOGLE_PRIVATE_KEY: (process.env.GOOGLE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n') || null,

  isProduction: process.env.NODE_ENV === 'production',
};

module.exports = { env };
