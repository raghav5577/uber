const { request } = require('../utils/httpClient');

const RIDE_SERVICE_URL = process.env.RIDE_SERVICE_URL || 'http://localhost:3001';

async function getRide(rideId) {
  return request(`${RIDE_SERVICE_URL}/internal/rides/${rideId}`);
}

async function getDriverStatus(driverId) {
  return request(`${RIDE_SERVICE_URL}/internal/drivers/${driverId}/status`);
}

async function assignDriver(rideId, driverId) {
  return request(`${RIDE_SERVICE_URL}/internal/rides/${rideId}`, 'PATCH', { driverId });
}

async function markNoDriverFound(rideId) {
  return request(`${RIDE_SERVICE_URL}/internal/rides/${rideId}`, 'PATCH', {
    status: 'no-driver-found',
    driverId: null,
  });
}

module.exports = {
  getRide,
  getDriverStatus,
  assignDriver,
  markNoDriverFound,
};
