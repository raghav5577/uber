// Transforms a raw PostgreSQL row into the clean JSON object returned by the API
function present(row) {
    if (!row) return null;

    return {
        id: row.id,
        riderId: row.rider_id,
        driverId: row.driver_id,
        fare: Number(row.fare),
        eta: row.eta,
        source: row.source,
        destination: row.destination,
        status: row.status,
        createdAt: row.created_at,
    };
}

module.exports = {
    present,
};