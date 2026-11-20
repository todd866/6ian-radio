// Device tokens (Glancebar): parsing, revocation, and the rule that a device is accepted only on
// the device API, the queue and song info, never where a browser session is required.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bearerToken, deviceOk, deviceKey } from '../lib/device-token.ts';

const tok = 'A'.repeat(43);

test('bearer tokens: only a well-formed Bearer header is read', () => {
  assert.equal(bearerToken(`Bearer ${tok}`), tok);
  for (const bad of [null, '', tok, `bearer ${tok}`, `Bearer ${tok} x`, 'Bearer short', `Basic ${tok}`, `Bearer ${tok}\n`]) assert.equal(bearerToken(bad), null, String(bad));
});

test('only the hash is used as the key, never the token', () => {
  const k = deviceKey(tok);
  assert.match(k, /^radio\/devices\/[0-9a-f]{64}\.json$/);
  assert.ok(!k.includes(tok));
});

test('a revoked, empty or account-less device record is refused', () => {
  assert.equal(deviceOk(null), false);
  assert.equal(deviceOk({ account: 'ian', name: 'gb', at: 'x', revoked: true }), false);
  assert.equal(deviceOk({ account: '', name: 'gb', at: 'x' }), false);
  assert.equal(deviceOk({ account: 'ian', name: 'gb', at: 'x' }), true);
});

// Static policy over the routes: device auth appears only where it is allowed.
const ROOT = path.resolve(import.meta.dirname, '..');
function routes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? routes(p) : d.name === 'route.ts' || d.name.endsWith('.tsx') ? [p] : [];
  });
}
const ALLOWED = new Set(['app/api/device/moods/route.ts', 'app/api/device/signals/route.ts', 'app/api/device/taste/route.ts', 'app/api/device/lookup/route.ts', 'app/api/queue/route.ts', 'app/api/info/[sha]/route.ts']);

test('session-only routes never accept a device (email, claim, verify, me, login, flags, pages...)', () => {
  const files = routes(path.join(ROOT, 'app')).map((f) => path.relative(ROOT, f));
  for (const f of files) {
    const s = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const usesDevice = /requireAccountOrDevice|currentDevice/.test(s);
    if (!ALLOWED.has(f)) assert.ok(!usesDevice, `${f} must not accept a device token`);
  }
  for (const f of ['app/api/auth/email/route.ts', 'app/api/auth/claim/route.ts', 'app/api/me/route.ts']) assert.ok(files.includes(f), `${f} exists`);
});

test('flags (POST /api/info) take the session only; GET may take a device', () => {
  const s = fs.readFileSync(path.join(ROOT, 'app/api/info/[sha]/route.ts'), 'utf8');
  const post = s.slice(s.indexOf('export async function POST'));
  const get = s.slice(s.indexOf('export async function GET'), s.indexOf('export async function POST'));
  assert.match(post, /await requireAccount\(\)/);
  assert.doesNotMatch(post, /requireAccountOrDevice|currentDevice/);
  assert.match(get, /requireAccountOrDevice/);
});

test('the browser session (currentAccount) never reads a bearer token', () => {
  const s = fs.readFileSync(path.join(ROOT, 'lib/auth.ts'), 'utf8');
  assert.doesNotMatch(s, /authorization|Bearer|headers\(\)|currentDevice|from '.\/device/);
});
