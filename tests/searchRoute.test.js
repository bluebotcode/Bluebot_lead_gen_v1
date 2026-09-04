'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createApp } = require('../server/index');

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
  const app = createApp({ apiKeyProvider: () => 'fake-key' });
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
  const app = createApp({ apiKeyProvider: () => undefined });
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
    const u = new URL(url);
    if (url.includes('/textsearch/')) {
      return jsonResponse({ status: 'OK', results: [{ place_id: 'p1' }] });
    }
    return jsonResponse({
      status: 'OK',
      result: {
        place_id: u.searchParams.get('place_id'),
        name: 'Acme Plumbing',
        types: ['plumber'],
        formatted_address: '100 Main St, Kingfisher, OK',
        formatted_phone_number: '555-0100',
        website: null,
        rating: 3.0,
        user_ratings_total: 2,
        business_status: 'OPERATIONAL'
      }
    });
  };

  const app = createApp({ apiKeyProvider: () => 'fake-key', fetchImpl: fakeFetch });
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
  const fakeFetch = async () => jsonResponse({ status: 'REQUEST_DENIED', error_message: 'bad key' });
  const app = createApp({ apiKeyProvider: () => 'fake-key', fetchImpl: fakeFetch });
  await withServer(app, async (base) => {
    const res = await fetch(`${base}/api/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city: 'Kingfisher', state: 'OK', industry: 'Plumbing' })
    });
    assert.equal(res.status, 502);
  });
});
