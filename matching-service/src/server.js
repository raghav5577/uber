// Automatically load root .env if running locally outside Docker
try {
  process.loadEnvFile('../.env');
} catch (_) {}

const app = require('./app');

const PORT = process.env.PORT || 3002;

process.on('unhandledRejection', (err) => {
  console.error('[matching-service] unhandledRejection:', err);
});

app.listen(PORT, () => {
  console.log(`[matching-service] listening on :${PORT}`);
});
