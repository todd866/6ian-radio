import { AwsClient } from 'aws4fetch';

const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`missing env ${k}`);
  return v;
};

let client: AwsClient | null = null;
function r2() {
  client ??= new AwsClient({ accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY'), service: 's3', region: 'auto' });
  return client;
}

function objectUrl(key: string) {
  if (!key?.trim() || key.endsWith('/')) throw new Error('refusing an empty R2 key'); // never sign the bucket root
  // encodeURIComponent leaves '.' alone, so a '..' segment would URL-resolve outside the
  // allowed prefix no matter which allowlist regex matched. No key we write needs one.
  const segs = key.split('/');
  if (segs.some((s) => !s || s === '.' || s === '..')) throw new Error(`refusing a dot-segment R2 key: ${key.slice(0, 80)}`);
  return new URL(`${env('R2_ENDPOINT')}/${env('R2_BUCKET')}/${segs.map(encodeURIComponent).join('/')}`);
}

// Signed GET. The signing time is floored to `windowS` so the same object gets the same URL
// for a while, which lets the browser cache art and audio between requests.
export async function presign(key: string, ttlS = 3600, windowS = 900): Promise<string> {
  const u = objectUrl(key);
  u.searchParams.set('X-Amz-Expires', String(ttlS + windowS));
  const t = new Date(Math.floor(Date.now() / 1000 / windowS) * windowS * 1000);
  const datetime = t.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const signed = await r2().sign(new Request(u, { method: 'GET' }), { aws: { signQuery: true, datetime } });
  return signed.url;
}

export async function getJSON<T>(key: string): Promise<T | null> {
  const res = await r2().fetch(objectUrl(key).toString(), { method: 'GET' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`R2 GET ${key}: ${res.status}`);
  return (await res.json()) as T;
}

// Only ever writes under radio/profiles/: the masters are never touched by the app.
export async function putJSON(key: string, body: unknown): Promise<void> {
  if (!/^(radio\/(profiles|jobs|accounts|tokens|claims|info|devices)\/|music\/taste\/[a-z0-9][a-z0-9_-]{0,31}\/snapshot\.json$|music\/now\/[a-z0-9][a-z0-9_-]{0,31}\/(browser|mac|tv)-[a-z0-9][a-z0-9_-]{0,31}\.json$)/.test(key)) throw new Error('refusing to write outside the radio app prefixes');
  const bytes = Buffer.from(JSON.stringify(body)); // explicit length: R2 answers 411 to a chunked PUT
  const res = await r2().fetch(objectUrl(key).toString(), {
    method: 'PUT', body: bytes, headers: { 'content-type': 'application/json', 'content-length': String(bytes.length) },
  });
  if (!res.ok) throw new Error(`R2 PUT ${key}: ${res.status}`);
}

// Compare-and-swap store: spend counters (radio/caps/) and listener profiles (radio/profiles/).
export const capStore = {
  async get(key: string) {
    // identity: a compressed response carries a weak ETag (W/"..."), which If-Match never matches
    const res = await r2().fetch(objectUrl(key).toString(), { method: 'GET', headers: { 'accept-encoding': 'identity' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET ${key}: ${res.status}`);
    const etag = res.headers.get('etag')?.replace(/^W\//, '');
    if (!etag) throw new Error('R2 GET without etag');
    return { body: await res.json(), etag };
  },
  async putIf(key: string, body: unknown, etag: string | null) {
    if (!/^radio\/((caps|profiles|emails|tokens|claims|info)\/|extra\.json$|media-extra\.json$)/.test(key)) throw new Error('refusing to write outside the radio app prefixes'); // radio/info/: addFlag's CAS writes
    const bytes = Buffer.from(JSON.stringify(body));
    const res = await r2().fetch(objectUrl(key).toString(), {
      method: 'PUT', body: bytes,
      headers: { 'content-type': 'application/json', 'content-length': String(bytes.length), ...(etag ? { 'if-match': etag } : { 'if-none-match': '*' }) },
    });
    if (res.status === 412 || res.status === 409) return false;
    if (!res.ok) throw new Error(`R2 PUT ${key}: ${res.status}`);
    return true;
  },
};

// Append-only CAS text store strictly for this app's own unified taste-log shards.
const TASTE_KEY_RE = /^music\/taste\/[a-z0-9][a-z0-9_-]{0,31}\/\d{4}-\d{2}\/6ian-[a-z0-9_-]{1,32}\.jsonl$/;
export const tasteStore = {
  async get(key: string): Promise<{ text: string; etag: string } | null> {
    if (!TASTE_KEY_RE.test(key)) throw new Error('refusing to read outside 6ian taste shards');
    const res = await r2().fetch(objectUrl(key).toString(), { method: 'GET', headers: { 'accept-encoding': 'identity' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET ${key}: ${res.status}`);
    const etag = res.headers.get('etag')?.replace(/^W\//, '');
    if (!etag) throw new Error('R2 GET without etag');
    return { text: await res.text(), etag };
  },
  async putIf(key: string, text: string, etag: string | null): Promise<boolean> {
    if (!TASTE_KEY_RE.test(key)) throw new Error('refusing to write outside 6ian taste shards');
    const bytes = Buffer.from(text, 'utf8');
    const res = await r2().fetch(objectUrl(key).toString(), {
      method: 'PUT', body: bytes,
      headers: { 'content-type': 'application/x-ndjson', 'content-length': String(bytes.length), ...(etag ? { 'if-match': etag } : { 'if-none-match': '*' }) },
    });
    if (res.status === 412 || res.status === 409) return false;
    if (!res.ok) throw new Error(`R2 PUT ${key}: ${res.status}`);
    return true;
  },
};

export async function listPage(prefix: string, token?: string, max = 200): Promise<{ keys: string[]; next?: string }> {
  const u = new URL(`${env('R2_ENDPOINT')}/${env('R2_BUCKET')}`);
  u.searchParams.set('list-type', '2'); u.searchParams.set('prefix', prefix); u.searchParams.set('max-keys', String(max));
  if (token) u.searchParams.set('continuation-token', token);
  const res = await r2().fetch(u.toString());
  if (!res.ok) throw new Error(`R2 LIST ${prefix}: ${res.status}`);
  const xml = await res.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
  const next = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
  return { keys, next: truncated ? next : undefined };
}

// Only finished jobs leave the pending prefix; nothing else is ever deleted by the app.
export async function deletePending(key: string): Promise<void> {
  if (!/^radio\/jobs\/pending\/[0-9]{14}-[0-9a-f]{6}\.json$/.test(key)) throw new Error('refusing to delete outside radio/jobs/pending/');
  const res = await r2().fetch(objectUrl(key).toString(), { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${key}: ${res.status}`);
}
