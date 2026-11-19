const router = require('express').Router();
const { requireRole, requireUser } = require('../middleware/auth');
const fareController = require('../controllers/fareController');
const rideController = require('../controllers/rideController');
const driverController = require('../controllers/driverController');

// Rider endpoints
router.post('/fare', requireRole('rider'), fareController.create);
router.post('/rides', requireRole('rider'), rideController.request);

// Shared trip inspection
router.get('/rides/:rideId', requireUser, rideController.get);

// Driver trip actions
router.patch('/rides/:rideId', requireRole('driver'), rideController.respond);
router.post('/rides/:rideId/complete', requireRole('driver'), rideController.complete);

// Driver availability status and incoming offer polling
router.patch('/drivers/status', requireRole('driver'), driverController.setStatus);
router.get('/drivers/offer', requireRole('driver'), driverController.getOffer);

module.exports = router;