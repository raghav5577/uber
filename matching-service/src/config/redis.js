const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

const redis = new Redis(REDIS_URL);

redis.on('error', (err) => {
  console.error('[matching-service] redis error:', err.message);
});

module.exports = redis;
