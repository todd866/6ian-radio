// The now-playing heartbeat: one PUT per track start, then every 10 s while playing, and one
// final PUT on pause/stop. Failures are silent — no retry storm — and beats never queue up
// behind a slow PUT (at most one in flight). Tested with an injected clock.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHeartbeat, type Beat } from '../lib/heartbeat.ts';

function harness() {
  const sent: Beat[] = [];
  const timers: { at: number; fn: () => void }[] = [];
  let now = 0;
  let failNext = 0;
  const hb = createHeartbeat({
    put: async (doc) => { if (failNext > 0) { failNext--; throw new Error('offline'); } sent.push(doc); },
    intervalMs: 10_000,
    clock: () => now,
    schedule: (ms, fn) => { const t = { at: now + ms, fn }; timers.push(t); return () => { t.fn = () => {}; }; },
  });
  const tick = (ms: number) => { now += ms; for (const t of timers) if (t.at <= now) { t.at = Infinity; t.fn(); } };
  return { hb, sent, tick, fail: (n: number) => { failNext = n; } };
}

const track = (sha: string): Beat => ({ surface: 'browser', host: 'tab-1', sha, title: 'T', artist: 'A', position: 0, duration: 200 });

test('a beat sends at once, then every interval while playing', async () => {
  const h = harness();
  h.hb.beat(track('a'.repeat(64)));
  await h.hb.flush(); // let the fire-and-forget PUT land
  h.tick(10_000); h.hb.beat({ ...track('a'.repeat(64)), position: 10 }); // interval fired (position 0); the update only refreshes position
  await h.hb.flush();
  h.tick(10_000); await h.hb.flush();
  assert.equal(h.sent.length, 3);
  assert.deepEqual(h.sent.map((s) => s.position), [0, 0, 10]);
});

test('mid-track beats between intervals never PUT (the 4 Hz timeupdate storm)', async () => {
  const h = harness();
  h.hb.beat(track('a'.repeat(64)));
  await h.hb.flush();
  for (let i = 0; i < 20; i++) { h.tick(250); h.hb.beat({ ...track('a'.repeat(64)), position: 0.25 * (i + 1) }); } // 5 s of timeupdates
  await h.hb.flush();
  assert.equal(h.sent.length, 1); // still just the opening PUT
  h.tick(5_000); await h.hb.flush();
  assert.equal(h.sent.length, 2); // the interval timer carries the freshest position
});

test('stop sends one final beat; nothing fires after', async () => {
  const h = harness();
  h.hb.beat(track('a'.repeat(64)));
  await h.hb.flush();
  h.hb.stop();
  await h.hb.flush();
  h.tick(60_000); await h.hb.flush();
  assert.equal(h.sent.length, 2);
});

test('failed PUTs are silent and do not retry-storm', async () => {
  const h = harness();
  h.fail(99); // every PUT fails
  h.hb.beat(track('a'.repeat(64)));
  await h.hb.flush();
  for (let i = 0; i < 6; i++) { h.tick(10_000); await h.hb.flush(); }
  assert.equal(h.sent.length, 0); // nothing landed, nothing threw, exactly 7 attempts (1 + 6 intervals, 10 s apart)
  h.fail(0);
  h.hb.beat(track('a'.repeat(64))); // same track, interval not elapsed: the timer carries it
  await h.hb.flush();
  assert.equal(h.sent.length, 0);
  h.tick(10_000); await h.hb.flush();
  assert.equal(h.sent.length, 1); // it recovers on the next interval PUT
});

test('a new track replaces the old one immediately', async () => {
  const h = harness();
  h.hb.beat(track('a'.repeat(64)));
  await h.hb.flush();
  h.hb.beat(track('b'.repeat(64)));
  await h.hb.flush();
  assert.deepEqual(h.sent.map((s) => s.sha), ['a'.repeat(64), 'b'.repeat(64)]);
});
