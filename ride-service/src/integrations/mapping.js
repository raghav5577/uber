// 3rd-party mapping adapter with real OSRM road routing and Haversine fallback.
// OSRM (Open Source Routing Machine) calculates real turn-by-turn road networks,
// actual driving distances, and travel times based on OpenStreetMap data.

const toRad = (deg) => (deg * Math.PI) / 180;

function haversineKm(coord1, coord2) {
    const R = 6371; // Earth radius in km
    const dLat = toRad(coord2.lat - coord1.lat);
    const dLng = toRad(coord2.lng - coord1.lng);

    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(coord1.lat)) * Math.cos(toRad(coord2.lat)) * Math.sin(dLng / 2) ** 2;

    return 2 * R * Math.asin(Math.sqrt(h));
}

function calculateFare(distanceKm, etaMinutes) {
    // Pricing formula: Base 30 INR + 12/km + 1.50/min
    return +(30 + distanceKm * 12 + etaMinutes * 1.5).toFixed(2);
}

// Fallback: Haversine straight-line multiplied by city road factor (1.3x)
function estimateHaversine(pickup, destination) {
    const distanceKm = +(haversineKm(pickup, destination) * 1.3).toFixed(2);
    const etaMinutes = Math.max(1, Math.round((distanceKm / 30) * 60)); // 30 km/h average city driving
    return {
        distanceKm,
        etaMinutes,
        fare: calculateFare(distanceKm, etaMinutes),
        currency: 'INR',
        provider: 'haversine',
    };
}

// Real-world Road Routing via OSRM (Open Source Routing Machine)
async function estimateOSRM(pickup, destination) {
    // OSRM expects coordinates in order: lng,lat;lng,lat
    const url = `https://router.project-osrm.org/route/v1/driving/${pickup.lng},${pickup.lat};${destination.lng},${destination.lat}?overview=false`;

    const res = await fetch(url, {
        signal: AbortSignal.timeout(4000), // 4-second timeout
    });

    if (!res.ok) {
        throw new Error(`OSRM responded with status ${res.status}`);
    }

    const data = await res.json();
    if (!data.routes || !data.routes.length) {
        throw new Error('OSRM found no driving route between coordinates');
    }

    const primaryRoute = data.routes[0];
    const distanceKm = +(primaryRoute.distance / 1000).toFixed(2); // meters -> km
    const etaMinutes = Math.max(1, Math.round(primaryRoute.duration / 60)); // seconds -> minutes

    return {
        distanceKm,
        etaMinutes,
        fare: calculateFare(distanceKm, etaMinutes),
        currency: 'INR',
        provider: 'osrm',
    };
}

// Google Maps Distance Matrix API (activated when MAPS_API_KEY is present)
async function estimateGoogle(pickup, destination, apiKey) {
    const origins = `${pickup.lat},${pickup.lng}`;
    const destinations = `${destination.lat},${destination.lng}`;
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins}&destinations=${destinations}&key=${apiKey}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error(`Google Maps API error: ${res.status}`);

    const data = await res.json();
    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== 'OK') {
        throw new Error(`Google Maps route status: ${element?.status || 'Unknown'}`);
    }

    const distanceKm = +(element.distance.value / 1000).toFixed(2);
    const etaMinutes = Math.max(1, Math.round(element.duration.value / 60));

    return {
        distanceKm,
        etaMinutes,
        fare: calculateFare(distanceKm, etaMinutes),
        currency: 'INR',
        provider: 'google',
    };
}

async function estimate(pickup, destination) {
    const apiKey = process.env.MAPS_API_KEY;

    // 1. If Google Maps API Key is configured, prioritize Google Maps
    if (apiKey) {
        try {
            return await estimateGoogle(pickup, destination, apiKey);
        } catch (err) {
            console.warn('[mapping] Google Maps API failed, trying OSRM:', err.message);
        }
    }

    // 2. Default to OSRM (100% Free real road routing)
    try {
        return await estimateOSRM(pickup, destination);
    } catch (err) {
        console.warn('[mapping] OSRM routing failed, falling back to Haversine:', err.message);
    }

    // 3. Fallback: High-precision Haversine road estimation
    return estimateHaversine(pickup, destination);
}

module.exports = {
    estimate,
};
