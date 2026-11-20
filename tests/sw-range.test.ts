// Service-worker HTTP 206 byte-range synthesis tests (Design D: Safari/iOS offline <audio>).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const SW_PATH = path.resolve(import.meta.dirname, '../public/sw.js');

function loadSwHelpers() {
  const src = fs.readFileSync(SW_PATH, 'utf8');
  const ctx: Record<string, unknown> = {
    self: { addEventListener() {} },
    Response,
    Request,
    URL,
    caches: {},
    location: { origin: 'https://example.test' },
  };
  vm.runInNewContext(`${src}\n;globalThis.__sw = { parseByteRange, synthesizeRangeResponse };`, ctx);
  return ctx.__sw as {
    parseByteRange: (h: string | null, total: number) => { start?: number; end?: number; total: number; unsatisfiable?: boolean } | null;
    synthesizeRangeResponse: (res: Response, range: string | null) => Promise<Response>;
  };
}

test('parseByteRange handles explicit, open-ended, suffix, and invalid byte ranges', () => {
  const { parseByteRange } = loadSwHelpers();
  const plain = (x: unknown) => (x === null ? null : JSON.parse(JSON.stringify(x)));
  assert.deepEqual(plain(parseByteRange('bytes=0-99', 1000)), { start: 0, end: 99, total: 1000 });
  assert.deepEqual(plain(parseByteRange('bytes=500-', 1000)), { start: 500, end: 999, total: 1000 });
  assert.deepEqual(plain(parseByteRange('bytes=-200', 1000)), { start: 800, end: 999, total: 1000 });
  assert.deepEqual(plain(parseByteRange('bytes=0-99999', 1000)), { start: 0, end: 999, total: 1000 });
  assert.deepEqual(plain(parseByteRange('bytes=1500-2000', 1000)), { unsatisfiable: true, total: 1000 });
  assert.equal(parseByteRange(null, 1000), null);
});

test('synthesizeRangeResponse returns valid 206 Content-Range slices and 416 on bad range', async () => {
  const { synthesizeRangeResponse } = loadSwHelpers();
  const payload = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const full = new Response(payload, { status: 200, headers: { 'content-type': 'audio/mp4' } });

  const r206 = await synthesizeRangeResponse(full.clone(), 'bytes=2-5');
  assert.equal(r206.status, 206);
  assert.equal(r206.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(r206.headers.get('content-length'), '4');
  assert.equal(r206.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual([...new Uint8Array(await r206.arrayBuffer())], [2, 3, 4, 5]);

  const r416 = await synthesizeRangeResponse(full.clone(), 'bytes=99-120');
  assert.equal(r416.status, 416);
  assert.equal(r416.headers.get('content-range'), 'bytes */10');
});
