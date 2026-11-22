const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';

// Verifies the JWT, then forwards identity to downstream services as trusted headers
module.exports = (req, _res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    try {
        const payload = jwt.verify(token, JWT_SECRET);
        delete req.headers['x-internal-key']; // Never allow a client to spoof internal calls
        req.headers['x-user-id'] = String(payload.sub);
        req.headers['x-user-role'] = String(payload.role);
        next();
    } catch {
        next(new AppError(401, 'invalid or missing token'));
    }
};