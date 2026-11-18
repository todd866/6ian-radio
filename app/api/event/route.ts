import { NextResponse } from 'next/server';
import { requireAccount, noStore, isQa } from '@/lib/http';
import { readPickToken } from '@/lib/auth';
import { applyEvent, updateProfile, type Ev } from '@/lib/profile';

const OK = new Set(['play', 'skip', 'like', 'unlike', 'finish', 'more', 'less']);

export async function POST(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => ({}));
  const pick = readPickToken(a.id, body.pt);
  if (!pick || !OK.has(body.ev)) return NextResponse.json({ error: 'bad event' }, { status: 400 });
  const e: Ev = { ts: Date.now(), s: pick.s, ev: body.ev, m: pick.m, pos: typeof body.pos === 'number' ? Math.round(body.pos) : undefined };
  if (body.ev === 'play') { e.src = pick.src; e.nw = pick.nw; }
  const p = await updateProfile(a, isQa(req), (pr) => applyEvent(pr, e));
  return NextResponse.json({ ok: true, liked: p.likes.includes(pick.s) }, { headers: noStore });
}
