// Tracks drivers who denied or timed out for a ride: ride:{id}:declined = set(driverId) (EX 1h)
const redis = require('../config/redis');

const DECLINED_TTL_SEC = 3600; // 1 hour
const key = (rideId) => `ride:${rideId}:declined`;

async function add(rideId, driverId) {
  await redis.sadd(key(rideId), driverId);
  await redis.expire(key(rideId), DECLINED_TTL_SEC);
}

async function all(rideId) {
  const members = await redis.smembers(key(rideId));
  return new Set(members);
}

module.exports = {
  add,
  all,
};
