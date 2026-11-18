// "This is wrong" flags: only the admin hides a fact for everyone; anyone else's flag hides it for
// that account alone, in its own doc with its own cap; allowlisted keys; no lost writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addFlag, hiddenFor, readFlags, adminKey, ownKey, FlagRejected, MAX_ADMIN, MAX_OWN, ADMIN, type Store } from '../lib/flags.ts';

function memStore(): Store {
  const m = new Map<string, { body: string; etag: string }>();
  let n = 0;
  const jitter = () => new Promise((r) => setTimeout(r, Math.random() * 3));
  return {
    async get(k) { await jitter(); const v = m.get(k); return v ? { body: JSON.parse(v.body), etag: v.etag } : null; },
    async putIf(k, body, etag) {
      await jitter();
      const v = m.get(k);
      if (etag === null ? v : !v || v.etag !== etag) return false;
      m.set(k, { body: JSON.stringify(body), etag: `e${++n}` });
      return true;
    },
  };
}

const sha = 'a'.repeat(64);
const allowed = new Set(['year', 'album', 'bio', 'lyrics']);
const A = 'u0123456789abcdef', B = 'ufedcba9876543210';

test('a listener flag hides the field for that account only', async () => {
  const s = memStore();
  await addFlag(s, sha, 'year', '2005', A, false, allowed);
  assert.ok((await hiddenFor(s, sha, A, false)).has('year'));
  assert.ok(!(await hiddenFor(s, sha, B, false)).has('year'));
});

test('many accounts flagging still hide nothing globally; the admin does', async () => {
  const s = memStore();
  for (const w of [A, B, 'mate']) await addFlag(s, sha, 'year', '2005', w, false, allowed);
  assert.ok(!(await hiddenFor(s, sha, 'u1111111111111111', false)).has('year'));
  await addFlag(s, sha, 'bio', 'x', ADMIN, false, allowed);
  assert.ok((await hiddenFor(s, sha, 'u1111111111111111', false)).has('bio'));
});

test('QA flags never touch the real store', async () => {
  const s = memStore();
  await addFlag(s, sha, 'year', '2005', ADMIN, true, allowed);
  assert.ok(!(await hiddenFor(s, sha, A, false)).has('year'));
  assert.ok((await hiddenFor(s, sha, A, true)).has('year'));
  assert.notEqual(adminKey(sha, true), adminKey(sha, false));
});

test('only keys the server emitted are accepted', async () => {
  await assert.rejects(addFlag(memStore(), sha, 'evil:<script>', 'x', A, false, allowed), FlagRejected);
});

test('a listener can only fill their own doc (MAX_OWN), never the admin doc', async () => {
  const s = memStore();
  const many = new Set(Array.from({ length: 40 }, (_, i) => `f${i}`));
  for (let i = 0; i < MAX_OWN; i++) await addFlag(s, sha, `f${i}`, 'v', A, false, many);
  await assert.rejects(addFlag(s, sha, `f${MAX_OWN}`, 'v', A, false, many), FlagRejected);
  assert.equal(Object.keys((await readFlags(s, adminKey(sha, false))).fields).length, 0);
  for (let i = 0; i < MAX_ADMIN; i++) await addFlag(s, sha, `f${i}`, 'v', ADMIN, false, many); // admin's room untouched
  await assert.rejects(addFlag(s, sha, `f${MAX_ADMIN}`, 'v', ADMIN, false, many), FlagRejected);
  await addFlag(s, sha, 'f0', 'v', B, false, many); // other listeners keep their own room
  assert.equal(Object.keys((await readFlags(s, ownKey(sha, B, false))).fields).length, 1);
});

test('concurrent flags from one account are all kept (conditional writes)', async () => {
  const s = memStore();
  await Promise.all([...allowed].map((f) => addFlag(s, sha, f, 'v', A, false, allowed, 200)));
  assert.equal(Object.keys((await readFlags(s, ownKey(sha, A, false))).fields).length, allowed.size);
});

test('global flags live only under admin/; a legacy shared doc is never read as global', async () => {
  const s = memStore();
  assert.match(adminKey(sha, false), /\/flags\/admin\//);
  assert.match(ownKey(sha, A, false), /\/flags\/own\//);
  await s.putIf(`radio/info/flags/${sha}.json`, { fields: { year: { value: '2005', at: 'x', by: [A, B] } } } as never, null);
  assert.ok(!(await hiddenFor(s, sha, 'u1111111111111111', false)).has('year'));
});
