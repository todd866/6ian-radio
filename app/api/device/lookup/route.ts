import { NextResponse } from 'next/server';
import { requireAccountOrDevice, noStore } from '@/lib/http';
import { shaFor } from '@/lib/match';

// Artist + title -> the song's id on the map (then /api/info/<id> for its sourced facts).
export async function GET(req: Request) {
  const a = await requireAccountOrDevice(req);
  if (a instanceof NextResponse) return a;
  const u = new URL(req.url);
  const s = await shaFor(u.searchParams.get('artist') ?? '', u.searchParams.get('title') ?? '');
  return s ? NextResponse.json({ s }, { headers: noStore }) : NextResponse.json({ s: null }, { status: 404, headers: noStore });
}
