const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

// Redis requires separate client connections for Pub/Sub subscription vs general commands
const publisher = new Redis(REDIS_URL, { lazyConnect: false });
const subscriber = new Redis(REDIS_URL, { lazyConnect: false });

publisher.on('error', (err) => console.error('[gateway:redis:pub] error:', err.message));
subscriber.on('error', (err) => console.error('[gateway:redis:sub] error:', err.message));

module.exports = {
    publisher,
    subscriber
};