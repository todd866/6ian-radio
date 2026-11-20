// Per-writer now-playing documents: every surface writes its own object under
// music/now/<listener>/<surface>-<host>.json; readers take the freshest live one.
// Pure helpers tested here (no framework imports); the route's auth is pinned by
// tests/device.test.ts's ALLOWED set plus the source checks at the bottom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nowKey, isLive, NOW_LIVE_MS } from '../lib/now-playing.ts';

test('each surface-host pair gets its own object key', () => {
  const a = nowKey('ian', 'browser', 'safari-m5');
  const b = nowKey('ian', 'mac', 'm5');
  assert.equal(a, 'music/now/ian/browser-safari-m5.json');
  assert.equal(b, 'music/now/ian/mac-m5.json');
  assert.notEqual(a, b);
});

test('a heartbeat older than the window is not live', () => {
  const now = 1795068000000;
  const doc = { surface: 'browser', host: 'x', at: new Date(now - 90_000).toISOString() };
  assert.equal(isLive(doc, now), false);
  assert.equal(isLive({ ...doc, at: new Date(now - 10_000).toISOString() }, now), true);
  assert.equal(NOW_LIVE_MS, 60_000);
});

// The route itself: a device token is required, and only that route file touches music/now/.
const ROOT = path.resolve(import.meta.dirname, '..');
const ROUTE = 'app/api/device/now/route.ts';

test('the now route authenticates and lives in the device API', () => {
  const s = fs.readFileSync(path.join(ROOT, ROUTE), 'utf8');
  assert.match(s, /requireAccountOrDevice/);
  assert.match(s, /return a;/);
});

test('nothing else writes into music/now/', () => {
  const files = fs.readdirSync(path.join(ROOT, 'lib'), { withFileTypes: true }).filter((d) => d.isFile()).map((d) => d.name);
  for (const f of files) {
    if (f === 'now-playing.ts') continue;
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'lib', f), 'utf8'), /music\/now\//, `${f} must not touch music/now/`);
  }
});
