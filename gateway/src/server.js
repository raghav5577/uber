// Automatically load root .env if running locally outside Docker
try {
    process.loadEnvFile('../.env');
} catch (_) { }

const app = require('./app');

const PORT = process.env.PORT || 3000;

process.on('unhandledRejection', (err) => {
    console.error('[gateway] unhandledRejection:', err);
});

app.listen(PORT, () => {
    console.log(`[gateway] listening on :${PORT}`);
});