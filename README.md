# BlueBot Lead Qualification Tool

Phase 1 implementation: enter a City, State, and Industry; the app finds local
businesses via the Google Places API, scores each one against a fixed rubric,
and displays results as a sortable spreadsheet with JSON export.

## Scope

This is **Phase 1 only** (see the build spec). It reliably automates business
discovery, ratings/review counts, addresses, phone numbers, GMB links, and
rubric scoring.

Owner Name and Email are **Phase 2** fields and are not implemented here -
every row always reports them as `"Not found"` rather than guessing, per the
spec's explicit instruction never to fabricate a plausible-sounding name or
email. The UI's Owner Name / Email / Category Flag / Notes cells are editable
so a human can fill in verified information before exporting.

Two rubric inputs are structurally unavailable from the Places API and are
never scored as if they were known:
- **Local pack ranking** (`local_pack_status: "unknown"`)
- **GMB claimed/unclaimed status**

Every scored lead is flagged `visibility_gap_partial: true` and capped at
`confidence: "Likely"` as a result - this will be true for essentially every
lead until a paid SERP-rank API is added.

## Setup

```bash
npm install
cp .env.example .env
# edit .env: set GOOGLE_PLACES_API_KEY (a Google Cloud project with
# "Places API (New)" enabled and billing set up - NOT the legacy "Places
# API", which cannot be enabled on new projects as of March 2025) and
# LEADS_BASIC_AUTH_USER / LEADS_BASIC_AUTH_PASSWORD
npm start
```

Then open http://localhost:3000 - your browser will prompt for the Basic
Auth credentials you set in `.env` (unless you left them unset, in which
case the app runs ungated and logs a warning - fine for local dev, never
for a deployed instance).

The API key is only ever read server-side (`server/placesClient.js`, called
from `server/routes/search.js`); it is never sent to the browser. This is a
security requirement from the spec, not a nice-to-have.

See `DEPLOY.md` for deploying this to a real subdomain (written for
SiteGround's Node.js App Manager, which is what this was built for, but the
app itself is a plain Express server that runs the same way anywhere).

### Production hardening

Since a deployed instance is reachable by anyone who has the URL, and every
search spends real Google Places API budget:
- **HTTP Basic Auth** gates the entire app (`server/authMiddleware.js`) -
  set `LEADS_BASIC_AUTH_USER`/`LEADS_BASIC_AUTH_PASSWORD` before deploying.
- **Rate limiting** caps `/api/search` at 20 requests per 15 minutes per
  client (`express-rate-limit`, wired in `server/routes/search.js`), so a
  leaked password or a stuck retry loop can't produce an open-ended bill.
- **`helmet()`** sets standard security response headers.
- **`app.set('trust proxy', 1)`** so rate limiting sees the real client IP
  through a host's reverse proxy instead of the proxy's own IP.

## Tests

```bash
npm test
```

Most tests are self-contained (Node's built-in test runner, no network calls)
and mock the Google Places API responses via dependency-injected `fetch`
implementations - there is no live API key available in the environment this
was built in.

`tests/regression.kingfisherEnid.test.js` runs real prior research (two
manually-reviewed Google Places "Plumbing" searches, Kingfisher OK and Enid
OK - see `tests/fixtures/kingfisherEnidResearch.json`) through the actual
pipeline. **It does not assert `score`/`status` against that fixture's own
score/status values** - those were produced by a separate qualitative
research pass, not by this rubric (proof: 8 businesses spanning rating
4.0-4.9, 16-258 reviews, with and without a real website, all land on the
same 65/Marginal, which the additive rubric cannot produce for all of them
at once). What the fixture *does* validate - GMB link construction, the
Owner Name/Email Phase 1 stub, and whether the vertical-mismatch/rubric-gap
flags fire - is asserted exactly, and it caught two real issues:
- **Fixed**: `verticalFilter.js` didn't recognize "mechanical" as an HVAC
  keyword, so "Dense Mechanical" (an HVAC company) slipped past the
  Plumbing-search mismatch filter. Added.
- **Fixed**: Competitive Delta's competitor pool was drawn from every place
  in the raw search batch, including vertical-mismatched ones - so a 313-
  review HVAC company could inflate the "competitor" average for actual
  plumbers in the same city. `leadPipeline.js` now excludes mismatched
  places from the competitor pool before computing stats.
- **Known limitation, not fixed**: "Bee Line Heating Air Conditioning and
  Plumbing" (per the research, primarily an HVAC business) is not flagged,
  because its name contains a plumbing keyword too - indistinguishable by
  name alone from "On Time Plumbing Heating Cooling & Electric" (a real
  multi-service business, correctly not flagged). The spec itself says this
  class of case needs review-text analysis, which Phase 1 does not
  implement; documented in the test rather than patched with a heuristic
  that would misfire on genuine multi-service businesses.

## Project layout

- `server/placesClient.js` - **Places API (New)** Text Search + Place Details
  client (the legacy Places API cannot be enabled on new Google Cloud
  projects as of March 2025). Runs two query phrasings per search
  (`"{industry} in {city}, {state}"` and `"{industry} company {city}
  {state}"`), dedupes by `place_id`, and adapts the New API's response shape
  (`displayName`, `userRatingCount`, `websiteUri`, etc.) back into the
  legacy-shaped object the rest of the codebase (scoring, vertical filter,
  pipeline) is written against - that adapter is the only place the API
  version matters.
- `server/authMiddleware.js` - HTTP Basic Auth gate for the whole app.
- `server/routes/search.js` - also wires in `express-rate-limit` on
  `/api/search`.
- `server/verticalFilter.js` - heuristic (name + Google `types`) mismatch
  detector, e.g. flags an HVAC company showing up in a Plumbing search.
  Flags, never silently excludes - mismatched rows still render so a human
  can override a false positive.
- `server/scoring.js` - pure functions implementing the four rubric
  categories (Visibility Gap, Reputation Gap, Business Viability Signal,
  Competitive Delta), including the explicitly-named "4-15 reviews AND
  rating >= 4.0" rubric gap and its unnamed sibling gap (16+ reviews AND
  3.5 <= rating < 4.0), both surfaced via `category_flag: "Rubric gap"`
  rather than a forced score.
- `server/leadPipeline.js` - orchestrates mismatch detection, per-batch
  competitor-stats computation (top 3 other results by review count, used
  as the Competitive Delta comparison since Phase 1 has no other competitor
  data source), scoring, and the GMB link.
- `server/routes/search.js` + `server/index.js` - Express backend proxy;
  holds the API key server-side.
- `public/` - static frontend: form, sortable results table with warning
  icons and status badges, JSON export.

## Known rubric interpretation notes

- **Competitive Delta** compares each business against the top 3 *other*
  results in the same search batch (by review count), since Phase 1 has no
  other source of "competitor" data. If fewer than one other result exists,
  it is reported as not scored, per spec.
- **Ambiguous boundary at exactly 15 reviews**: the spec's "4-15 reviews"
  and "15+ reviews" bands both literally include 15. Where this creates a
  real conflict (e.g. 15 reviews, rating < 3.5, which fits both the +25 and
  +20 bands), the lower score is used, per the spec's ambiguous-data rule.
- **On-page local SEO** (+5 visibility band) and **local pack ranking** (+20
  visibility band) are not evaluated in Phase 1 - the former is explicitly
  called out in the spec as an optional Phase 2 HTML-fetching check, and the
  latter is not obtainable from the Places API at all.
