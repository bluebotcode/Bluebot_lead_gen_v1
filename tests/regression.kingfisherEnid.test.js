'use strict';

/**
 * Regression check against real prior research: two live Google Places
 * "Plumbing" searches (Kingfisher, OK and Enid, OK) that a human manually
 * reviewed business-by-business.
 *
 * IMPORTANT SCOPE NOTE: this fixture's `score`/`status` values were produced
 * by that manual/qualitative research pass, not by executing the point
 * rubric this codebase implements. That's demonstrable from the data itself:
 * eight businesses spanning rating 4.0-4.9, review counts 16-258, and both
 * "no website" and "real website" cases all land on the exact same score
 * (65 / Marginal) - which the additive rubric (real website scores 0 on
 * Visibility Gap, no website scores +15) cannot produce for every one of
 * them simultaneously. Danny's Plumbing (1.0 rating, a review saying "he
 * doesn't guarantee his work") scores the *highest* in the set (75), while
 * the rubric's own 0-3-review band is a flat +20 regardless of severity.
 * So `score`/`status` are intentionally NOT asserted against this fixture.
 *
 * What the fixture *does* give us ground truth for - because it doesn't
 * depend on scoring philosophy - is business identification, the GMB link,
 * and whether the vertical-mismatch / rubric-gap flags fire correctly. That
 * part is asserted exactly, and it caught two real gaps in the heuristic
 * vertical filter (see the two tests below marked "known limitation" and
 * "fixed").
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const fixture = require(path.join(__dirname, 'fixtures', 'kingfisherEnidResearch.json'));
const { buildLeads } = require('../server/leadPipeline');

function placeIdFromGmbLink(link) {
  return link.split('place_id:')[1];
}

function toPlace(row) {
  return {
    place_id: placeIdFromGmbLink(row.gmb_profile_link),
    name: row.business_name,
    types: [],
    rating: row.rating,
    user_ratings_total: row.review_count,
    formatted_address: row.address,
    formatted_phone_number: row.listed_phone_number,
    website: row.website === 'No Website Found' ? null : `https://${row.website}`,
    business_status: 'OPERATIONAL'
  };
}

function expectedFlag(rawFlag) {
  if (!rawFlag) return null;
  if (rawFlag.startsWith('Vertical mismatch')) return 'Vertical mismatch';
  if (rawFlag.startsWith('Rubric gap')) return 'Rubric gap';
  throw new Error(`Unrecognized fixture category_flag: ${rawFlag}`);
}

// One search batch per city, matching how the real tool runs (industry held
// constant at "Plumbing" - every row in this fixture came from a Plumbing
// search).
const leadsByCity = {};
for (const city of ['Kingfisher', 'Enid']) {
  const rows = fixture.filter((r) => r.city === city);
  const places = rows.map(toPlace);
  leadsByCity[city] = buildLeads(places, { city, industry: 'Plumbing' });
}

function findLead(businessName) {
  for (const leads of Object.values(leadsByCity)) {
    const found = leads.find((l) => l.business_name === businessName);
    if (found) return found;
  }
  throw new Error(`No lead found for ${businessName}`);
}

// Known false negative: name-only heuristics can't tell "Bee Line Heating
// Air Conditioning and Plumbing" (name and reviews are almost entirely
// HVAC per the research notes) apart from "On Time Plumbing Heating Cooling
// & Electric" (a real multi-service plumbing+HVAC company, not flagged) -
// both names contain both a plumbing keyword and an HVAC keyword. The spec
// itself says this case needs review-text analysis, which Phase 1 does not
// implement. Documented here rather than papering over it with a heuristic
// that would misfire on genuine multi-service businesses.
const KNOWN_NAME_HEURISTIC_LIMITATION = new Set(['Bee Line Heating Air Conditioning and Plumbing']);

test('GMB link is reconstructed exactly from place_id for every business', () => {
  for (const row of fixture) {
    const lead = findLead(row.business_name);
    assert.equal(lead.gmb_link, row.gmb_profile_link, row.business_name);
  }
});

test('Owner Name and Email are always "Not found" in Phase 1, regardless of what manual research separately turned up', () => {
  for (const row of fixture) {
    const lead = findLead(row.business_name);
    assert.equal(lead.owner_name, 'Not found', row.business_name);
    assert.equal(lead.email, 'Not found', row.business_name);
  }
});

test('vertical-mismatch and rubric-gap flags match the research for every business except one documented heuristic limitation', () => {
  const mismatches = [];
  for (const row of fixture) {
    if (KNOWN_NAME_HEURISTIC_LIMITATION.has(row.business_name)) continue;
    const lead = findLead(row.business_name);
    const expected = expectedFlag(row.category_flag);
    if (lead.category_flag !== expected) {
      mismatches.push(`${row.business_name}: expected ${expected}, got ${lead.category_flag}`);
    }
  }
  assert.deepEqual(mismatches, []);
});

test('known limitation: "Bee Line Heating Air Conditioning and Plumbing" is NOT flagged, because its name contains a plumbing keyword too', () => {
  const lead = findLead('Bee Line Heating Air Conditioning and Plumbing');
  assert.equal(lead.category_flag, null);
  // Documents the gap rather than hiding it: the research flagged this one
  // as a vertical mismatch based on review content, which this heuristic
  // cannot see. If this assertion ever starts failing because the filter
  // got smarter, that's good news - update KNOWN_NAME_HEURISTIC_LIMITATION.
});

test('fixed: "Dense Mechanical" is now caught as an HVAC vertical mismatch (previously missed - "mechanical" was not a recognized HVAC keyword)', () => {
  const lead = findLead('Dense Mechanical');
  assert.equal(lead.category_flag, 'Vertical mismatch');
  assert.equal(lead.score, null);
  assert.equal(lead.status, 'Not scored');
});

test('"American Plumber" (12 reviews, 4.9 rating) reproduces the named rubric gap exactly', () => {
  const lead = findLead('American Plumber');
  assert.equal(lead.category_flag, 'Rubric gap');
  // Per spec: a rubric gap leaves the score "partial" (the Reputation Gap
  // section simply contributes 0), unlike a vertical mismatch which nulls
  // the score outright - so this is a number, not null.
  assert.equal(typeof lead.score, 'number');
  assert.equal(lead.status, 'Not scored');
});

test('non-mismatched, non-gap businesses always get a real numeric score (magnitude not asserted - see file header)', () => {
  for (const row of fixture) {
    if (expectedFlag(row.category_flag) || KNOWN_NAME_HEURISTIC_LIMITATION.has(row.business_name)) continue;
    const lead = findLead(row.business_name);
    assert.equal(typeof lead.score, 'number', row.business_name);
    assert.notEqual(lead.status, 'Not scored', row.business_name);
  }
});

test('competitor pool for Competitive Delta excludes vertical-mismatched businesses (e.g. a 313-review HVAC company never inflates a plumber\'s competitor average)', () => {
  const kingfisherLeads = leadsByCity.Kingfisher;
  const claytons = kingfisherLeads.find((l) => l.business_name === "Clayton's Plumbing");
  // Hartzell's Heat & Air (313 reviews, HVAC mismatch) must not appear as a
  // "competitor" in any note text for the other Kingfisher plumbers.
  assert.ok(!claytons.notes.some((n) => n.includes('313')), claytons.notes.join(' | '));
});
