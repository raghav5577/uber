const { request } = require('../utils/httpClient');

const LOCATION_SERVICE_URL = process.env.LOCATION_SERVICE_URL || 'http://localhost:3003';

// Queries Location Service for drivers sorted by distance
async function nearbyDrivers(lat, lng, radiusKm) {
  return request(
    `${LOCATION_SERVICE_URL}/internal/drivers/nearby?lat=${lat}&lng=${lng}&radiusKm=${radiusKm}`
  );
}

module.exports = {
  nearbyDrivers,
};
