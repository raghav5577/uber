const AppError = require('../utils/AppError');
const INTERNAL_KEY = process.env.INTERNAL_KEY||'dev-internal-key-change-me';

function identity(req){
    return {
        id: req.headers['x-user-id'],
        role: req.headers['x-user-role']
    };
}
//for RBAC
function requireRole(role){
    return (req,_res,next)=>{
        const user = identity(req);
        if(user.role != role){
            throw new AppError(403,`${role} role required`);
        }
        req.user = user;
        next();
    };
}

//protects internal endpoints like nearby drivers by checking INTERNAL_KEY
function internalOnly(req, _res,next){
    if(req.headers['x-internal-key']===INTERNAL_KEY){
        return next();
    }
    throw new AppError(403, 'forbidden');
}

module.exports = {
    requireRole,
    internalOnly
};