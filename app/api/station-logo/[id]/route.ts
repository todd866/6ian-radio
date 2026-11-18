import { NextResponse } from 'next/server';
import { requireAccount } from '@/lib/http';
import { presign } from '@/lib/r2';
import { stationById } from '@/lib/stations';

// Station logos (private app: tile art only).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const st = stationById((await ctx.params).id);
  if (!st?.logo) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(await presign(`radio/art/stations/${st.id}.png`, 6 * 3600, 3600), { status: 302, headers: { 'cache-control': 'private, max-age=1800' } });
}
