require('./config/env'); // Must be first — validates env vars
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const { connectDB } = require('./config/db');
const { env } = require('./config/env');
require('./models'); // Register every model so cross-collection populate works
const { logger, morganStream } = require('./utils/logger');
const { errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const { sendError, ERROR_CODES } = require('./utils/response');

const authRoutes = require('./routes/auth.routes');
const factsRoutes = require('./routes/facts.routes');
const insightsRoutes = require('./routes/insights.routes');
const sheetsRoutes = require('./routes/sheets.routes');
const auditRoutes = require('./routes/audit.routes');
const submissionRoutes = require('./routes/submissions.routes');
const { programRouter, metricRouter, dimensionRouter } = require('./routes/catalog.routes');
const { importRouter, templateRouter } = require('./routes/import.routes');
const mongoose = require('mongoose');

const app = express();

// Security
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGINS, credentials: true }));

// Request parsing
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// HTTP logging via Winston
app.use(morgan('combined', { stream: morganStream }));

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
  });
});

// API routes
app.use('/api/v1', apiLimiter);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/programs', programRouter);
app.use('/api/v1/metrics', metricRouter);
app.use('/api/v1/dimensions', dimensionRouter);
app.use('/api/v1/facts', factsRoutes);
app.use('/api/v1/insights', insightsRoutes);
app.use('/api/v1/sheets', sheetsRoutes);
app.use('/api/v1/audit', auditRoutes);
app.use('/api/v1/submissions', submissionRoutes);
app.use('/api/v1/imports', importRouter);
app.use('/api/v1/mapping-templates', templateRouter);

// 404
app.use((_req, res) => {
  sendError(res, 404, {
    code: ERROR_CODES.NOT_FOUND,
    message: 'Route not found.',
  });
});

// Global error handler
app.use(errorHandler);

const PORT = env.PORT;

if (require.main === module) {
  /**
   * Nothing here should take the process down silently.
   *
   * Without these a rejected promise nobody caught ends the server with a bare
   * "app crashed" and no clue as to which one — which is exactly the state this
   * was found in. An uncaught exception still exits, because the process is by
   * then in an unknown state, but it exits having said why.
   */
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', {
      error: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception — shutting down', { error: err.message, stack: err.stack });
    process.exit(1);
  });

  /**
   * Listen first, connect second. The database is on the other side of a
   * network and can take seconds to answer; waiting for it before opening the
   * port means the browser gets "connection refused" and the developer reads a
   * slow database as a broken server.
   *
   * The port is claimed with a few retries, because the common way this process
   * dies is losing a race with itself: nodemon restarts on a file change and
   * the outgoing process has not let go of the socket yet, so the incoming one
   * hits EADDRINUSE and exits. nodemon then reports "app crashed" and waits for
   * another file change — a dead server until somebody notices and touches a
   * file. A second of patience is all it takes to avoid that.
   */
  const LISTEN_RETRIES = 10;
  const LISTEN_RETRY_MS = 500;
  let attempts = 0;

  const server = app.listen(PORT, () => {
    logger.info(`ri-api listening on port ${PORT}`, { env: env.NODE_ENV });
  });

  server.on('error', (err) => {
    if (err.code !== 'EADDRINUSE') throw err;

    attempts += 1;
    if (attempts > LISTEN_RETRIES) {
      logger.error(
        `Port ${PORT} is still in use after ${LISTEN_RETRIES} attempts. Something else is running on it — ` +
          `\`lsof -ti :${PORT} | xargs kill\` will clear it.`
      );
      process.exit(1);
    }

    logger.warn(`Port ${PORT} is busy, retrying (${attempts}/${LISTEN_RETRIES})…`);
    setTimeout(() => server.listen(PORT), LISTEN_RETRY_MS);
  });

  connectDB()
    .then(async () => {
      /**
       * Build the indexes now rather than on somebody's first page.
       *
       * Mongoose creates them lazily, on the first query against each model —
       * two dozen round trips that land on whoever opens the dashboard first
       * after a restart, and turn a one-second page into a nine-second one.
       */
      const started = Date.now();
      await Promise.all(Object.values(mongoose.models).map((model) => model.init()));
      logger.info(`Indexes ready in ${Date.now() - started}ms`);
    })
    .catch((err) => {
      logger.error('MongoDB connection failed — the API is up but will answer 503 until it is reachable', {
        error: err.message,
      });
    });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      logger.info(`${signal} received, closing`);
      server.close(() => process.exit(0));
    });
  }
}

module.exports = app;
