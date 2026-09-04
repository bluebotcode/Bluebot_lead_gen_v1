'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const { createSearchRouter } = require('./routes/search');

function createApp(routerOptions) {
  const app = express();
  app.use(express.json());
  app.use('/api', createSearchRouter(routerOptions));
  app.use(express.static(path.join(__dirname, '..', 'public')));
  return app;
}

if (require.main === module) {
  const app = createApp();
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`BlueBot Lead Qualification Tool listening on http://localhost:${port}`);
    if (!process.env.GOOGLE_PLACES_API_KEY) {
      // eslint-disable-next-line no-console
      console.warn('Warning: GOOGLE_PLACES_API_KEY is not set. Searches will fail until it is configured (see .env.example).');
    }
  });
}

module.exports = { createApp };
