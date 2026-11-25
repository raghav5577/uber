const express = require('express');
const rateLimiter = require('./middleware/rateLimiter');
const authenticate = require('./middleware/authenticate');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
app.disable('x-powered-by');

// Health check
app.get('/health', (_req, res) => res.json({ service: 'gateway', ok: true }));

// Global middleware pipeline
app.use(rateLimiter);
app.use('/auth', require('./routes/authRoutes')); // Public (issues dev tokens)
app.use(authenticate);                             // Everything below requires valid JWT
app.use(require('./routes/proxyRoutes'));           // Upstream reverse proxy
app.use(notFound);
app.use(errorHandler);

module.exports = app;