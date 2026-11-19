// Formats the response for POST /fare
function present({ ride, estimate }, pickupLocation, destination) {
    return {
        fareId: ride.id,
        fare: estimate.fare,
        currency: estimate.currency,
        eta: estimate.etaMinutes,
        distanceKm: estimate.distanceKm,
        pickupLocation,
        destination,
    };
}

module.exports = {
    present,
};