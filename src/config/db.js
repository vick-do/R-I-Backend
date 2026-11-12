const mongoose = require('mongoose');
const { env } = require('./env');
const { logger } = require('../utils/logger');

/**
 * Options tuned for a hosted cluster on the other end of a network.
 *
 * The defaults assume a database next door. Against Atlas they mean a request
 * arriving during a blip waits 30 seconds before being told the server could
 * not be selected, which reads as a hang rather than an error.
 */
const CONNECTION_OPTIONS = {
  serverSelectionTimeoutMS: 8000,
  socketTimeoutMS: 45000,
  // The pages fire a dozen queries at once; a pool this size keeps them from
  // queueing behind each other.
  maxPoolSize: 20,
  minPoolSize: 2,
  retryWrites: true,
};

async function connectDB() {
  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected — queries will wait until it is back');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected');
  });

  // Logged, never fatal. A dropped connection is something mongoose recovers
  // from on its own; killing the process over it turns a blip into an outage.
  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB error', { error: err.message });
  });

  /**
   * Mongoose reconnects on its own after a connection that once succeeded drops,
   * but it does not retry the *initial* connect — that promise rejects and the
   * connection stays down until the process restarts. One reset during startup
   * would otherwise strand the API on 503 forever.
   */
  const CONNECT_RETRIES = 5;

  for (let attempt = 1; ; attempt++) {
    try {
      await mongoose.connect(env.MONGODB_URI, CONNECTION_OPTIONS);
      break;
    } catch (err) {
      if (attempt > CONNECT_RETRIES) throw err;

      const delay = Math.min(1000 * 2 ** (attempt - 1), 10000);
      logger.warn(`MongoDB connect attempt ${attempt} failed, retrying in ${delay}ms`, {
        error: err.message,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // The database name is the useful part — it says whether this is dev or
  // production. The host list, replica set and connection options are not worth
  // putting on a terminal that gets screenshotted and pasted into chats, and
  // masking the password does not make the rest of it any less of a map to the
  // cluster.
  logger.info('MongoDB connected', { database: mongoose.connection.name });
}

module.exports = { connectDB };
