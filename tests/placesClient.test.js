'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { textSearch, placeDetails, findPlaces, PlacesApiError } = require('../server/placesClient');

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('textSearch returns results on OK status', async () => {
  const fakeFetch = async () =>
    jsonResponse({ status: 'OK', results: [{ place_id: 'p1', name: 'Acme Plumbing' }] });
  const results = await textSearch('Plumbing in Kingfisher, OK', 'fake-key', fakeFetch);
  assert.equal(results.length, 1);
  assert.equal(results[0].place_id, 'p1');
});

test('textSearch returns empty array on ZERO_RESULTS', async () => {
  const fakeFetch = async () => jsonResponse({ status: 'ZERO_RESULTS', results: [] });
  const results = await textSearch('Plumbing in Nowhere, OK', 'fake-key', fakeFetch);
  assert.deepEqual(results, []);
});

test('textSearch throws PlacesApiError on non-OK Google status', async () => {
  const fakeFetch = async () =>
    jsonResponse({ status: 'REQUEST_DENIED', error_message: 'bad key' });
  await assert.rejects(
    () => textSearch('Plumbing in Kingfisher, OK', 'bad-key', fakeFetch),
    PlacesApiError
  );
});

test('textSearch throws PlacesApiError on HTTP error', async () => {
  const fakeFetch = async () => jsonResponse({}, false, 500);
  await assert.rejects(() => textSearch('x', 'k', fakeFetch), PlacesApiError);
});

test('placeDetails returns the result object', async () => {
  const fakeFetch = async () =>
    jsonResponse({ status: 'OK', result: { place_id: 'p1', website: 'https://acme.com' } });
  const details = await placeDetails('p1', 'fake-key', fakeFetch);
  assert.equal(details.website, 'https://acme.com');
});

test('findPlaces runs two query phrasings and dedupes by place_id before fetching details', async () => {
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(url);
    if (url.includes('/textsearch/')) {
      const u = new URL(url);
      const q = u.searchParams.get('query');
      if (q.includes('company')) {
        return jsonResponse({
          status: 'OK',
          results: [
            { place_id: 'p1', name: 'Acme Plumbing' }, // duplicate of the other phrasing
            { place_id: 'p2', name: 'Only Found By Company Phrasing' }
          ]
        });
      }
      return jsonResponse({ status: 'OK', results: [{ place_id: 'p1', name: 'Acme Plumbing' }] });
    }
    // details call
    const u = new URL(url);
    const placeId = u.searchParams.get('place_id');
    return jsonResponse({ status: 'OK', result: { place_id: placeId, name: `Details for ${placeId}` } });
  };

  const details = await findPlaces({ city: 'Kingfisher', state: 'OK', industry: 'Plumbing' }, 'key', fakeFetch);

  const textSearchCalls = calls.filter((u) => u.includes('/textsearch/'));
  assert.equal(textSearchCalls.length, 2);

  const detailsCalls = calls.filter((u) => u.includes('/details/'));
  assert.equal(detailsCalls.length, 2); // deduped: p1 fetched once, p2 once

  const ids = details.map((d) => d.place_id).sort();
  assert.deepEqual(ids, ['p1', 'p2']);
});
