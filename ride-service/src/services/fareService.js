const rideModel = require('../models/rideModel');
const mapping = require('../integrations/mapping');

// Calculates fare estimate and saves an initial row (fareId === ride.id)
async function createEstimate(riderId, pickup, destination) {
    const estimate = await mapping.estimate(pickup, destination);

    const ride = await rideModel.create({
        riderId,
        fare: estimate.fare,
        eta: estimate.etaMinutes,
        source: pickup,
        destination,
    });

    return { ride, estimate };
}

module.exports = {
    createEstimate,
};