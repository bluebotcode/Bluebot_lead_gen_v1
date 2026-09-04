'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const { createAuthMiddleware, timingSafeStringEqual } = require('../server/authMiddleware');

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

function appWithAuth(authOptions) {
  const app = express();
  app.use(createAuthMiddleware(authOptions));
  app.get('/', (req, res) => res.send('ok'));
  return app;
}

test('timingSafeStringEqual: equal strings compare true, different strings compare false', () => {
  assert.equal(timingSafeStringEqual('secret', 'secret'), true);
  assert.equal(timingSafeStringEqual('secret', 'nope'), false);
  assert.equal(timingSafeStringEqual('short', 'a much longer string'), false);
});

test('gate rejects requests with no Authorization header', async () => {
  const app = appWithAuth({ user: 'bluebot', password: 'hunter2' });
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get('www-authenticate'), 'Basic realm="BlueBot Lead Qualification Tool"');
  });
});

test('gate rejects wrong credentials', async () => {
  const app = appWithAuth({ user: 'bluebot', password: 'hunter2' });
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/`, {
      headers: { Authorization: `Basic ${Buffer.from('bluebot:wrong').toString('base64')}` }
    });
    assert.equal(res.status, 401);
  });
});

test('gate accepts correct credentials', async () => {
  const app = appWithAuth({ user: 'bluebot', password: 'hunter2' });
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/`, {
      headers: { Authorization: `Basic ${Buffer.from('bluebot:hunter2').toString('base64')}` }
    });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), 'ok');
  });
});

test('gate is disabled (open) when credentials are not configured', async () => {
  const app = appWithAuth({ user: '', password: '' });
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
  });
});
