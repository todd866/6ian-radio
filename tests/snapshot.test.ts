// The unified taste snapshot (music/taste/<listener>/snapshot.json) is the queue engine's
// profile source when present, with the R2 radio profile as the fallback. These tests pin
// the mapping and the selection with the store injected, so no R2 env is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotToProfile, loadQueueProfile } from '../lib/profile.ts';
import type { Account } from '../lib/auth';

const acc: Account = { id: 'ian', name: 'Ian', style: 'home' };

test('snapshotToProfile maps exactly the engine-relevant fields', () => {
  const snap = {
    listener: 'ian', tz: 'Australia/Perth', style: 'home', newShare: 0.9,
    likes: ['a'.repeat(64)], dislikes: ['b'.repeat(64)], skips: { ['c'.repeat(64)]: 2 },
    heard: { ['d'.repeat(64)]: 1795068000000 }, generatedAt: '2026-11-20T00:00:00Z',
  };
  assert.deepEqual(snapshotToProfile(snap, acc, false), {
    user: 'ian', style: 'home', qa: false, tz: 'Australia/Perth', newShare: 0.9,
    likes: snap.likes, dislikes: snap.dislikes, skips: snap.skips, heard: snap.heard, events: [],
  });
});

test('loadQueueProfile prefers the snapshot, falls back to the radio profile', async () => {
  const snap = { listener: 'ian', tz: 'Australia/Sydney', style: 'home', newShare: null, likes: [], dislikes: [], skips: {}, heard: {}, generatedAt: 'x' };
  const profile = { user: 'ian', style: 'home', tz: 'UTC', newShare: 0.6, likes: [], dislikes: [], skips: {}, heard: {}, events: [] };
  const keys: string[] = [];
  const get = async (k: string) => { keys.push(k); return k.startsWith('music/taste/') ? snap : profile; };
  const a = await loadQueueProfile(acc, false, get);
  assert.deepEqual(keys, ['music/taste/ian/snapshot.json']); // the snapshot alone answered
  assert.equal(a.tz, 'Australia/Sydney');
  const b = await loadQueueProfile(acc, false, async (_k: string) => (_k.startsWith('music/taste/') ? null : profile));
  assert.equal(b.tz, 'UTC'); // no snapshot: the radio profile
  const qa = await loadQueueProfile(acc, true, get);
  assert.ok(keys.includes('music/taste/ian-qa/snapshot.json')); // QA never touches the real snapshot
});
