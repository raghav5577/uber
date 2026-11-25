// Automatically load root .env if running locally outside Docker
try {
    process.loadEnvFile('../.env');
} catch (_) { }

const http = require('http');
const app = require('./app');
const { initWebSocketServer } = require('./realtime/webSocketServer');

const PORT = process.env.PORT || 3000;

process.on('unhandledRejection', (err) => {
    console.error('[gateway] unhandledRejection:', err);
});

// Create standard HTTP server wrapping Express
const server = http.createServer(app);

// Attach the WebSocket server
initWebSocketServer(server);

server.listen(PORT, () => {
    console.log(`[gateway] listening on :${PORT} (HTTP + WebSockets)`);
});