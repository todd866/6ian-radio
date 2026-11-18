import { NextResponse } from 'next/server';
import { requireAccount, noStore, isQa } from '@/lib/http';
import { buildQueue } from '@/lib/engine';
import { loadProfile } from '@/lib/profile';
import { media } from '@/lib/media';
import { present } from '@/lib/present';
import { space, refreshExtra } from '@/lib/space';
import { localClock } from '@/lib/rules';
import { playableFor, uaCanAlac } from '@/lib/playable';

export async function POST(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => ({}));
  const [profile, m] = await Promise.all([loadProfile(a, isQa(req)), media(typeof body.start === 'string' && !space().bySha.has(body.start))]);
  await refreshExtra();
  const S = space();
  const fresh = typeof body.start === 'string' && !S.bySha.has(body.start); // a song that just landed
  if (fresh) await refreshExtra(true);
  const lossless = !!body.lossless;
  const canAlac = typeof body.canAlac === 'boolean' ? body.canAlac : uaCanAlac(req.headers.get('user-agent') ?? '');
  const playable = playableFor(m, canAlac || lossless);
  void S;
  const now = new Date();
  const { picks, rule, mood } = buildQueue({ mood: body.mood, anchor: body.anchor, steer: body.steer, point: body.point, history: body.history, n: body.n, playable, tilt: body.tilt, start: body.start, era: body.era }, profile, now);
  return NextResponse.json({
    picks: picks.map((p) => present(p, a.id, a.style, mood.id, m)),
    mood: mood.id, rule: { id: rule.id, label: rule.label }, clock: localClock(now, profile.tz), tz: profile.tz,
    playable: playable.size,
  }, { headers: noStore });
}
