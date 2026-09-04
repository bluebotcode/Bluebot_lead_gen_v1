'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scoreVisibilityGap,
  scoreReputationGap,
  scoreBusinessViability,
  scoreCompetitiveDelta,
  scoreLead,
  isDirectoryOrSocialDomain
} = require('../server/scoring');

test('isDirectoryOrSocialDomain recognizes social/directory hosts', () => {
  assert.equal(isDirectoryOrSocialDomain('https://www.facebook.com/somebiz'), true);
  assert.equal(isDirectoryOrSocialDomain('https://m.facebook.com/somebiz'), true);
  assert.equal(isDirectoryOrSocialDomain('https://www.yelp.com/biz/somebiz'), true);
  assert.equal(isDirectoryOrSocialDomain('https://acmeplumbing.com'), false);
  assert.equal(isDirectoryOrSocialDomain('not a url'), false);
});

test('scoreVisibilityGap: no website scores +15 and never scores the local-pack band', () => {
  const notes = [];
  const points = scoreVisibilityGap({ website: null }, notes);
  assert.equal(points, 15);
  assert.ok(notes.some((n) => n.includes('No website found')));
  assert.ok(notes.some((n) => n.includes('never applied')));
});

test('scoreVisibilityGap: directory-only website scores +15', () => {
  const notes = [];
  const points = scoreVisibilityGap({ website: 'https://www.facebook.com/x' }, notes);
  assert.equal(points, 15);
});

test('scoreVisibilityGap: real website scores 0 (on-page SEO not checked in Phase 1)', () => {
  const notes = [];
  const points = scoreVisibilityGap({ website: 'https://acmeplumbing.com' }, notes);
  assert.equal(points, 0);
  assert.ok(notes.some((n) => n.includes('on-page local SEO')));
});

test('scoreReputationGap: 0-3 reviews scores +20 regardless of rating', () => {
  const notes = [];
  const result = scoreReputationGap(null, 2, notes);
  assert.deepEqual(result, { points: 20, rubricGap: false });
});

test('scoreReputationGap: 4-15 reviews AND rating under 4.0 scores +25', () => {
  const notes = [];
  const result = scoreReputationGap(3.6, 10, notes);
  assert.deepEqual(result, { points: 25, rubricGap: false });
});

test('scoreReputationGap: 15+ reviews AND rating under 3.5 scores +20', () => {
  const notes = [];
  const result = scoreReputationGap(3.2, 40, notes);
  assert.deepEqual(result, { points: 20, rubricGap: false });
});

test('scoreReputationGap: 15+ reviews AND rating 4.0+ is healthy, scores +0', () => {
  const notes = [];
  const result = scoreReputationGap(4.6, 30, notes);
  assert.deepEqual(result, { points: 0, rubricGap: false });
});

test('scoreReputationGap: known rubric gap - 4-15 reviews AND rating >= 4.0 fits no band', () => {
  const notes = [];
  const result = scoreReputationGap(4.5, 10, notes);
  assert.equal(result.rubricGap, true);
  assert.equal(result.points, 0);
  assert.ok(notes.some((n) => n.includes('does not fit any defined band')));
});

test('scoreReputationGap: second uncovered combo - 16+ reviews AND rating in [3.5, 4.0) also flags a rubric gap', () => {
  const notes = [];
  const result = scoreReputationGap(3.8, 25, notes);
  assert.equal(result.rubricGap, true);
  assert.equal(result.points, 0);
});

test('scoreReputationGap: exactly 15 reviews with rating < 3.5 resolves the boundary overlap to the lower score (+20, not +25)', () => {
  const notes = [];
  const result = scoreReputationGap(3.0, 15, notes);
  assert.deepEqual(result, { points: 20, rubricGap: false });
  assert.ok(notes.some((n) => n.includes('ambiguous-data rule')));
});

test('scoreBusinessViability: phone + address present scores +10', () => {
  const notes = [];
  const result = scoreBusinessViability(
    { formatted_phone_number: '555-0100', formatted_address: '100 Main St', business_status: 'OPERATIONAL' },
    notes
  );
  assert.equal(result.points, 10);
  assert.equal(result.closureSign, false);
});

test('scoreBusinessViability: missing phone/address does not score the +10', () => {
  const notes = [];
  const result = scoreBusinessViability({ business_status: 'OPERATIONAL' }, notes);
  assert.equal(result.points, 0);
});

test('scoreBusinessViability: review within last 12 months adds +5', () => {
  const notes = [];
  const recentTime = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 30; // 30 days ago
  const result = scoreBusinessViability(
    {
      formatted_phone_number: '555-0100',
      formatted_address: '100 Main St',
      business_status: 'OPERATIONAL',
      reviews: [{ time: recentTime }]
    },
    notes
  );
  assert.equal(result.points, 15);
});

