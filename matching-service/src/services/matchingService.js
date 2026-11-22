const offerLock = require('../models/offerLockModel');
const declinedDrivers = require('../models/declinedDriversModel');
const rideClient = require('../clients/rideClient');
const locationClient = require('../clients/locationClient');
const notify = require('../utils/notify');

const SEARCH_RADII_KM = [2, 5, 10]; // Stepwise search expansion
const OFFER_TTL_SEC = 15;           // 15 seconds per driver offer

// Dispatches the ride offer to the nearest available driver
async function findAndOffer(rideId) {
  const ride = await rideClient.getRide(rideId);
  if (ride.status !== 'requested') {
    return { matched: false, reason: `ride is ${ride.status}` };
  }

  const declined = await declinedDrivers.all(rideId);
  const { lat, lng } = ride.source;

  // Search expanding radii (2km -> 5km -> 10km)
  for (const radiusKm of SEARCH_RADII_KM) {
    const { drivers } = await locationClient.nearbyDrivers(lat, lng, radiusKm);

    for (const driver of drivers) {
      // 1. Skip if driver already denied or timed out for this ride
      if (declined.has(driver.driverId)) continue;

      // 2. Check if driver is currently available in Ride Service
      const { status } = await rideClient.getDriverStatus(driver.driverId);
      if (status !== 'available') continue;

      // 3. Atomically acquire 15-second offer lock in Redis
      const acquired = await offerLock.acquire(driver.driverId, rideId);
      if (!acquired) continue; // Driver is already evaluating another offer

      // 4. Assign driver to ride in PostgreSQL
      await rideClient.assignDriver(rideId, driver.driverId);

      // 5. Notify driver of new incoming offer
      const distance = driver.distanceinKM || driver.distanceKm || 0;
      notify(driver.driverId, 'New ride request', `Pickup ${distance.toFixed(1)} km away`, {
        rideId,
        fare: ride.fare,
        source: ride.source,
        destination: ride.destination,
        expiresInSec: OFFER_TTL_SEC,
      });

      // 6. Set 15-second countdown timer to expire offer if driver doesn't answer
      setTimeout(() => {
        expireOffer(rideId, driver.driverId).catch((err) => {
          console.error('[matching-service] expireOffer error:', err.message);
        });
      }, (OFFER_TTL_SEC + 1) * 1000);

      return { matched: true, driverId: driver.driverId };
    }
  }

  // If all radii and candidates exhausted, mark no-driver-found
  await rideClient.markNoDriverFound(rideId);
  notify(ride.riderId, 'No drivers available', 'Sorry, no nearby drivers available right now.', { rideId });
  return { matched: false, reason: 'no-driver-found' };
}

// Driver denied or timed out: record decline, free Redis lock, try next driver
async function decline(rideId, driverId) {
  await declinedDrivers.add(rideId, driverId);
  await offerLock.release(driverId);
  await rideClient.assignDriver(rideId, null);
  return findAndOffer(rideId);
}

// Auto-expires if driver didn't accept within 15 seconds
async function expireOffer(rideId, driverId) {
  const ride = await rideClient.getRide(rideId);
  if (ride.status === 'requested' && ride.driverId === driverId) {
    console.log(`[matching-service] offer for ride ${rideId} to driver ${driverId} timed out`);
    await decline(rideId, driverId);
  }
}

module.exports = {
  findAndOffer,
  decline,
};
