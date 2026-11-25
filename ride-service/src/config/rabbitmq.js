const amqp = require('amqplib');

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';
const QUEUE_NAME = 'ride.match.queue';

let channel = null;

async function getChannel() {
    if (channel) return channel;

    try {
        const conn = await amqp.connect(RABBITMQ_URL);
        conn.on('error', (err) => console.error('[ride-service:rabbitmq] Connection error:', err.message));
        conn.on('close', () => {
            console.warn('[ride-service:rabbitmq] Connection closed. Reconnecting...');
            channel = null;
            setTimeout(getChannel, 3000);
        });

        channel = await conn.createChannel();
        // Durable queue: messages survive broker restarts
        await channel.assertQueue(QUEUE_NAME, { durable: true });
        console.log(`[ride-service:rabbitmq] Connected and asserted queue: ${QUEUE_NAME}`);
        return channel;
    } catch (err) {
        console.warn('[ride-service:rabbitmq] Broker connection failed:', err.message);
        channel = null;
        return null;
    }
}

// Publish ride.requested event into the durable queue
async function publishRideRequested(rideId) {
    const ch = await getChannel();
    const payload = JSON.stringify({
        event: 'ride.requested',
        rideId,
        timestamp: new Date().toISOString()
    });

    if (ch) {
        ch.sendToQueue(QUEUE_NAME, Buffer.from(payload), { persistent: true });
        console.log(`[ride-service:rabbitmq] Published event to ${QUEUE_NAME} -> rideId: ${rideId}`);
        return true;
    }
    return false;
}

module.exports = {
    publishRideRequested
};