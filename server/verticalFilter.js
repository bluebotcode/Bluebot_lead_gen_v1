'use strict';

/**
 * Heuristic trade keyword map used to flag vertical mismatches (e.g. an HVAC
 * company showing up in a Plumbing search). Google's Places "types" taxonomy
 * is broad and Text Search results routinely mix adjacent trades.
 *
 * This is a best-effort, name/types-based heuristic per the spec ("If
 * business name or majority of visible review text is clearly about a
 * different trade..."). Review-text analysis is NOT implemented in Phase 1
 * (it would require fetching and parsing review content beyond what Place
 * Details returns by default) - only name and Google "types" are checked.
 * Flagged rows are still shown so a human can override a false positive.
 */
const TRADES = {
  plumbing: {
    keywords: ['plumbing', 'plumber'],
    types: ['plumber']
  },
  hvac: {
    keywords: ['hvac', 'heating', 'air conditioning', 'heat & air', 'heat and air', 'cooling'],
    types: ['hvac_contractor']
  },
  electrical: {
    keywords: ['electric', 'electrical', 'electrician'],
    types: ['electrician']
  },
  roofing: {
    keywords: ['roofing', 'roofer'],
    types: ['roofing_contractor']
  },
  landscaping: {
    keywords: ['landscap', 'lawn care', 'lawn'],
    types: ['landscaper']
  },
  painting: {
    keywords: ['painting', 'painter'],
    types: ['painter']
  },
  general_contractor: {
    keywords: ['contractor', 'construction', 'builders'],
    types: ['general_contractor']
  },
  pest_control: {
    keywords: ['pest control', 'exterminat'],
    types: ['pest_control_service']
  },
  locksmith: {
    keywords: ['locksmith'],
    types: ['locksmith']
  },
  garage_door: {
    keywords: ['garage door'],
    types: ['garage_door_supplier']
  },
  flooring: {
    keywords: ['flooring', 'floor covering'],
    types: ['flooring_contractor']
  },
  roadside_towing: {
    keywords: ['towing', 'roadside'],
    types: ['towing_service']
  }
};

function detectTrade(industryRaw) {
  const industry = (industryRaw || '').toLowerCase();
  for (const [key, def] of Object.entries(TRADES)) {
    if (def.keywords.some((kw) => industry.includes(kw)) || industry.includes(key.replace('_', ' '))) {
      return key;
    }
  }
  return null;
}

/**
 * Returns { isMismatch, categoryFlag, reason }.
 * categoryFlag is either null or the literal string "Vertical mismatch".
 */
function detectVerticalMismatch(place, industry) {
  const targetTrade = detectTrade(industry);
  const name = (place.name || '').toLowerCase();
  const types = place.types || [];

  if (!targetTrade) {
    return {
      isMismatch: false,
      categoryFlag: null,
      reason: 'Vertical mismatch check skipped: industry keyword not recognized by heuristic map.'
    };
  }

  const targetDef = TRADES[targetTrade];
  const nameMatchesTarget = targetDef.keywords.some((kw) => name.includes(kw));
  const typesMatchTarget = types.some((t) => targetDef.types.includes(t));

  if (nameMatchesTarget || typesMatchTarget) {
    return { isMismatch: false, categoryFlag: null, reason: null };
  }

  for (const [otherKey, otherDef] of Object.entries(TRADES)) {
    if (otherKey === targetTrade) continue;
    const nameMatchesOther = otherDef.keywords.some((kw) => name.includes(kw));
    const typesMatchOther = types.some((t) => otherDef.types.includes(t));
    if (nameMatchesOther || typesMatchOther) {
      return {
        isMismatch: true,
        categoryFlag: 'Vertical mismatch',
        reason: `Business appears to be ${otherKey.replace('_', ' ')}, not ${targetTrade.replace('_', ' ')} (heuristic match on name/category; verify and override if incorrect).`
      };
    }
  }

  return { isMismatch: false, categoryFlag: null, reason: null };
}

module.exports = { detectTrade, detectVerticalMismatch, TRADES };
