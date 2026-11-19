const { request } = require('../utils/httpClient');

const LOCATION_SERVICE_URL = process.env.LOCATION_SERVICE_URL || 'http://localhost:3003';

// Tell location-service to remove driver from Redis GEO index
async function removeDriver(driverId) {
    return request(`${LOCATION_SERVICE_URL}/internal/drivers/${driverId}`, 'DELETE');
}

module.exports = {
    removeDriver,
};