test('scoreBusinessViability: stale review (>12mo) does not add the +5', () => {
  const notes = [];
  const staleTime = Math.floor(Date.now() / 1000) - 60 * 60 * 24 * 400; // ~13 months ago
  const result = scoreBusinessViability(
    {
      formatted_phone_number: '555-0100',
      formatted_address: '100 Main St',
      business_status: 'OPERATIONAL',
      reviews: [{ time: staleTime }]
    },
    notes
  );
  assert.equal(result.points, 10);
});

test('scoreBusinessViability: CLOSED_PERMANENTLY sets closureSign', () => {
  const notes = [];
  const result = scoreBusinessViability(
    { formatted_phone_number: '555-0100', formatted_address: '100 Main St', business_status: 'CLOSED_PERMANENTLY' },
    notes
  );
  assert.equal(result.closureSign, true);
});

test('scoreCompetitiveDelta: no competitor data scores 0', () => {
  const notes = [];
  const points = scoreCompetitiveDelta({ rating: 3, user_ratings_total: 2 }, null, notes);
  assert.equal(points, 0);
  assert.ok(notes.some((n) => n.includes('not scored')));
});

test('scoreCompetitiveDelta: strong competitors + weak business scores +10', () => {
  const notes = [];
  const points = scoreCompetitiveDelta(
    { rating: 3.0, user_ratings_total: 2 },
    { count: 3, avgRating: 4.7, avgReviews: 40 },
    notes
  );
  assert.equal(points, 10);
});

test('scoreCompetitiveDelta: weak competitors scores +3', () => {
  const notes = [];
  const points = scoreCompetitiveDelta(
    { rating: 3.0, user_ratings_total: 2 },
    { count: 3, avgRating: 3.5, avgReviews: 8 },
    notes
  );
  assert.equal(points, 3);
});

test('scoreCompetitiveDelta: strong competitors but business already matches them scores 0', () => {
  const notes = [];
  const points = scoreCompetitiveDelta(
    { rating: 4.9, user_ratings_total: 50 },
    { count: 3, avgRating: 4.7, avgReviews: 40 },
    notes
  );
  assert.equal(points, 0);
});

test('scoreLead: closure sign caps total score at 30 even if raw points exceed it', () => {
  const place = {
    website: null, // +15
    rating: 2.0,
    user_ratings_total: 1, // 0-3 band +20
    formatted_phone_number: '555-0100',
    formatted_address: '100 Main St', // +10
    business_status: 'CLOSED_TEMPORARILY'
  };
  const result = scoreLead(place, null);
  // Raw would be 15 + 20 + 10 + 0 = 45, capped to 30 (which is a "Skip" - under 40).
  assert.equal(result.score, 30);
  assert.equal(result.status, 'Skip');
});

test('scoreLead: rubric gap sets category_flag and status "Not scored" even with a partial score', () => {
  const place = {
    website: 'https://acmeplumbing.com',
    rating: 4.5,
    user_ratings_total: 10, // 4-15 & rating>=4.0 -> rubric gap
    formatted_phone_number: '555-0100',
    formatted_address: '100 Main St',
    business_status: 'OPERATIONAL'
  };
  const result = scoreLead(place, null);
  assert.equal(result.category_flag, 'Rubric gap');
  assert.equal(result.status, 'Not scored');
});

test('scoreLead: always flags visibility_gap_partial / unknown local pack status / Likely confidence', () => {
  const place = {
    website: 'https://acmeplumbing.com',
    rating: 4.8,
    user_ratings_total: 30,
    formatted_phone_number: '555-0100',
    formatted_address: '100 Main St',
    business_status: 'OPERATIONAL'
  };
  const result = scoreLead(place, null);
  assert.equal(result.visibility_gap_partial, true);
  assert.equal(result.local_pack_status, 'unknown');
  assert.equal(result.confidence, 'Likely');
});

test('scoreLead: healthy, well-reviewed, real-website business with no competitor data scores low and is a Skip', () => {
  const place = {
    website: 'https://acmeplumbing.com',
    rating: 4.8,
    user_ratings_total: 30,
    formatted_phone_number: '555-0100',
    formatted_address: '100 Main St',
    business_status: 'OPERATIONAL'
  };
  const result = scoreLead(place, null);
  // 0 (visibility) + 0 (reputation, healthy) + 10 (viability, no recent review data) + 0 (no competitor data) = 10
  assert.equal(result.score, 10);
  assert.equal(result.status, 'Skip');
});

test('scoreLead: weak business (no website, 2 reviews) with strong nearby competitors scores Marginal', () => {
  const place = {
    website: null,
    rating: 3.0,
    user_ratings_total: 2,
    formatted_phone_number: '555-0100',
    formatted_address: '100 Main St',
    business_status: 'OPERATIONAL'
  };
  const competitorStats = { count: 3, avgRating: 4.8, avgReviews: 45 };
  const result = scoreLead(place, competitorStats);
  // 15 (no website) + 20 (0-3 reviews) + 10 (viability) + 10 (competitive delta) = 55
  assert.equal(result.score, 55);
  assert.equal(result.status, 'Marginal');
});
