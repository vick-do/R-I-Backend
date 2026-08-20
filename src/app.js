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

const app = express();

// Security
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

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
  connectDB().then(() => {
    app.listen(PORT, () => {
      logger.info(`ri-api running on port ${PORT}`, { env: env.NODE_ENV });
    });
  });
}

module.exports = app;
