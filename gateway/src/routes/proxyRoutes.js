const router = require('express').Router();
const { createProxyMiddleware } = require('http-proxy-middleware');
const upstreams = require('../config/upstreams');

const matches = (path, prefixes) => prefixes.some((p) => path === p || path.startsWith(p + '/'));

// Streams requests directly to downstream services.
// Note: /internal/* matches no prefixes here, guaranteeing it cannot be reached from outside.
for (const { target, prefixes } of upstreams) {
  router.use(
    createProxyMiddleware({
      target,
      changeOrigin: true,
      pathFilter: (path) => matches(path, prefixes)
    })
  );
}

module.exports = router;