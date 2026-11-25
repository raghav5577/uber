const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
let redis;

function getRedis() {
    if (!redis) {
        redis = new Redis(REDIS_URL, { lazyConnect: false });
        redis.on('error', (err) => console.error('[ride-service:notify] redis error:', err.message));
    }
    return redis;
}

// Publishes real-time ride state transitions to user channel (e.g. user:rider_001)
async function notify(userId, type, data = {}) {
    try {
        const client = getRedis();
        const payload = JSON.stringify({
            type,
            data,
            timestamp: new Date().toISOString()
        });
        await client.publish(`user:${userId}`, payload);
    } catch (err) {
        console.error(`[ride-service:notify] Failed to publish ${type} to user:${userId}:`, err.message);
    }
}

module.exports = notify;