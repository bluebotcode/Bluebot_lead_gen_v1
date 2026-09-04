'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildLeads, buildGmbLink, computeCompetitorStats } = require('../server/leadPipeline');

test('buildGmbLink constructs a maps URL directly from place_id, no extra API call', () => {
  assert.equal(
    buildGmbLink('ChIJabc123'),
    'https://www.google.com/maps/place/?q=place_id:ChIJabc123'
  );
});

test('computeCompetitorStats excludes the current place and takes the top 3 by review count', () => {
  const all = [
    { place_id: 'a', rating: 4.9, user_ratings_total: 50 },
    { place_id: 'b', rating: 4.8, user_ratings_total: 40 },
    { place_id: 'c', rating: 4.7, user_ratings_total: 30 },
    { place_id: 'd', rating: 2.0, user_ratings_total: 1 }, // lowest, excluded from top 3
    { place_id: 'self', rating: 3.0, user_ratings_total: 2 }
  ];
  const stats = computeCompetitorStats(all, 'self');
  assert.equal(stats.count, 3);
  assert.equal(stats.avgReviews, 40); // (50+40+30)/3
  assert.ok(Math.abs(stats.avgRating - 4.8) < 1e-9);
});

test('computeCompetitorStats returns null when no other businesses exist', () => {
  const stats = computeCompetitorStats([{ place_id: 'self' }], 'self');
  assert.equal(stats, null);
});

test('buildLeads: vertical-mismatched business is shown with null score and Not scored status', () => {
  const places = [
    {
      place_id: 'p1',
      name: "Joe's Heat & Air",
      types: ['hvac_contractor'],
      rating: 4.5,
      user_ratings_total: 20,
      formatted_address: '1 Main St',
      formatted_phone_number: '555-0100',
      website: 'https://joesheatandair.com',
      business_status: 'OPERATIONAL'
    }
  ];
  const [lead] = buildLeads(places, { city: 'Kingfisher', industry: 'Plumbing' });
  assert.equal(lead.category_flag, 'Vertical mismatch');
  assert.equal(lead.score, null);
  assert.equal(lead.status, 'Not scored');
  assert.equal(lead.owner_name, 'Not found');
  assert.equal(lead.email, 'Not found');
});

test('buildLeads: non-mismatched business gets scored and gets a gmb_link', () => {
  const places = [
    {
      place_id: 'p2',
      name: 'Acme Plumbing',
      types: ['plumber'],
      rating: 3.0,
      user_ratings_total: 2,
      formatted_address: '2 Main St',
      formatted_phone_number: '555-0200',
      website: null,
      business_status: 'OPERATIONAL'
    }
  ];
  const [lead] = buildLeads(places, { city: 'Kingfisher', industry: 'Plumbing' });
  assert.equal(lead.category_flag, null);
  assert.equal(typeof lead.score, 'number');
  assert.equal(lead.gmb_link, 'https://www.google.com/maps/place/?q=place_id:p2');
});

test('buildLeads: competitor stats are derived from the rest of the same search batch', () => {
  const places = [
    {
      place_id: 'weak',
      name: 'Small Plumbing',
      types: ['plumber'],
      rating: 3.0,
      user_ratings_total: 2,
      formatted_address: '3 Main St',
      formatted_phone_number: '555-0300',
      website: null,
      business_status: 'OPERATIONAL'
    },
    {
      place_id: 'strong1',
      name: 'Big Plumbing Co',
      types: ['plumber'],
      rating: 4.9,
      user_ratings_total: 60,
      formatted_address: '4 Main St',
      formatted_phone_number: '555-0400',
      website: 'https://bigplumbing.com',
      business_status: 'OPERATIONAL'
    },
    {
      place_id: 'strong2',
      name: 'Reliable Plumbing',
      types: ['plumber'],
      rating: 4.7,
      user_ratings_total: 55,
      formatted_address: '5 Main St',
      formatted_phone_number: '555-0500',
      website: 'https://reliableplumbing.com',
      business_status: 'OPERATIONAL'
    }
  ];
  const leads = buildLeads(places, { city: 'Kingfisher', industry: 'Plumbing' });
  const weakLead = leads.find((l) => l.place_id === 'weak');
  // Weak business: no website (+15), 0-3 reviews (+20), phone+address (+10),
  // competitors (Big Plumbing Co + Reliable Plumbing) are strong and this
  // business has neither reviews nor rating -> +10 competitive delta.
  assert.equal(weakLead.score, 55);
  assert.ok(weakLead.notes.some((n) => n.includes('competitive delta')));
});
