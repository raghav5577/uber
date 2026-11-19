function notFound(_req, res) {
    res.status(404).json({ error: 'not found' });
}

// Express error middleware requires all 4 parameters: (err, req, res, next)
// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
    const status = err.status || 500;

    if (status >= 500) {
        console.error('[ride-service error]', err);
    }

    res.status(status).json({
        error: status >= 500 ? 'internal error' : err.message,
    });
}

module.exports = {
    notFound,
    errorHandler,
};