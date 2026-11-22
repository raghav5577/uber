const INTERNAL_KEY = process.env.INTERNAL_KEY || 'dev-internal-key-change-me';

// Makes an internal authenticated HTTP call to other services
async function request(url, method = 'GET', body) {
  const options = {
    method,
    headers: {
      'content-type': 'application/json',
      'x-internal-key': INTERNAL_KEY,
    },
  };

  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (!res.ok) {
    throw new Error(`Internal call failed: ${method} ${url} -> ${res.status}`);
  }

  return res.json();
}

module.exports = {
  request,
};
