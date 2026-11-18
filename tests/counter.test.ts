import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reserve, CapReached, type CasStore, type Usage } from '../lib/counter.ts';

// A store with R2's conditional-write semantics and random latency.
function fakeStore(): CasStore & { data: Map<string, { body: Usage; etag: string }>; failReads: boolean } {
  const data = new Map<string, { body: Usage; etag: string }>();
  let v = 0;
  const sleep = () => new Promise((r) => setTimeout(r, Math.random() * 8));
  return {
    data, failReads: false,
    async get(k) { await sleep(); if (this.failReads) throw new Error('read failed'); const x = data.get(k); return x ? { body: structuredClone(x.body), etag: x.etag } : null; },
    async putIf(k, body, etag) { await sleep(); const x = data.get(k); if ((etag === null && x) || (etag !== null && x?.etag !== etag)) return false; data.set(k, { body: structuredClone(body), etag: `e${++v}` }); return true; },
  };
}

test('20 parallel requests at cap - 1 let exactly one through', async () => {
  const s = fakeStore();
  s.data.set('k', { body: { day: 'd', n: { voice: 9 } }, etag: 'e0' });
  const r = await Promise.allSettled(Array.from({ length: 20 }, () => reserve(s, 'k', 'voice', 10, 'd', 40)));
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.ok(r.filter((x) => x.status === 'rejected').every((x) => (x as PromiseRejectedResult).reason instanceof CapReached || /busy/.test(String((x as PromiseRejectedResult).reason))));
  assert.equal(s.data.get('k')!.body.n.voice, 10);
});

test('fails closed when the usage record cannot be read', async () => {
  const s = fakeStore();
  s.failReads = true;
  await assert.rejects(reserve(s, 'k', 'voice', 10, 'd'));
});

test('a new day starts from zero; not-found starts fresh', async () => {
  const s = fakeStore();
  assert.equal(await reserve(s, 'k', 'voice', 10, 'd1'), 1);
  s.data.set('k', { body: { day: 'd1', n: { voice: 10 } }, etag: 'x' });
  await assert.rejects(reserve(s, 'k', 'voice', 10, 'd1'), CapReached);
  assert.equal(await reserve(s, 'k', 'voice', 10, 'd2'), 1);
});
