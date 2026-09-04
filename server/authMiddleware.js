'use strict';

const crypto = require('crypto');

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  // Buffers must be equal length for timingSafeEqual; hash both first so
  // length itself never leaks through a fast-fail comparison.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * HTTP Basic Auth gate for the whole app. Every "Find leads" search spends
 * real Google Places API budget, so this app should never be reachable
 * without credentials once it's on a public subdomain.
 *
 * Reads LEADS_BASIC_AUTH_USER / LEADS_BASIC_AUTH_PASSWORD by default. If
 * either is unset, the gate is disabled and a warning is logged once -
 * intended for local development only, never for a deployed instance.
 */
function createAuthMiddleware({
  user = process.env.LEADS_BASIC_AUTH_USER,
  password = process.env.LEADS_BASIC_AUTH_PASSWORD
} = {}) {
  if (!user || !password) {
    // eslint-disable-next-line no-console
    console.warn(
      'Warning: LEADS_BASIC_AUTH_USER / LEADS_BASIC_AUTH_PASSWORD are not both set. Running with NO ACCESS GATE - do not deploy this to a public subdomain in this state.'
    );
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');

    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const separatorIndex = decoded.indexOf(':');
      if (separatorIndex !== -1) {
        const suppliedUser = decoded.slice(0, separatorIndex);
        const suppliedPassword = decoded.slice(separatorIndex + 1);
        if (timingSafeStringEqual(suppliedUser, user) && timingSafeStringEqual(suppliedPassword, password)) {
          return next();
        }
      }
    }

    res.set('WWW-Authenticate', 'Basic realm="BlueBot Lead Qualification Tool"');
    res.status(401).send('Authentication required.');
  };
}

module.exports = { createAuthMiddleware, timingSafeStringEqual };
