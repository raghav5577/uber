const router = require('express').Router();
const { internalOnly } = require('../middleware/auth');
const internalController = require('../controllers/internalController');

// Protected internal routes (authenticated via x-internal-key)
router.get('/internal/drivers/:id/status', internalOnly, internalController.driverStatus);
router.get('/internal/rides/:id', internalOnly, internalController.getRide);
router.patch('/internal/rides/:id', internalOnly, internalController.updateRide);

module.exports = router;