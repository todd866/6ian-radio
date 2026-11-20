import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioKey } from '../lib/audiokey.ts';

test('AAC by default, the master on request, nothing when neither exists', () => {
  assert.equal(audioKey('s', 'AM-Lossless/a.m4a', true, 'aac'), 'radio/aac/s.mp4');
  assert.equal(audioKey('s', 'AM-Lossless/a.m4a', true, 'alac'), 'AM-Lossless/a.m4a');
  assert.equal(audioKey('s', '', true, 'alac'), 'radio/aac/s.mp4'); // a stand-in find: no master
  assert.equal(audioKey('s', 'AM-Lossless/a.m4a', false, 'aac'), 'AM-Lossless/a.m4a');
  assert.equal(audioKey('s', '', false, 'aac'), null);
  assert.equal(audioKey('s', '  ', false, 'alac'), null);
  assert.equal(audioKey('s', undefined, false, null), null);
});
