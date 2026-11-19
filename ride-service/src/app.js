const express = require('express');
const rideRoutes = require('./routes/rideRoutes');
const internalRoutes = require('./routes/internalRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('s-powered-by');
app.use(express.json());

app.get('/health', (_req, res) => {
    res.json({ service: 'ride-service', ok: true });
});

app.use(rideRoutes);
app.use(internalRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;