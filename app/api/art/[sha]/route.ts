import { NextResponse } from 'next/server';
import { requireAccount } from '@/lib/http';
import { space, refreshExtra } from '@/lib/space';
import { presign } from '@/lib/r2';
import { media } from '@/lib/media';
import { tunnelUrl, streamToken } from '@/lib/tunnel';

export async function GET(_req: Request, ctx: { params: Promise<{ sha: string }> }) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const { sha } = await ctx.params;
  await refreshExtra();
  const info = (await media())[sha];
  if (!space().bySha.has(sha) || !info?.art) return new NextResponse(null, { status: 404 });
  if (info.r2 === false) {
    const t = await tunnelUrl();
    const up = t ? await fetch(`${t}/art/${sha}.jpg?${streamToken(sha, a.id)}`, { signal: AbortSignal.timeout(10000) }).catch(() => null) : null;
    if (!up?.ok) return new NextResponse(null, { status: 404 });
    return new NextResponse(up.body, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=600' } });
  }
  const small = new URL(_req.url).searchParams.get('size') === '300' && info.thumb;
  return NextResponse.redirect(await presign(small ? `radio/thumb/${sha}.webp` : `radio/art/${sha}.jpg`, 6 * 3600, 3600), { status: 302, headers: { 'cache-control': 'private, max-age=1800' } });
}
