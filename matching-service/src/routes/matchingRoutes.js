const router = require('express').Router();
const { internalOnly } = require('../middleware/auth');
const matchingController = require('../controllers/matchingController');

// All matching routes are internal-only
router.use(internalOnly);

router.post('/match', matchingController.start);
router.post('/match/decline', matchingController.decline);

module.exports = router;
