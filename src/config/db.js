const mongoose = require('mongoose');
const { env } = require('./env');
const { logger } = require('../utils/logger');

async function connectDB() {
  try {
    await mongoose.connect(env.MONGODB_URI);
    logger.info('MongoDB connected', { uri: env.MONGODB_URI.replace(/\/\/.*@/, '//***@') });
  } catch (err) {
    logger.error('MongoDB connection failed', { error: err });
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected');
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB error', { error: err });
  });
}

module.exports = { connectDB };
