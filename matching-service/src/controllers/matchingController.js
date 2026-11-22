const AppError = require('../utils/AppError');
const matchingService = require('../services/matchingService');
const matchView = require('../views/matchView');

// POST /internal/match  Body: { rideId }
async function start(req, res) {
  const { rideId } = req.body || {};
  if (!rideId) {
    throw new AppError(400, 'rideId required');
  }

  const result = await matchingService.findAndOffer(rideId);
  res.json(matchView.present(result));
}

// POST /internal/match/decline  Body: { rideId, driverId }
async function decline(req, res) {
  const { rideId, driverId } = req.body || {};
  if (!rideId || !driverId) {
    throw new AppError(400, 'rideId and driverId required');
  }

  const result = await matchingService.decline(rideId, driverId);
  res.json(matchView.present(result));
}

module.exports = {
  start,
  decline,
};
