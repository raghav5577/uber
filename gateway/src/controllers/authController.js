const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-jwt-secret-change-me';
const NODE_ENV = process.env.NODE_ENV || 'development';

// DEV ONLY: POST /auth/token  { userId, role: "rider" | "driver" }
exports.issueDevToken = (req, res) => {
    if (NODE_ENV === 'production') throw new AppError(404, 'not found');
    const { userId, role } = req.body || {};
    if (!userId || !['rider', 'driver'].includes(role)) {
        throw new AppError(400, 'userId and role (rider|driver) required');
    }
    res.json({ token: jwt.sign({ sub: userId, role }, JWT_SECRET, { expiresIn: '12h' }) });
};