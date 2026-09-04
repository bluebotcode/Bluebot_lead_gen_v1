'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { createSearchRouter } = require('./routes/search');
const { createAuthMiddleware } = require('./authMiddleware');

function createApp(routerOptions, { authOptions } = {}) {
  const app = express();

  // The app is expected to run behind a host-managed reverse proxy (e.g. a
  // PaaS or Passenger on shared hosting) - trust one hop of X-Forwarded-For
  // so rate limiting and logging see the real client IP, not the proxy's.
  app.set('trust proxy', 1);

  app.use(helmet());
  app.use(createAuthMiddleware(authOptions));
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
