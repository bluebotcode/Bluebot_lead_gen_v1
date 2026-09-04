'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { detectVerticalMismatch } = require('../server/verticalFilter');

test('detectVerticalMismatch: matching trade name is not a mismatch', () => {
  const result = detectVerticalMismatch({ name: 'Acme Plumbing Co', types: ['plumber'] }, 'Plumbing');
  assert.equal(result.isMismatch, false);
  assert.equal(result.categoryFlag, null);
});

test('detectVerticalMismatch: HVAC business flagged when searching Plumbing', () => {
  const result = detectVerticalMismatch({ name: 'Joe\'s Heat & Air', types: ['hvac_contractor'] }, 'Plumbing');
  assert.equal(result.isMismatch, true);
  assert.equal(result.categoryFlag, 'Vertical mismatch');
  assert.match(result.reason, /hvac/);
});

test('detectVerticalMismatch: electrical business flagged when searching Plumbing', () => {
  const result = detectVerticalMismatch({ name: 'Bright Spark Electric', types: [] }, 'Plumbing');
  assert.equal(result.isMismatch, true);
});

test('detectVerticalMismatch: unrecognized industry keyword skips detection (no false positives)', () => {
  const result = detectVerticalMismatch({ name: 'Anything LLC', types: [] }, 'Artisanal Candlemaking');
  assert.equal(result.isMismatch, false);
  assert.equal(result.categoryFlag, null);
  assert.match(result.reason, /skipped/);
});

test('detectVerticalMismatch: ambiguous/generic name for the target trade is not flagged', () => {
  const result = detectVerticalMismatch({ name: 'City Plumbing & Rooter', types: ['plumber', 'point_of_interest'] }, 'Plumbing');
  assert.equal(result.isMismatch, false);
});
