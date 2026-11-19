const { pool } = require('../config/db');

// Supports executing either on the main pool or inside an ongoing transaction client
const run = (client) => client || pool;
const first = (result) => result.rows[0] || null;

// Creates initial ride row when rider requests a fare estimate
async function create({ riderId, fare, eta, source, destination }) {
    const result = await pool.query(
        `INSERT INTO rides (rider_id, fare, eta, source, destination)
     VALUES ($1, $2, $3, $4, $5) 
     RETURNING *`,
        [riderId, fare, eta, JSON.stringify(source), JSON.stringify(destination)]
    );
    return first(result);
}

async function findById(id) {
    const result = await pool.query('SELECT * FROM rides WHERE id = $1', [id]);
    return first(result);
}

// Transition: fare-estimated -> requested
async function markRequested(id, riderId) {
    const result = await pool.query(
        `UPDATE rides 
     SET status = 'requested'
     WHERE id = $1 AND rider_id = $2 AND status = 'fare-estimated' 
     RETURNING *`,
        [id, riderId]
    );
    return first(result);
}

// Transition: requested -> accepted (assigned driver accepts the offer)
async function markAccepted(id, driverId, client) {
    const result = await run(client).query(
        `UPDATE rides 
     SET status = 'accepted'
     WHERE id = $1 AND driver_id = $2 AND status = 'requested' 
     RETURNING *`,
        [id, driverId]
    );
    return first(result);
}

// Transition: accepted -> completed
async function markCompleted(id, driverId) {
    const result = await pool.query(
        `UPDATE rides 
     SET status = 'completed'
     WHERE id = $1 AND driver_id = $2 AND status = 'accepted' 
     RETURNING *`,
        [id, driverId]
    );
    return first(result);
}

// Check if a ride is currently offered to a specific driver
async function findOfferedTo(id, driverId) {
    const result = await pool.query(
        `SELECT * FROM rides 
     WHERE id = $1 AND driver_id = $2 AND status = 'requested'`,
        [id, driverId]
    );
    return first(result);
}

// Check if a driver has an incoming pending offer
async function findCurrentOfferFor(driverId) {
    const result = await pool.query(
        `SELECT * FROM rides 
     WHERE driver_id = $1 AND status = 'requested' 
     LIMIT 1`,
        [driverId]
    );
    return first(result);
}

// Partial update used by the matching service (assigning driver, no-driver-found)
const COLUMNS = { driverId: 'driver_id', status: 'status' };
async function update(id, fields) {
    const sets = [];
    const values = [id];

    for (const [key, column] of Object.entries(COLUMNS)) {
        if (key in fields) {
            values.push(fields[key]);
            sets.push(`${column} = $${values.length}`);
        }
    }

    if (!sets.length) return null;

    const result = await pool.query(
        `UPDATE rides SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
        values
    );
    return first(result);
}

module.exports = {
    create,
    findById,
    markRequested,
    markAccepted,
    markCompleted,
    findOfferedTo,
    findCurrentOfferFor,
    update,
};