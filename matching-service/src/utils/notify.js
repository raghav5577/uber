// Push notification stub (in production, integrate with FCM / APNs / WebSockets)
function notify(userId, title, body, data = {}) {
  console.log(`[push-notification] -> ${userId}: "${title}" - ${body}`, JSON.stringify(data));
}

module.exports = notify;
