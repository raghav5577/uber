// 3rd-party mapping adapter.
// In production, replace this with Google Distance Matrix or Mapbox API.
// Calculates distance, ETA, and fare quote based on coordinates.

const toRad = (deg) => (deg * Math.PI) / 180;

function haversineKm(coord1, coord2) {
    const R = 6371; // Earth radius in kilometers
    const dLat = toRad(coord2.lat - coord1.lat);
    const dLng = toRad(coord2.lng - coord1.lng);

    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(coord1.lat)) * Math.cos(toRad(coord2.lat)) * Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(h));
}

async function estimate(pickup, destination) {
    // Multiply straight-line distance by 1.3 to simulate real-world road curves
    const distanceKm = +(haversineKm(pickup, destination) * 1.3).toFixed(2);

    // Assume 30 km/h average city driving speed
    const etaMinutes = Math.max(1, Math.round((distanceKm / 30) * 60));

    // Pricing formula: Base 30 INR + 12/km + 1.50/min
    const fare = +(30 + distanceKm * 12 + etaMinutes * 1.5).toFixed(2);

    return {
        distanceKm,
        etaMinutes,
        fare,
        currency: 'INR',
    };
}

module.exports = {
    estimate,
};