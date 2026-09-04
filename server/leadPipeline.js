'use strict';

const { detectVerticalMismatch } = require('./verticalFilter');
const { scoreLead } = require('./scoring');

function buildGmbLink(placeId) {
  return `https://www.google.com/maps/place/?q=place_id:${placeId}`;
}

function computeCompetitorStats(allPlaces, currentPlaceId) {
  const others = allPlaces.filter((p) => p.place_id !== currentPlaceId);
  if (others.length === 0) return null;

  const top3 = [...others]
    .sort((a, b) => (b.user_ratings_total || 0) - (a.user_ratings_total || 0))
    .slice(0, 3);

  const avgReviews = top3.reduce((sum, p) => sum + (p.user_ratings_total || 0), 0) / top3.length;
  const avgRating = top3.reduce((sum, p) => sum + (p.rating || 0), 0) / top3.length;

  return { count: top3.length, avgReviews, avgRating };
}

/**
 * Builds one results-table row from a raw Place Details object.
 * Owner Name and Email are Phase 2 fields; Phase 1 always reports them as
 * "Not found" rather than guessing, per the spec's explicit instruction.
 */
function buildLead(place, { city, industry, allPlaces }) {
  const base = {
    city,
    business_name: place.name || 'Unknown',
    rating: typeof place.rating === 'number' ? place.rating : null,
    review_count: typeof place.user_ratings_total === 'number' ? place.user_ratings_total : 0,
    address: place.formatted_address || 'Not found',
    phone: place.formatted_phone_number || 'Not found',
    website: place.website || null,
    owner_name: 'Not found',
    email: 'Not found',
    enrichment_source: null,
    gmb_link: buildGmbLink(place.place_id),
    place_id: place.place_id
  };

  const mismatch = detectVerticalMismatch(place, industry);
  if (mismatch.isMismatch) {
    return {
      ...base,
      category_flag: mismatch.categoryFlag,
      score: null,
      status: 'Not scored',
      visibility_gap_partial: true,
      local_pack_status: 'unknown',
      confidence: 'Likely',
      notes: [mismatch.reason]
    };
  }

  const competitorStats = computeCompetitorStats(allPlaces, place.place_id);
  const scored = scoreLead(place, competitorStats);

  return { ...base, ...scored };
}

function buildLeads(places, { city, industry }) {
  return places.map((place) => buildLead(place, { city, industry, allPlaces: places }));
}

module.exports = { buildLeads, buildLead, buildGmbLink, computeCompetitorStats };
