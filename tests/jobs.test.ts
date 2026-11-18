import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { AwsClient } from 'aws4fetch';
import { listAll } from '../lib/paging.ts';
import { reserve, CapReached, type CasStore, type Usage } from '../lib/counter.ts';

test('listing walks every page and returns pending jobs oldest first', async () => {
  const pages: Record<string, { keys: string[]; next?: string }> = {
    start: { keys: ['p/20261118030000-aaaaaa.json', 'p/20261118010000-bbbbbb.json'], next: 't1' },
    t1: { keys: ['p/20261118020000-cccccc.json'], next: 't2' },
    t2: { keys: ['p/20261117230000-dddddd.json'] },
  };
  const seen: (string | undefined)[] = [];
  const keys = await listAll(async (t) => { seen.push(t); return pages[t ?? 'start']; });
  assert.deepEqual(seen, [undefined, 't1', 't2']);
  assert.equal(keys.length, 4);
  assert.equal(keys[0], 'p/20261117230000-dddddd.json');
});

function memStore(): CasStore {
  const d = new Map<string, { body: Usage; etag: string }>(); let v = 0;
  return {
    async get(k) { await new Promise((r) => setTimeout(r, Math.random() * 5)); const x = d.get(k); return x ? { body: structuredClone(x.body), etag: x.etag } : null; },
    async putIf(k, b, e) { await new Promise((r) => setTimeout(r, Math.random() * 5)); const x = d.get(k); if ((e === null && x) || (e !== null && x?.etag !== e)) return false; d.set(k, { body: structuredClone(b), etag: `e${++v}` }); return true; },
  };
}

test('job bucket: 40 parallel requests against a cap of 30 let exactly 30 through', async () => {
  const s = memStore();
  const r = await Promise.allSettled(Array.from({ length: 40 }, () => reserve(s, 'u', 'job', 30, 'd', 200)));
  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 30);
  assert.ok(r.filter((x) => x.status === 'rejected').every((x) => (x as PromiseRejectedResult).reason instanceof CapReached));
});

const envFile = `${process.env.HOME}/.config/music-radio/r2.env`;
const env = fs.existsSync(envFile) ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').trim().split('\n').map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)])) : null;

test('R2: paged listing (2 per page) sees all 5 test keys in order', { skip: !env && 'no R2 credentials' }, async () => {
  const c = new AwsClient({ accessKeyId: env!.R2_ACCESS_KEY_ID, secretAccessKey: env!.R2_SECRET_ACCESS_KEY, service: 's3', region: 'auto' });
  const base = `${env!.R2_ENDPOINT}/${env!.R2_BUCKET}`;
  const prefix = `radio/jobs/_test-${Date.now()}/`;
  const ids = ['20261118050000-000005', '20261118010000-000001', '20261118030000-000003', '20261118020000-000002', '20261118040000-000004'];
  await Promise.all(ids.map((id) => c.fetch(`${base}/${prefix}${id}.json`, { method: 'PUT', body: '{}' })));
  try {
    const keys = await listAll(async (token) => {
      const u = new URL(base); u.searchParams.set('list-type', '2'); u.searchParams.set('prefix', prefix); u.searchParams.set('max-keys', '2');
      if (token) u.searchParams.set('continuation-token', token);
      const xml = await (await c.fetch(u.toString())).text();
      const next = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)</.exec(xml)?.[1] : undefined;
      return { keys: [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]), next };
    });
    assert.deepEqual(keys, [...ids].sort().map((id) => `${prefix}${id}.json`));
  } finally {
    await Promise.all(ids.map((id) => c.fetch(`${base}/${prefix}${id}.json`, { method: 'DELETE' }))); // test objects only
  }
});
