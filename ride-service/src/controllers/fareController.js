const AppError = require('../utils/AppError');
const fareService = require('../services/fareService');
const fareView = require('../views/fareView');

function isPoint(p) {
    return (
        !!p &&
        typeof p.lat === 'number' &&
        typeof p.lng === 'number' &&
        Math.abs(p.lat) <= 90 &&
        Math.abs(p.lng) <= 180
    );
}

// POST /fare  Body: { pickupLocation: { lat, lng }, destination: { lat, lng } }
async function create(req, res) {
    const { pickupLocation, destination } = req.body || {};

    if (!isPoint(pickupLocation) || !isPoint(destination)) {
        throw new AppError(400, 'pickupLocation and destination must be valid numeric lat/lng objects');
    }

    const result = await fareService.createEstimate(req.user.id, pickupLocation, destination);
    res.status(201).json(fareView.present(result, pickupLocation, destination));
}

module.exports = {
    create,
};