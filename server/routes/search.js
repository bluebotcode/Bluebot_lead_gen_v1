'use strict';

const express = require('express');
const { findPlaces, PlacesApiError } = require('../placesClient');
const { buildLeads } = require('../leadPipeline');

function createSearchRouter({ apiKeyProvider = () => process.env.GOOGLE_PLACES_API_KEY, fetchImpl } = {}) {
  const router = express.Router();

  router.post('/search', async (req, res) => {
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
