const redis = require('../config/redis');

// Publishes real-time push events to Redis channel 'user:<userId>'
async function notify(userId, title, body, data = {}) {
  console.log(`[push-notification] -> ${userId}: "${title}" - ${body}`, JSON.stringify(data));
  try {
    const payload = JSON.stringify({
      type: 'RIDE_OFFER',
      title,
      body,
      data,
      timestamp: new Date().toISOString()
    });
    await redis.publish(`user:${userId}`, payload);
  } catch (err) {
    console.error(`[matching:notify] Failed to publish event to user:${userId}:`, err.message);
  }
}

module.exports = notify;