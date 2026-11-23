import { NextResponse } from 'next/server';
import { requireAccount, noStore } from '@/lib/http';
import { RATING_COOKIE, UPGRADE_SECONDS } from '@/lib/rating';

// Lift PG to M for UPGRADE_SECONDS (the session), or drop back to PG at once.
export async function POST(req: Request) {
  const a = await requireAccount(); // a browser session only: the rating is a cookie
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => ({}));
  const rating = body.rating === 'm' ? 'm' : 'pg';
  const res = NextResponse.json({ rating, until: rating === 'm' ? Date.now() + UPGRADE_SECONDS * 1000 : null }, { headers: noStore });
  if (rating === 'm') res.cookies.set(RATING_COOKIE, 'm', { httpOnly: true, secure: process.env.VERCEL === '1', sameSite: 'lax', path: '/', maxAge: UPGRADE_SECONDS });
  else res.cookies.delete(RATING_COOKIE);
  return res;
}
