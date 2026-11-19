const { pool } = require('../config/db');

// Helper to support both standalone queries and queries within transactions
const run = (client) => client || pool;
const first = (result) => result.rows[0] || null;

async function getStatus(id) {
  const { rows } = await pool.query('SELECT status FROM drivers WHERE id = $1', [id]);
  return rows[0]?.status || 'offline';
}

// Update driver status, but NEVER allow changing status while inRide
async function upsertStatus(id, status) {
  const result = await pool.query(
    `INSERT INTO drivers (id, status) 
     VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE 
     SET status = EXCLUDED.status
     WHERE drivers.status <> 'inRide' 
     RETURNING *`,
    [id, status]
  );
  return first(result);
}

// Direct status update (used by transactions on ride completion or accept)
async function setStatus(id, status, client) {
  return run(client).query('UPDATE drivers SET status = $2 WHERE id = $1', [id, status]);
}

module.exports = {
  getStatus,
  upsertStatus,
  setStatus,
};