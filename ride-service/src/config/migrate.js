const fs = require('fs');
const path = require('path');
const { pool } = require('./db');

const schemaPath = path.join(__dirname, '../../db/schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

// Runs schema.sql with automatic retry on boot
async function migrate(retries = 10) {
    for (let i = 1; i <= retries; i++) {
        try {
            await pool.query(schema);
            console.log('[ride-service] database schema ready');
            return;
        } catch (err) {
            if (i === retries) {
                throw err;
            }
            console.log(`[ride-service] database not ready yet (${i}/${retries}): ${err.message}. Retrying in 1.5s...`);
            await new Promise((resolve) => setTimeout(resolve, 1500));
        }
    }
}

module.exports = migrate;