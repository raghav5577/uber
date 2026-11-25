const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const { subscriber } = require('../config/redis');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';

// Maps userId -> Set of active WebSocket connections
const userSockets = new Map();

function initWebSocketServer(httpServer) {
    const wss = new WebSocketServer({ noServer: true });

    // Handle HTTP -> WebSocket protocol upgrade
    httpServer.on('upgrade', (req, socket, head) => {
        // Only handle upgrades on /ws
        const url = new URL(req.url, `http://${req.headers.host}`);
        if (url.pathname !== '/ws') {
            return;
        }

        const token = url.searchParams.get('token');
        if (!token) {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
            return;
        }

        try {
            const payload = jwt.verify(token, JWT_SECRET);
            req.user = { id: String(payload.sub), role: String(payload.role) };

            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit('connection', ws, req);
            });
        } catch {
            socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
            socket.destroy();
        }
    });

    // Client connected
    wss.on('connection', (ws, req) => {
        const { id: userId, role } = req.user;
        console.log(`[ws] Client connected: user=${userId} (${role})`);

        if (!userSockets.has(userId)) {
            userSockets.set(userId, new Set());
            // Subscribe to Redis channel for this user
            subscriber.subscribe(`user:${userId}`).catch(console.error);
        }
        userSockets.get(userId).add(ws);

        // Send welcome confirmation
        ws.send(JSON.stringify({
            type: 'CONNECTED',
            data: { userId, role, message: 'Real-time WebSocket connected successfully' }
        }));

        // Allow client to join ride-specific room (e.g. for live GPS tracking)
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw);
                if (msg.action === 'SUBSCRIBE_RIDE' && msg.rideId) {
                    subscriber.subscribe(`ride:${msg.rideId}`).catch(console.error);
                    ws.send(JSON.stringify({ type: 'SUBSCRIBED', rideId: msg.rideId }));
                }
            } catch (_) { }
        });

        // Cleanup on disconnect
        ws.on('close', () => {
            console.log(`[ws] Client disconnected: user=${userId}`);
            const sockets = userSockets.get(userId);
            if (sockets) {
                sockets.delete(ws);
                if (sockets.size === 0) {
                    userSockets.delete(userId);
                    subscriber.unsubscribe(`user:${userId}`).catch(console.error);
                }
            }
        });
    });

    // Listen for broadcasted events from microservices via Redis
    subscriber.on('message', (channel, message) => {
        try {
            const parsed = JSON.parse(message);

            // 1. User-specific message (e.g. user:driver_101)
            if (channel.startsWith('user:')) {
                const targetUserId = channel.replace('user:', '');
                const sockets = userSockets.get(targetUserId);
                if (sockets) {
                    for (const ws of sockets) {
                        if (ws.readyState === ws.OPEN) {
                            ws.send(JSON.stringify(parsed));
                        }
                    }
                }
            }

            // 2. Ride broadcast (e.g. ride:58a53e83-...)
            if (channel.startsWith('ride:')) {
                wss.clients.forEach((client) => {
                    if (client.readyState === client.OPEN) {
                        client.send(JSON.stringify(parsed));
                    }
                });
            }
        } catch (err) {
            console.error('[ws:redis] Error dispatching message:', err);
        }
    });

    return wss;
}

module.exports = {
    initWebSocketServer
};