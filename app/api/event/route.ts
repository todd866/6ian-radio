import { NextResponse } from 'next/server';
import { requireAccount, noStore, isQa } from '@/lib/http';
import { readPickToken } from '@/lib/auth';
import { applyEvent, updateProfile, writeSnapshotFromProfile, type Ev } from '@/lib/profile';
import { appendTasteEvent, buildTasteEvent, type TasteKind } from '@/lib/store';

const OK = new Set(['play', 'skip', 'like', 'unlike', 'finish', 'more', 'less', 'dislike', 'undislike']);

export async function POST(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => ({}));
  const pick = readPickToken(a.id, body.pt);
  if (!pick || !OK.has(body.ev)) return NextResponse.json({ error: 'bad event' }, { status: 400 });
  const ts = Date.now();
  const qa = isQa(req);
  const e: Ev = { ts, s: pick.s, ev: body.ev, m: pick.m, pos: typeof body.pos === 'number' ? Math.round(body.pos) : undefined };
  if (body.ev === 'play') { e.src = pick.src; e.nw = pick.nw; }
  const p = await updateProfile(a, qa, (pr) => applyEvent(pr, e));
  await writeSnapshotFromProfile(p);
  // Append real (non-QA) listener events to the unified music/taste/ store (docs/music-unify.md).
  if (!qa) {
    const kind: TasteKind = body.ev === 'skip' && typeof body.pos === 'number' && typeof body.dur === 'number' && body.dur > 0 && body.pos / body.dur < 0.4
      ? 'early-skip' : (body.ev as TasteKind);
    const fraction = typeof body.pos === 'number' && typeof body.dur === 'number' && body.dur > 0 ? body.pos / body.dur : undefined;
    const te = buildTasteEvent(a.id, kind, pick.s, { ts, fraction });
    if (te) await appendTasteEvent(te).catch(() => {});
  }
  return NextResponse.json({ ok: true, liked: p.likes.includes(pick.s) }, { headers: noStore });
}
