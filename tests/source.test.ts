import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceOf, stationsOf } from '../lib/source.ts';

test('a find names the stations that played it, from its own record', () => {
  assert.deepEqual(stationsOf({ sc: { src: 'radio', why: 'bbc6 + kexp' } }), ['bbc6', 'kexp']);
  assert.equal(sourceOf({ sc: { src: 'radio', why: 'bbc6 + kexp' } })?.why, 'played on 6 Music and KEXP');
  assert.equal(sourceOf({ sc: { src: 'station:kexp', why: 'KEXP, 3 plays' } })?.why, 'played on KEXP (3 plays)');
  assert.equal(sourceOf({ sc: { src: 'station:kexp', why: null } })?.chip, 'KEXP');
});

test('a lane tag we cannot name says only that it is new', () => {
  assert.equal(sourceOf({ sc: { src: 'genre:soul' } })?.why, 'a new find, not in your library');
  assert.equal(sourceOf({ sc: { src: 'hiphop' } })?.chip, 'New find');
  assert.equal(sourceOf({}), null);
});

test('the feed records when a station last played it', () => {
  assert.equal(sourceOf({ sc: { src: 'radio', why: 'bbc6 + kexp · last 2026-11-18' } })?.why, 'played on 6 Music and KEXP (last 18 Nov)');
  assert.equal(sourceOf({ sc: { src: 'station:kexp', why: 'KEXP, 3 plays · last 2026-11-17' } })?.why, 'played on KEXP (3 plays, last 17 Nov)');
  assert.equal(sourceOf({ sc: { src: 'ytm', why: 'Discover Mix' } })?.why, 'recommended by YouTube Music (Discover Mix)');
});
