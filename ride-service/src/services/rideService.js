const { withTransaction } = require('../config/db');
const rideModel = require('../models/rideModel');
const driverModel = require('../models/driverModel');
const matchingClient = require('../clients/matchingClient');
const AppError = require('../utils/AppError');

// Rider requests the ride (fare-estimated -> requested)
async function requestRide(riderId, fareId) {
    const ride = await rideModel.markRequested(fareId, riderId);
    if (!ride) {
        throw new AppError(409, 'fare not found, not yours, or already requested');
    }

    // Trigger matching-service asynchronously in the background
    matchingClient.startMatch(ride.id).catch((err) => {
        console.error('[ride-service] matching call failed:', err.message);
    });

    return ride;
}

// Fetch ride (accessible only to the rider or assigned driver)
async function getForUser(rideId, user) {
    const ride = await rideModel.findById(rideId);
    if (!ride || (ride.rider_id !== user.id && ride.driver_id !== user.id)) {
        throw new AppError(404, 'not found');
    }
    return ride;
}

// Driver responds to an offer: accept or deny
async function respond(rideId, driverId, action) {
    return action === 'accept' ? accept(rideId, driverId) : deny(rideId, driverId);
}

// Atomic acceptance: ride -> accepted AND driver -> inRide
async function accept(rideId, driverId) {
    const ride = await withTransaction(async (client) => {
        const updated = await rideModel.markAccepted(rideId, driverId, client);
        if (!updated) return null;
        await driverModel.setStatus(driverId, 'inRide', client);
        return updated;
    });

    if (!ride) {
        throw new AppError(409, 'ride is not currently offered to you');
    }

    return ride;
}

// Driver denies the offer -> inform matching-service to forward to next driver
async function deny(rideId, driverId) {
    const ride = await rideModel.findOfferedTo(rideId, driverId);
    if (!ride) {
        throw new AppError(409, 'ride is not currently offered to you');
    }

    await matchingClient.decline(rideId, driverId);
    return { ...ride, driver_id: null, status: 'requested' };
}

// Driver completes ride -> reset driver to available
async function complete(rideId, driverId) {
    const ride = await rideModel.markCompleted(rideId, driverId);
    if (!ride) {
        throw new AppError(409, 'no active ride to complete');
    }

    await driverModel.setStatus(driverId, 'available');
    return ride;
}

// Check if driver currently has an active incoming offer
async function currentOfferFor(driverId) {
    return rideModel.findCurrentOfferFor(driverId);
}

// Used by matching-service via internal routes
async function getById(rideId) {
    const ride = await rideModel.findById(rideId);
    if (!ride) throw new AppError(404, 'not found');
    return ride;
}

async function internalUpdate(rideId, fields) {
    const ride = await rideModel.update(rideId, fields);
    if (!ride) throw new AppError(404, 'not found or nothing to update');
    return ride;
}

module.exports = {
    requestRide,
    getForUser,
    respond,
    complete,
    currentOfferFor,
    getById,
    internalUpdate,
};