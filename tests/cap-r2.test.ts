// Integration: the same reserve() against real R2 conditional writes (radio/caps/_test.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AwsClient } from 'aws4fetch';
import { reserve, CapReached } from '../lib/counter.ts';

const envFile = `${process.env.HOME}/.config/music-radio/r2.env`;
const env = fs.existsSync(envFile) ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : null;

test('R2: 20 parallel at cap - 1 let exactly one through', { skip: !env && 'no R2 credentials' }, async () => {
  const c = new AwsClient({ accessKeyId: env!.R2_ACCESS_KEY_ID, secretAccessKey: env!.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
  const url = (k: string) => `${env!.R2_ENDPOINT}/${env!.R2_BUCKET}/${k}`;
  const store = {
    async get(k: string) { const r = await c.fetch(url(k), { headers: { 'accept-encoding': 'identity' } }); if (r.status === 404) return null; if (!r.ok) throw new Error(String(r.status)); return { body: await r.json(), etag: r.headers.get('etag')!.replace(/^W\//, '') }; },
    async putIf(k: string, body: unknown, etag: string | null) {
      const r = await c.fetch(url(k), { method: 'PUT', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...(etag ? { 'if-match': etag } : { 'if-none-match': '*' }) } });
      if (r.status === 412 || r.status === 409) return false; if (!r.ok) throw new Error(String(r.status)); return true;
    },
  };
  const key = 'radio/caps/_test.json', day = `test-${Date.now()}`;
  const seed = await store.get(key);
  assert.ok(await store.putIf(key, { day, n: { voice: 9 } }, seed ? seed.etag : null));
  const r = await Promise.allSettled(Array.from({ length: 20 }, () => reserve(store, key, 'voice', 10, day, 40)));
  const ok = r.filter((x) => x.status === 'fulfilled').length;
  const rejected = r.filter((x) => x.status === 'rejected').map((x) => (x as PromiseRejectedResult).reason);
  assert.equal(ok, 1, `fulfilled ${ok}`);
  assert.ok(rejected.every((e) => e instanceof CapReached || /busy/.test(String(e))));
  assert.equal((await store.get(key))!.body.n.voice, 10);
});
