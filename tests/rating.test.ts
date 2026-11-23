import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedBy, ratingFromCookie } from '../lib/rating.ts';
import type { Track } from '../vendor/engine/space.ts';

const T = (s: string, a: string, t: string, xr?: string) => ({ s, a, t, ...(xr ? { xr } : {}) }) as unknown as Track;
const dirty = T('1', 'Dr. Dre', 'The Next Episode (feat. Snoop Dogg)');
const clean = T('2', 'Dr. Dre', 'The Next Episode', 'c');
const both = T('3', 'Eminem', 'Lose Yourself');
const plain = T('4', 'ODESZA', 'Keep Her Close');
const loneClean = T('5', 'Mac Miller', 'Gees', 'c');
const map = { '1': 'e', '3': 'm' };
const tracks = [dirty, clean, both, plain, loneClean];

test('PG skips explicit and unknown-edition songs, keeps cleaned edits', () => {
  const ok = allowedBy('pg', tracks, map);
  assert.deepEqual(tracks.filter(ok).map((t) => t.s), ['2', '4', '5']);
});

test('M plays everything but drops a cleaned edit when the explicit one is in the map', () => {
  const ok = allowedBy('m', tracks, map);
  assert.deepEqual(tracks.filter(ok).map((t) => t.s), ['1', '3', '4', '5']);
});

test('only the mr_rating=m cookie lifts the rating', () => {
  assert.equal(ratingFromCookie('a=1; mr_rating=m; b=2'), 'm');
  assert.equal(ratingFromCookie('mr_rating=pg'), 'pg');
  assert.equal(ratingFromCookie('xmr_rating=m'), 'pg');
  assert.equal(ratingFromCookie(null), 'pg');
});
