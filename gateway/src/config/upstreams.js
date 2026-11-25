// Routing table: which URL prefixes forward to which downstream service
const RIDE_SERVICE_URL = process.env.RIDE_SERVICE_URL || 'http://localhost:3001';
const LOCATION_SERVICE_URL = process.env.LOCATION_SERVICE_URL || 'http://localhost:3003';

module.exports = [
  {
    name: 'ride-service',
    target: RIDE_SERVICE_URL,
    prefixes: ['/fare', '/rides', '/drivers/status', '/drivers/offer']
  },
  {
    name: 'location-service',
    target: LOCATION_SERVICE_URL,
    prefixes: ['/drivers/location']
  }
];