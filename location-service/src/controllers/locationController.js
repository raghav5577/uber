const AppError = require("../utils/AppError");
const locationService = require('../services/locationService');
const locationView = require('../views/locationView');


async function update(req,res){
    const {lat, lng}= req.body||{};
    if (typeof lat !== 'number' || typeof lng !== 'number' || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        throw new AppError(400, 'valid numeric lat/lng required');
    }
    await locationService.updateLocation(req.user.id, lat,lng);
    res.json(locationView.updated());
}

async function nearby(req,res){
    const lat = parseFloat(req.query.lat);
    const lng = parseFloat(req.query.lng);
    const radiusKm = parseFloat(req.query.radiusKm||'5');

    if([lat,lng,radiusKm].some(Number.isNaN)){
        throw new AppError(400,'lat, lng, radiusKm required');
    }

    const drivers = await locationService.findNearby(lat,lng,radiusKm);
    res.json(locationView.nearby(drivers));
}

async function remove(req,res){
    await locationService.removeDriver(req.params.id);
    res.json(locationView.updated());
}

module.exports = {
    update, 
    nearby,
    remove
};