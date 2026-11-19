const driverModel = require('../models/driverModel');
const locationClient = require('../clients/locationClient');
const AppError = require('../utils/AppError');

async function setStatus(driverId, status) {
    const row = await driverModel.upsertStatus(driverId, status);
    if (!row) {
        throw new AppError(409, 'cannot change status while inRide');
    }

    // When going offline, delete coordinates from Redis GEO
    if (status === 'offline') {
        locationClient.removeDriver(driverId).catch(() => { });
    }

    return row;
}

async function getStatus(driverId) {
    return driverModel.getStatus(driverId);
}

module.exports = {
    setStatus,
    getStatus
}; 