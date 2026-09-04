'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { textSearch, placeDetails, findPlaces, PlacesApiError } = require('../server/placesClient');

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('textSearch returns adapted (legacy-shaped) results on success', async () => {
  const fakeFetch = async () =>
    jsonResponse({ places: [{ id: 'p1', displayName: { text: 'Acme Plumbing' }, types: ['plumber'] }] });
  const results = await textSearch('Plumbing in Kingfisher, OK', 'fake-key', fakeFetch);
  assert.equal(results.length, 1);
  assert.equal(results[0].place_id, 'p1');
  assert.equal(results[0].name, 'Acme Plumbing');
});

test('textSearch returns empty array when the API omits "places" (zero results)', async () => {
  const fakeFetch = async () => jsonResponse({});
  const results = await textSearch('Plumbing in Nowhere, OK', 'fake-key', fakeFetch);
  assert.deepEqual(results, []);
});

test('textSearch sends the request as a POST with the API key and field mask headers, not a URL query param', async () => {
  let capturedUrl;
  let capturedInit;
  const fakeFetch = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({});
  };
  await textSearch('Plumbing in Kingfisher, OK', 'fake-key', fakeFetch);
  assert.equal(capturedUrl, 'https://places.googleapis.com/v1/places:searchText');
  assert.equal(capturedInit.method, 'POST');
  assert.equal(capturedInit.headers['X-Goog-Api-Key'], 'fake-key');
  assert.ok(capturedInit.headers['X-Goog-FieldMask'].includes('places.id'));
  assert.deepEqual(JSON.parse(capturedInit.body), { textQuery: 'Plumbing in Kingfisher, OK' });
  assert.equal(capturedUrl.includes('key=fake-key'), false);
});

test('textSearch throws PlacesApiError on a non-2xx Google API error response', async () => {
  const fakeFetch = async () =>
    jsonResponse({ error: { code: 403, message: 'API key not authorized', status: 'PERMISSION_DENIED' } }, false, 403);
  await assert.rejects(
    () => textSearch('Plumbing in Kingfisher, OK', 'bad-key', fakeFetch),
    (err) => err instanceof PlacesApiError && /API key not authorized/.test(err.message)
  );
});

test('placeDetails adapts the new Place resource shape into the legacy-shaped object', async () => {
  const fakeFetch = async () =>
    jsonResponse({
      id: 'p1',
      displayName: { text: 'Acme Plumbing' },
      types: ['plumber'],
      rating: 4.2,
      userRatingCount: 18,
      formattedAddress: '100 Main St, Kingfisher, OK',
      nationalPhoneNumber: '(405) 555-0100',
      websiteUri: 'https://acmeplumbing.com',
      businessStatus: 'OPERATIONAL',
      reviews: [{ rating: 5, text: { text: 'Great work' }, publishTime: '2026-01-15T12:00:00Z' }]
    });
  const details = await placeDetails('p1', 'fake-key', fakeFetch);
  assert.equal(details.place_id, 'p1');
  assert.equal(details.name, 'Acme Plumbing');
  assert.equal(details.website, 'https://acmeplumbing.com');
  assert.equal(details.formatted_phone_number, '(405) 555-0100');
  assert.equal(details.formatted_address, '100 Main St, Kingfisher, OK');
  assert.equal(details.rating, 4.2);
  assert.equal(details.user_ratings_total, 18);
  assert.equal(details.business_status, 'OPERATIONAL');
  assert.equal(details.reviews.length, 1);
  assert.equal(typeof details.reviews[0].time, 'number');
});

test('placeDetails requests GET /v1/places/{id} with the API key and field mask headers', async () => {
  let capturedUrl;
  let capturedInit;
  const fakeFetch = async (url, init) => {
    capturedUrl = url;
    capturedInit = init;
    return jsonResponse({ id: 'p1' });
  };
  await placeDetails('p1', 'fake-key', fakeFetch);
  assert.equal(capturedUrl, 'https://places.googleapis.com/v1/places/p1');
  assert.equal(capturedInit.headers['X-Goog-Api-Key'], 'fake-key');
  assert.ok(capturedInit.headers['X-Goog-FieldMask'].includes('rating'));
});

test('placeDetails throws PlacesApiError on HTTP error', async () => {
  const fakeFetch = async () => jsonResponse({ error: { message: 'not found' } }, false, 404);
  await assert.rejects(() => placeDetails('bad-id', 'k', fakeFetch), PlacesApiError);
});

test('findPlaces runs two query phrasings and dedupes by place_id before fetching details', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push(url);
    if (url.includes(':searchText')) {
      const { textQuery } = JSON.parse(init.body);
      if (textQuery.includes('company')) {
        return jsonResponse({
          places: [
            { id: 'p1', displayName: { text: 'Acme Plumbing' } }, // duplicate of the other phrasing
            { id: 'p2', displayName: { text: 'Only Found By Company Phrasing' } }
          ]
        });
      }
      return jsonResponse({ places: [{ id: 'p1', displayName: { text: 'Acme Plumbing' } }] });
    }
    // details call: https://places.googleapis.com/v1/places/{id}
    const placeId = url.split('/').pop();
    return jsonResponse({ id: placeId, displayName: { text: `Details for ${placeId}` } });
  };

  const details = await findPlaces({ city: 'Kingfisher', state: 'OK', industry: 'Plumbing' }, 'key', fakeFetch);

  const textSearchCalls = calls.filter((u) => u.includes(':searchText'));
  assert.equal(textSearchCalls.length, 2);

  const detailsCalls = calls.filter((u) => u.includes('/v1/places/') && !u.includes(':searchText'));
  assert.equal(detailsCalls.length, 2); // deduped: p1 fetched once, p2 once

  const ids = details.map((d) => d.place_id).sort();
  assert.deepEqual(ids, ['p1', 'p2']);
});
