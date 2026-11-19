const AppError = require('../utils/AppError');
const rideService = require('../services/rideService');
const driverService = require('../services/driverService');
const rideView = require('../views/rideView');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_STATUS = ['requested', 'accepted', 'completed', 'no-driver-found'];

// GET /internal/drivers/:id/status
async function driverStatus(req, res) {
    const status = await driverService.getStatus(req.params.id);
    res.json({ driverId: req.params.id, status });
}

// GET /internal/rides/:id
async function getRide(req, res) {
    if (!UUID_REGEX.test(req.params.id)) {
        throw new AppError(400, 'invalid ride UUID');
    }

    const ride = await rideService.getById(req.params.id);
    res.json(rideView.present(ride));
}

// PATCH /internal/rides/:id  Body: { driverId?: string, status?: string }
async function updateRide(req, res) {
    if (!UUID_REGEX.test(req.params.id)) {
        throw new AppError(400, 'invalid ride UUID');
    }

    const body = req.body || {};
    if ('status' in body && !ALLOWED_STATUS.includes(body.status)) {
        throw new AppError(400, 'invalid ride status');
    }

    const fields = {};
    if ('driverId' in body) fields.driverId = body.driverId;
    if ('status' in body) fields.status = body.status;

    const ride = await rideService.internalUpdate(req.params.id, fields);
    res.json(rideView.present(ride));
}

module.exports = {
    driverStatus,
    getRide,
    updateRide,
};