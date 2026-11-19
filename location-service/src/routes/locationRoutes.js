const router = require('express').Router();
const {requireRole, internalOnly} = require('../middleware/auth');
const locationController = require('../controllers/locationController');

router.post('/drivers/location', requireRole('driver'), locationController.update);

router.get('/internal/drivers/nearby', internalOnly, locationController.nearby);
router.delete('/internal/drivers/:id', internalOnly, locationController.remove);

module.exports = router;