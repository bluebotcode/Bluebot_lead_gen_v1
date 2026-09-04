'use strict';

/**
 * Pure scoring functions implementing the BlueBot rubric.
 *
 * Two things the spec calls out explicitly are honored throughout:
 *  - Local pack ranking and GMB claimed/unclaimed status are NOT available
 *    from the Places API. Those point bands are never awarded, and every
 *    scored lead is flagged visibility_gap_partial=true / local_pack_status
 *    "unknown" / confidence capped at "Likely". Unknown is never treated as
 *    "not ranking".
 *  - Ambiguous data rule: when a data point could fall into more than one
 *    band (or into none), score the lower value / surface it in notes
 *    rather than forcing or rounding up a number.
 */

const DIRECTORY_OR_SOCIAL_DOMAINS = [
  'facebook.com',
  'instagram.com',
  'yelp.com',
  'yellowpages.com',
  'linktr.ee',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'tiktok.com',
  'nextdoor.com'
];

function isDirectoryOrSocialDomain(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return DIRECTORY_OR_SOCIAL_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
  } catch {
    return false;
  }
}

// --- Visibility Gap (40 pts max; only 0/15 pts are ever actually awarded in
// Phase 1 - the local-pack-ranking band is undeterminable and the on-page-SEO
// band requires fetching the site's HTML, an optional Phase 2 check) ---
function scoreVisibilityGap(place, notes) {
  let points = 0;
  notes.push(
    'Local pack ranking not determinable from Places API; the +20 "not ranking" points are never applied (unknown is not treated as "not ranking").'
  );

  const website = place.website;
  if (!website) {
    points += 15;
    notes.push('No website found (+15 visibility gap).');
  } else if (isDirectoryOrSocialDomain(website)) {
    points += 15;
    notes.push(`Website is a directory/social page only (${website}) (+15 visibility gap).`);
  } else {
    notes.push(
      'Website has its own domain; on-page local SEO was not checked (Phase 2 feature, requires fetching site HTML), so the +5 band was not evaluated.'
    );
  }
  return points;
}

// --- Reputation Gap (35 pts max) ---
// The spec's bands do not partition the full (review-count, rating) space:
// it explicitly names one gap (4-15 reviews AND rating >= 4.0 fits no band)
// and instructs surfacing it via category_flag "Rubric gap" with a partial
// score rather than forcing a number. The same "no band fits" situation
// also arises for 16+ reviews with 3.5 <= rating < 4.0 (also uncovered by
// any stated band). Both are handled identically below, under the general
// ambiguous-data rule the spec states elsewhere.
function scoreReputationGap(rating, reviewCount, notes) {
  const hasRating = typeof rating === 'number';
  const reviews = typeof reviewCount === 'number' ? reviewCount : 0;

  notes.push(
    'GMB claim status not determinable from Places API (assumed claimed); the +15 "unclaimed" band is never applied.'
  );

  if (reviews <= 3) {
    notes.push(`Claimed, ${reviews} review(s) (0-3 band) (+20 reputation gap).`);
    return { points: 20, rubricGap: false };
  }

  // Healthy band: reviews >= 15 AND rating >= 4.0. Checked before the
  // "15+ but under 3.5" band so an exact 15-review tie resolves correctly.
  if (reviews >= 15 && hasRating && rating >= 4.0) {
    notes.push('Reviews and rating both healthy (15+ reviews, rating 4.0+) (+0 reputation gap).');
    return { points: 0, rubricGap: false };
  }

  if (reviews >= 15 && hasRating && rating < 3.5) {
    notes.push(`Claimed, ${reviews} reviews, rating ${rating} (15+ reviews, under 3.5) (+20 reputation gap).`);
    if (reviews === 15) {
      notes.push(
        'Review count of exactly 15 also satisfies the "4-15 reviews & under 4.0" band (+25); scored the lower value (+20) per the ambiguous-data rule.'
      );
    }
    return { points: 20, rubricGap: false };
  }

  if (reviews <= 15 && hasRating && rating < 4.0) {
    notes.push(`Claimed, ${reviews} reviews, rating ${rating} (4-15 reviews, under 4.0) (+25 reputation gap).`);
    return { points: 25, rubricGap: false };
  }

  notes.push(
    `Reputation Gap rubric gap: ${reviews} reviews, rating ${hasRating ? rating : 'none'} does not fit any defined band. Score left partial (0 pts for this section); flagged for human review instead of guessing.`
  );
  return { points: 0, rubricGap: true };
}

