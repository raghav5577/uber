const AppError = require('../utils/AppError');

const INTERNAL_KEY = process.env.INTERNAL_KEY || 'dev-internal-key-change-me';

function internalOnly(req, _res, next) {
  if (req.headers['x-internal-key'] === INTERNAL_KEY) {
    return next();
  }
  throw new AppError(403, 'forbidden');
}

module.exports = {
  internalOnly,
};
