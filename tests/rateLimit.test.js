'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const rateLimit = require('express-rate-limit');

const { createApp } = require('../server/index');

const NO_AUTH = { authOptions: { user: '', password: '' } };

async function withServer(app, fn) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function jsonResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

test('POST /api/search is rate-limited per client once the configured cap is hit', async () => {
  const fakeFetch = async () => jsonResponse({});
  // Tiny cap so the test doesn't need 21 real requests.
  const tinyLimiter = rateLimit({ windowMs: 60_000, limit: 1, standardHeaders: true, legacyHeaders: false });

  const app = createApp(
    { apiKeyProvider: () => 'fake-key', fetchImpl: fakeFetch, rateLimiter: tinyLimiter },
    NO_AUTH
  );

  await withServer(app, async (base) => {
    const requestBody = JSON.stringify({ city: 'Kingfisher', state: 'OK', industry: 'Plumbing' });
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: requestBody };

    const first = await fetch(`${base}/api/search`, opts);
    assert.equal(first.status, 200);

    const second = await fetch(`${base}/api/search`, opts);
    assert.equal(second.status, 429);
  });
});
