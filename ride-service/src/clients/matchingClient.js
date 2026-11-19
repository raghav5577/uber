const { request } = require('../utils/httpClient');

const MATCHING_SERVICE_URL = process.env.MATCHING_SERVICE_URL || 'http://localhost:3002';

async function startMatch(rideId) {
    return request(`${MATCHING_SERVICE_URL}/internal/match`, 'POST', { rideId });
}

async function decline(rideId, driverId) {
    return request(`${MATCHING_SERVICE_URL}/internal/match/decline`, 'POST', { rideId, driverId });
}

module.exports = {
    startMatch,
    decline,
};