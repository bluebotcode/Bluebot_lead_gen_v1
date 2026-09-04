'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server/index');

// These tests exercise routing/scoring behavior, not the auth gate (that's
// covered in authMiddleware.test.js) - disable it explicitly so the test
// outcome never depends on whatever LEADS_BASIC_AUTH_* happens to be set in
// the ambient environment.
const NO_AUTH = { authOptions: { user: '', password: '' } };

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

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

test('POST /api/search returns 400 when a required field is missing', async () => {
  const app = createApp({ apiKeyProvider: () => 'fake-key' }, NO_AUTH);
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: 'Kingfisher', state: 'OK' })
    });
    assert.equal(res.status, 400);
  });
});

test('POST /api/search returns 500 with a clear message when no API key is configured', async () => {
  const app = createApp({ apiKeyProvider: () => undefined }, NO_AUTH);
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: 'Kingfisher', state: 'OK', industry: 'Plumbing' })
    });
    const body = await res.json();
    assert.equal(res.status, 500);
    assert.match(body.error, /GOOGLE_PLACES_API_KEY/);
  });
});

test('POST /api/search returns scored leads end-to-end against a mocked Places API', async () => {
  const fakeFetch = async (url) => {
    if (url.includes(':searchText')) {
      return jsonResponse({ places: [{ id: 'p1', displayName: { text: 'Acme Plumbing' }, types: ['plumber'] }] });
    }
    return jsonResponse({
      id: url.split('/').pop(),
      displayName: { text: 'Acme Plumbing' },
      types: ['plumber'],
      formattedAddress: '100 Main St, Kingfisher, OK',
      nationalPhoneNumber: '555-0100',
      websiteUri: null,
      rating: 3.0,
      userRatingCount: 2,
      businessStatus: 'OPERATIONAL'
    });
  };

  const app = createApp({ apiKeyProvider: () => 'fake-key', fetchImpl: fakeFetch }, NO_AUTH);
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: 'Kingfisher', state: 'OK', industry: 'Plumbing' })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.leads[0].business_name, 'Acme Plumbing');
    assert.equal(body.leads[0].owner_name, 'Not found');
    assert.equal(body.leads[0].email, 'Not found');
    assert.equal(typeof body.leads[0].score, 'number');
  });
});

test('POST /api/search returns 502 when the Places API errors out', async () => {
  const fakeFetch = async () =>
    jsonResponse({ error: { code: 403, message: 'bad key', status: 'PERMISSION_DENIED' } }, false, 403);
  const app = createApp({ apiKeyProvider: () => 'fake-key', fetchImpl: fakeFetch }, NO_AUTH);
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: 'Kingfisher', state: 'OK', industry: 'Plumbing' })
    });
    assert.equal(res.status, 502);
  });
});
