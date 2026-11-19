const AppError = require('../utils/AppError');
const rideService = require('../services/rideService');
const rideView = require('../views/rideView');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireRideId(req) {
    const id = req.params.rideId;
    if (!id || !UUID_REGEX.test(id)) {
        throw new AppError(400, 'invalid rideId UUID');
    }
    return id;
}

// POST /rides  Body: { fareId }
async function request(req, res) {
    const { fareId } = req.body || {};
    if (!fareId || !UUID_REGEX.test(fareId)) {
        throw new AppError(400, 'valid fareId UUID required');
    }

    const ride = await rideService.requestRide(req.user.id, fareId);
    res.status(201).json(rideView.present(ride));
}

// GET /rides/:rideId
async function get(req, res) {
    const ride = await rideService.getForUser(requireRideId(req), req.user);
    res.json(rideView.present(ride));
}

// PATCH /rides/:rideId  Body: { action: "accept" | "deny" }
async function respond(req, res) {
    const rideId = requireRideId(req);
    const { action } = req.body || {};

    if (!['accept', 'deny'].includes(action)) {
        throw new AppError(400, 'action must be either "accept" or "deny"');
    }

    const ride = await rideService.respond(rideId, req.user.id, action);
    res.json(rideView.present(ride));
}

// POST /rides/:rideId/complete
async function complete(req, res) {
    const ride = await rideService.complete(requireRideId(req), req.user.id);
    res.json(rideView.present(ride));
}

module.exports = {
    request,
    get,
    respond,
    complete,
};
