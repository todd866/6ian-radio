import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eraOf, fastText } from '../lib/voice.ts';

test('era phrases become year ranges', () => {
  assert.deepEqual(eraOf('90s only'), { from: 1990, to: 1999 });
  assert.deepEqual(eraOf('something from the seventies'), { from: 1970, to: 1979 });
  assert.deepEqual(eraOf('1980s'), { from: 1980, to: 1989 });
  assert.deepEqual(eraOf("2000's stuff"), { from: 2000, to: 2009 });
  assert.equal(eraOf('something heavier'), null);
});

test('typed "90s only" takes the fast path', () => {
  assert.equal(fastText('90s only')?.intent, 'era');
  assert.equal(fastText('play Harvest Moon')?.intent, 'play');
});
