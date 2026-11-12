const redis = require('../config/redis');

const GEO_KEY = 'drivers:locations';
const ALIVE_TTL_SEC = 30;
const NEARBY_LIMIT = 25

const aliveKey = (driverId)=> `driver:${driverId}:alive`;

async function updateDriverLocation(driverId, lat, lng) {
    await redis
    .multi()
    .geoadd(GEO_KEY, lng, lat, driverId)
    .set(aliveKey(driverId), '1', 'EX', ALIVE_TTL_SEC)
    .exec();
}
async function getNearbyDrivers(lat, lng, radiusinKM) {
    const results = await redis.geosearch(
        GEO_KEY,
        'FROMLONLAT',
        lng,
        lat,
        'BYRADIUS',
        radiusinKM,
        'km',
        'ASC',
        'WITHDIST',
        'COUNT',
        NEARBY_LIMIT
    )
    const drivers = [];

    for(const [driverId, distance] of results) {
        if (await redis.exists(aliveKey(driverId))) {
            drivers.push({
                driverId,
                distanceinKM: Number.parseFloat(distance),
            });
        }
    }
    return drivers;
}
async function removeDriverLocation(driverId) {
    await redis.zrem(GEO_KEY, driverId);
    await redis.del(aliveKey(driverId));
}

module.exports = {
    updateDriverLocation,
    getNearbyDrivers,
    removeDriverLocation,
};