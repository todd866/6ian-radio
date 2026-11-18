import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TZ, localHour, ruleAt, ruleFor, RULES } from '../lib/rules.ts';

test('default timezone is Australia/Perth', () => {
  assert.equal(DEFAULT_TZ, 'Australia/Perth');
});

test('Perth is UTC+8 with no daylight saving, whatever the server clock says', () => {
  // 01:00Z is 09:00 in Perth in both January and July.
  assert.equal(localHour(new Date('2026-01-15T01:00:00Z')), 9);
  assert.equal(localHour(new Date('2026-07-15T01:00:00Z')), 9);
  assert.equal(ruleAt(new Date('2026-11-18T01:00:00Z')).id, 'morning'); // 09:00 Perth
  assert.equal(ruleAt(new Date('2026-11-18T07:00:00Z')).id, 'afternoon'); // 15:00 Perth
  assert.equal(ruleAt(new Date('2026-11-18T15:00:00Z')).id, 'late'); // 23:00 Perth
});

test('per-account timezone moves the rules with the listener', () => {
  // 07:00Z: afternoon in Perth, morning in London (18 Nov, GMT).
  assert.equal(ruleAt(new Date('2026-11-18T07:00:00Z'), 'Australia/Perth').id, 'afternoon');
  assert.equal(ruleAt(new Date('2026-11-18T07:00:00Z'), 'Europe/London').id, 'morning');
  assert.equal(localHour(new Date('2026-11-18T07:00:00Z'), 'Not/AZone'), 15); // bad zone falls back to Perth
});

test('heavy is down in the morning and up in the afternoon', () => {
  assert.ok(ruleFor(9).heavy < 0);
  assert.ok(ruleFor(15).heavy > 0);
  const hours = Array.from({ length: 24 }, (_, h) => ruleFor(h).id);
  assert.equal(new Set(hours).size, RULES.length); // every rule covers some hour
});
