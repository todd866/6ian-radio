import { NextResponse } from 'next/server';
import { requireAccount } from '@/lib/http';
import { space, refreshExtra } from '@/lib/space';
import { presign } from '@/lib/r2';
import { media } from '@/lib/media';
import { audioKey } from '@/lib/audiokey';

// Session check, then a short-lived signed URL to R2. AAC by default; the master on request.
export async function GET(req: Request, ctx: { params: Promise<{ sha: string }> }) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const { sha } = await ctx.params;
  await refreshExtra();
  const S = space();
  const i = S.bySha.get(sha);
  if (i === undefined) return NextResponse.json({ error: 'unknown song' }, { status: 404 });
  const q = new URL(req.url).searchParams.get('q');
  // AAC unless the master is asked for, or the AAC tier has not reached this song yet.
  const key = audioKey(sha, S.tracks[i].key, !!(await media())[sha]?.aac, q);
  if (!key) return NextResponse.json({ error: 'no audio for this song yet' }, { status: 404 });
  return NextResponse.redirect(await presign(key, 3 * 3600), { status: 302, headers: { 'cache-control': 'private, no-store' } });
}
