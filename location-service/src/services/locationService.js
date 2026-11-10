const driverLocation = require('../models/driverLocation');

async function updateLocation(driverId, lat,lng){
    return driverLocation.updateDriverLocation(driverId, lat, lng);
}
async function findNearby(lat,lng,radiusKm){
    return driverLocation.getNearbyDrivers(lat, lng, radiusKm);
}
async function removeDriver(driverId){
    return driverLocation.removeDriverLocation(driverId);
}

module.exports = {
    updateLocation,
    findNearby,
    removeDriver,
}