import { NextResponse } from 'next/server';
import { requireAccount } from '@/lib/http';
import { space, refreshExtra } from '@/lib/space';
import { media } from '@/lib/media';
import { presign } from '@/lib/r2';
import { tunnelUrl, streamToken } from '@/lib/tunnel';

export const maxDuration = 300;

// Same-origin audio: session check, then the R2 object fetched through a short-lived signed URL
// and streamed back with Range support. Same-origin is what lets the player run the music
// through Web Audio (ducking under the voice) without needing CORS on the bucket.
export async function GET(req: Request, ctx: { params: Promise<{ sha: string }> }) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const { sha } = await ctx.params;
  await refreshExtra();
  if (!space().bySha.has((await ctx.params).sha)) await refreshExtra(true);
  const S = space();
  const i = S.bySha.get(sha);
  if (i === undefined) return new NextResponse(null, { status: 404 });
  const q = new URL(req.url).searchParams.get('q');
  const info = (await media())[sha] ?? (await media(true))[sha];
  const range = req.headers.get('range');
  let up: Response;
  if (info && info.r2 === false) {
    // Just fetched on the home worker and not in R2 yet: stream it from the worker's tunnel.
    const t = await tunnelUrl();
    if (!t) return new NextResponse(null, { status: 503 });
    up = await fetch(`${t}/stream/${sha}.mp4?${streamToken(sha, a.id)}`, { headers: range ? { range } : {}, signal: AbortSignal.timeout(20000) });
  } else {
    const key = q === 'alac' || !info?.aac ? S.tracks[i].key : `radio/aac/${sha}.mp4`;
    up = await fetch(await presign(key, 600), { headers: range ? { range } : {} });
  }
  if (!up.ok && up.status !== 206) return new NextResponse(null, { status: up.status });
  const h = new Headers({ 'content-type': 'audio/mp4', 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=3600' });
  for (const k of ['content-length', 'content-range', 'etag', 'last-modified']) { const v = up.headers.get(k); if (v) h.set(k, v); }
  return new NextResponse(up.body, { status: up.status, headers: h });
}
