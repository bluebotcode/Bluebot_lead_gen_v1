'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { findPlaces, PlacesApiError } = require('../placesClient');
const { buildLeads } = require('../leadPipeline');

/**
 * Every search spends real Google Places API budget (2 Text Search calls
 * plus one Place Details call per unique result). This caps a single client
 * to a sane number of searches even after they're past the auth gate, so a
 * mistake (stuck retry loop, a shared password leaking) can't run up an
 * open-ended bill. Overridable per-instance for tests.
 */
function defaultRateLimiter() {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many searches from this client. Please wait a few minutes and try again.' }
  });
}

function createSearchRouter({
  apiKeyProvider = () => process.env.GOOGLE_PLACES_API_KEY,
  fetchImpl,
  rateLimiter = defaultRateLimiter()
} = {}) {
  const router = express.Router();

  router.post('/search', rateLimiter, async (req, res) => {
    const { city, state, industry } = req.body || {};

    if (!city || !state || !industry) {
      return res.status(400).json({ error: 'city, state, and industry are all required.' });
    }

    const apiKey = apiKeyProvider();
    if (!apiKey) {
      return res.status(500).json({
        error:
          'GOOGLE_PLACES_API_KEY is not configured on the server. Set it in your environment (see .env.example) - the key must never be shipped to client-side JS.'
      });
    }

    try {
      const places = await findPlaces({ city, state, industry }, apiKey, fetchImpl);
      const leads = buildLeads(places, { city, industry });
      res.json({ city, state, industry, count: leads.length, leads });
    } catch (err) {
      if (err instanceof PlacesApiError) {
        return res.status(502).json({ error: `Google Places API error: ${err.message}` });
      }
      // eslint-disable-next-line no-console
      console.error('Unexpected error in /api/search:', err);
      res.status(500).json({ error: 'Unexpected server error while searching for leads.' });
    }
  });

  return router;
}

module.exports = { createSearchRouter };
