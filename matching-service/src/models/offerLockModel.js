// Ensures one open offer per driver at a time: driver:{id}:offer = rideId (EX 15, NX)
const redis = require('../config/redis');

const OFFER_TTL_SEC = 15; // Driver has 15 seconds to accept before offer expires
const key = (driverId) => `driver:${driverId}:offer`;

async function acquire(driverId, rideId) {
  // SET ... EX 15 NX returns 'OK' only if key didn't already exist
  const res = await redis.set(key(driverId), rideId, 'EX', OFFER_TTL_SEC, 'NX');
  return res === 'OK';
}

async function release(driverId) {
  return redis.del(key(driverId));
}

module.exports = {
  acquire,
  release,
  OFFER_TTL_SEC,
};
