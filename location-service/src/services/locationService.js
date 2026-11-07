const driverLocation = require('../models/driverLocation');

async function updateLocation(driverId, lat,lng){
    return driverLocation.updateDriverLocation(driverId, lat, lng);
}