// --- Business Viability Signal (15 pts max) ---
function scoreBusinessViability(place, notes) {
  let points = 0;

  const hasPhone = Boolean(place.formatted_phone_number);
  const hasAddress = Boolean(place.formatted_address);
  if (hasPhone && hasAddress) {
    points += 10;
    notes.push('Active phone number and real address on file, category matches (+10 business viability).');
  } else {
    notes.push('Missing phone number and/or address; full business-viability signal not credited.');
  }

  const reviews = Array.isArray(place.reviews) ? place.reviews : [];
  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const hasRecentReview = reviews.some(
    (r) => typeof r.time === 'number' && Date.now() - r.time * 1000 <= ONE_YEAR_MS
  );
  if (hasRecentReview) {
    points += 5;
    notes.push('Recent review within the last 12 months found (+5 business viability).');
  } else if (reviews.length > 0) {
    notes.push('No review within the last 12 months among available review data; ongoing-operation signal not credited.');
  } else {
    notes.push('No review data returned by Places API; ongoing-operation signal not evaluated.');
  }

  const businessStatus = place.business_status || 'OPERATIONAL';
  const closureSign = businessStatus !== 'OPERATIONAL';
  if (closureSign) {
    notes.push(
      `Google reports business_status "${businessStatus}" (possible closure/seasonal/side operation); total score capped at 30.`
    );
  }

  return { points, closureSign };
}

// --- Competitive Delta (10 pts max) ---
// "Competitor" data is approximated as the top 3 other businesses (by review
// count) returned in the same search batch, since Phase 1 has no other
// competitor data source. competitorStats is null when fewer than 1 other
// business is available.
function scoreCompetitiveDelta(place, competitorStats, notes) {
  if (!competitorStats || competitorStats.count === 0) {
    notes.push('Competitive Delta not scored: no competitor data available in this result set.');
    return 0;
  }

  const { avgRating, avgReviews } = competitorStats;
  const businessReviews = typeof place.user_ratings_total === 'number' ? place.user_ratings_total : 0;
  const businessRating = typeof place.rating === 'number' ? place.rating : 0;

  const competitorsStrong = avgReviews >= 20 && avgRating >= 4.5;
  const businessHasNeither = businessReviews < 20 && businessRating < 4.5;

  if (competitorsStrong && businessHasNeither) {
    notes.push(
      `Top competitors average ${avgReviews.toFixed(1)} reviews at ${avgRating.toFixed(1)}★ while this business has neither (+10 competitive delta).`
    );
    return 10;
  }

  if (competitorsStrong) {
    notes.push(
      `Top competitors are strong (avg ${avgReviews.toFixed(1)} reviews, ${avgRating.toFixed(1)}★) but this business already matches them; no competitive delta.`
    );
    return 0;
  }

  notes.push(
    `Competitors also weak (avg ${avgReviews.toFixed(1)} reviews, ${avgRating.toFixed(1)}★) (+3 competitive delta).`
  );
  return 3;
}

function deriveStatus(categoryFlag, score) {
  if (categoryFlag) return 'Not scored';
  if (score >= 70) return 'Qualified';
  if (score >= 40) return 'Marginal';
  return 'Skip';
}

/**
 * Scores a single non-mismatched place. `competitorStats` is computed by the
 * caller from the rest of the batch (see leadPipeline.js).
 */
function scoreLead(place, competitorStats) {
  const notes = [];

  const visibilityPoints = scoreVisibilityGap(place, notes);
  const reputation = scoreReputationGap(place.rating, place.user_ratings_total, notes);
  const viability = scoreBusinessViability(place, notes);
  const competitivePoints = scoreCompetitiveDelta(place, competitorStats, notes);

  let score = visibilityPoints + reputation.points + viability.points + competitivePoints;
  if (viability.closureSign) {
    score = Math.min(score, 30);
  }

  const categoryFlag = reputation.rubricGap ? 'Rubric gap' : null;
  const status = deriveStatus(categoryFlag, score);

  return {
    score: Math.round(score),
    status,
    category_flag: categoryFlag,
    visibility_gap_partial: true,
    local_pack_status: 'unknown',
    confidence: 'Likely',
    notes
  };
}

module.exports = {
  scoreLead,
  scoreVisibilityGap,
  scoreReputationGap,
  scoreBusinessViability,
  scoreCompetitiveDelta,
  isDirectoryOrSocialDomain,
  deriveStatus
};
