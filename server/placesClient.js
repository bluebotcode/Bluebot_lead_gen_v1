'use strict';

/**
 * Client for Places API (New) - https://places.googleapis.com/v1/...
 *
 * Google froze the legacy Places API (maps.googleapis.com/maps/api/place/...)
 * in March 2025: it is NOT enableable on new Google Cloud projects at all,
 * only usable by projects that already had it on. Any project set up from
 * here on must use Places API (New), which differs in every respect that
 * matters to this client:
 *  - Text Search is a POST with a JSON body, not a GET with query params.
 *  - Every request requires an explicit X-Goog-FieldMask header - there is
 *    no default field set, and requesting more fields moves the request
 *    into a more expensive Google-defined SKU tier. Field masks below are
 *    kept minimal per call for that reason.
 *  - Field names changed shape (e.g. `name` -> `displayName.text`,
 *    `user_ratings_total` -> `userRatingCount`, `website` -> `websiteUri`).
 *  - Errors come back as a non-2xx HTTP status with a Google API-style
 *    `{ error: { code, message, status } }` body, not a 200 with a
 *    `status: "REQUEST_DENIED"` field like the legacy API.
 *
 * To keep that migration contained, every function here returns the same
 * "legacy-shaped" place object the rest of this codebase (scoring.js,
 * verticalFilter.js, leadPipeline.js) already expects: place_id, name,
 * types, rating, user_ratings_total, formatted_address,
 * formatted_phone_number, website, business_status, reviews (with a unix
 * `time` field per review). Only this file knows about the New API's shape.
 */

const BASE_URL = 'https://places.googleapis.com/v1';

const SEARCH_FIELD_MASK = ['places.id', 'places.displayName', 'places.types'].join(',');

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'types',
  'rating',
  'userRatingCount',
  'formattedAddress',
  'nationalPhoneNumber',
  'internationalPhoneNumber',
  'websiteUri',
  'businessStatus',
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

async function parseErrorBody(res) {
  try {
    const body = await res.json();
    return body?.error?.message || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function reviewTimeToUnixSeconds(publishTime) {
  if (!publishTime) return undefined;
  const ms = Date.parse(publishTime);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/** Adapts a Places API (New) Place resource into the legacy-shaped object the rest of the app expects. */
function adaptPlace(place) {
  return {
    place_id: place.id,
    name: place.displayName?.text || null,
    types: place.types || [],
    rating: typeof place.rating === 'number' ? place.rating : null,
    user_ratings_total: typeof place.userRatingCount === 'number' ? place.userRatingCount : 0,
    formatted_address: place.formattedAddress || null,
    formatted_phone_number: place.nationalPhoneNumber || place.internationalPhoneNumber || null,
    website: place.websiteUri || null,
    business_status: place.businessStatus || 'OPERATIONAL',
    reviews: Array.isArray(place.reviews)
      ? place.reviews.map((r) => ({
          time: reviewTimeToUnixSeconds(r.publishTime),
          rating: r.rating,
          text: r.text?.text
        }))
      : []
  };
}

/** Text Search (New). Returns lightweight { place_id, name, types } entries - enough to dedupe and run the vertical-mismatch heuristic before spending a Details call per unique place. */
async function textSearch(query, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(`${BASE_URL}/places:searchText`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': SEARCH_FIELD_MASK
    },
    body: JSON.stringify({ textQuery: query })
  });

  if (!res.ok) {
    throw new PlacesApiError(`Places Text Search error: ${await parseErrorBody(res)}`, res.status);
  }

  const data = await res.json();
  return (data.places || []).map(adaptPlace);
}

/** Place Details (New), fetched per unique place_id to backfill rating, reviews, phone, website, etc. */
async function placeDetails(placeId, apiKey, fetchImpl = fetch) {
  const res = await fetchImpl(`${BASE_URL}/places/${placeId}`, {
    headers: {
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK
    }
  });

  if (!res.ok) {
    throw new PlacesApiError(`Places Details error: ${await parseErrorBody(res)}`, res.status);
  }

  const place = await res.json();
  return adaptPlace(place);
}

/**
 * Runs both query phrasings, dedupes by place_id, and backfills each unique
 * place with a Place Details lookup (Text Search's minimal field mask
 * doesn't carry rating/reviews/phone/website - that's what Details is for).
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
  adaptPlace,
  SEARCH_FIELD_MASK,
  DETAILS_FIELD_MASK
};
