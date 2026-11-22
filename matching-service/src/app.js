const express = require('express');
const matchingRoutes = require('./routes/matchingRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.json({ service: 'matching-service', ok: true });
});

// Internal matching routes: mounted at /internal
app.use('/internal', matchingRoutes);

// 404 and Error Handlers
app.use(notFound);
app.use(errorHandler);

module.exports = app;
