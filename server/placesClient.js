'use strict';

const TEXT_SEARCH_URL = 'https://maps.googleapis.com/maps/api/place/textsearch/json';
const DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

const DETAILS_FIELDS = [
  'place_id',
  'name',
  'formatted_address',
  'formatted_phone_number',
  'website',
  'rating',
  'user_ratings_total',
  'types',
  'opening_hours',
  'business_status',
  'reviews'
].join(',');

class PlacesApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'PlacesApiError';
    this.status = status;
  }
}

function buildQueryPhrasings(industry, city, state) {
  return [
    `${industry} in ${city}, ${state}`,
    `${industry} company ${city} ${state}`
  ];
}

async function textSearch(query, apiKey, fetchImpl = fetch) {
  const url = new URL(TEXT_SEARCH_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('key', apiKey);

  const res = await fetchImpl(url.toString());
  if (!res.ok) {
    throw new PlacesApiError(`Places Text Search HTTP ${res.status}`, res.status);
  }
  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    throw new PlacesApiError(
      `Places Text Search error: ${data.status}${data.error_message ? ' - ' + data.error_message : ''}`,
      200
    );
  }
  return data.results || [];
}

async function placeDetails(placeId, apiKey, fetchImpl = fetch) {
  const url = new URL(DETAILS_URL);
  url.searchParams.set('place_id', placeId);
  url.searchParams.set('fields', DETAILS_FIELDS);
  url.searchParams.set('key', apiKey);

  const res = await fetchImpl(url.toString());
  if (!res.ok) {
    throw new PlacesApiError(`Places Details HTTP ${res.status}`, res.status);
  }
  const data = await res.json();
  if (data.status !== 'OK') {
    throw new PlacesApiError(
      `Places Details error: ${data.status}${data.error_message ? ' - ' + data.error_message : ''}`,
      200
    );
  }
  return data.result;
}

/**
 * Runs both query phrasings, dedupes by place_id, and backfills each unique
 * place with a Place Details lookup (Text Search alone often omits website).
 */
async function findPlaces({ city, state, industry }, apiKey, fetchImpl = fetch) {
  const queries = buildQueryPhrasings(industry, city, state);

  const resultsByQuery = await Promise.all(
    queries.map((q) => textSearch(q, apiKey, fetchImpl))
  );

  const byPlaceId = new Map();
  for (const results of resultsByQuery) {
    for (const r of results) {
      if (!byPlaceId.has(r.place_id)) {
        byPlaceId.set(r.place_id, r);
      }
    }
  }

  const details = await Promise.all(
    Array.from(byPlaceId.keys()).map((placeId) => placeDetails(placeId, apiKey, fetchImpl))
  );

  return details;
}

module.exports = {
  PlacesApiError,
  buildQueryPhrasings,
  textSearch,
  placeDetails,
  findPlaces,
  DETAILS_FIELDS
};
