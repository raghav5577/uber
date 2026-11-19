const AppError = require('../utils/AppError');
const driverService = require('../services/driverService');
const rideService = require('../services/rideService');
const rideView = require('../views/rideView');

// PATCH /drivers/status  Body: { status: "available" | "offline" }
async function setStatus(req, res) {
    const { status } = req.body || {};

    if (!['available', 'offline'].includes(status)) {
        throw new AppError(400, 'status must be "available" or "offline"');
    }

    await driverService.setStatus(req.user.id, status);
    res.json({ driverId: req.user.id, status });
}

// GET /drivers/offer  (Poll for incoming ride offer)
async function getOffer(req, res) {
    const ride = await rideService.currentOfferFor(req.user.id);
    res.json({ offer: ride ? rideView.present(ride) : null });
}

module.exports = {
    setStatus,
    getOffer,
};