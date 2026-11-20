import { NextResponse } from 'next/server';
import { requireAccount, noStore, isQa } from '@/lib/http';
import { loadProfile, updateProfile, scoreboard, writeSnapshotFromProfile } from '@/lib/profile';
import { media } from '@/lib/media';
import { getJSON } from '@/lib/r2';
import { space } from '@/lib/space';
import { isValidTz, localClock, ruleAt, RULES } from '@/lib/rules';
import { getAccount, saveAccount } from '@/lib/accounts';

export async function GET(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const [p, m, live] = await Promise.all([loadProfile(a, isQa(req)), media(), getJSON<{ at: string; inR2NotEmbedded: number; embeddedNotInR2: number; downloadedNotInR2: number | null; embedSpendTodayUsd: number; capUsd: number }>('radio/gaps.json').catch(() => null)]);
  const scout = await getJSON<{ at: string; acquiredThisWeek: number; budgetTracks: number; backcatalogueShare?: number; byDecadeThisWeek?: Record<string, number> }>('radio/scout-status.json').catch(() => null);
  const worker = await getJSON<{ url: string; at: string }>('radio/jobs/worker.json').catch(() => null);
  const lane = await getJSON<{ at: string; total: number; today: number; week: number; byTag: Record<string, number>; byDecade: Record<string, number>; artistsQueued: number; driveFreeGb: number }>('radio/lane-status.json').catch(() => null);
  const S = space();
  const now = new Date();
  const day = now.getTime() - 86400e3;
  return NextResponse.json({
    name: a.name, style: a.style, taste: p.taste ?? null, email: a.email ?? null, tz: p.tz, newShare: p.newShare, clock: localClock(now, p.tz), rule: ruleAt(now, p.tz).id, rules: RULES,
    score: scoreboard(p),
    counts: { likes: p.likes.length, plays: p.events.filter((e) => e.ev === 'play').length, today: p.events.filter((e) => e.ev === 'play' && e.ts > day).length },
    library: {
      songs: S.tracks.length, embedded: S.stats.embedded, inR2: S.stats.catalogue,
      gaps: live ? { inR2NotEmbedded: live.inR2NotEmbedded, embeddedNotInR2: live.embeddedNotInR2, downloadedNotInR2: live.downloadedNotInR2 } : S.stats.gaps,
      gapsAt: live?.at ?? S.generatedAt, spend: live ? { today: live.embedSpendTodayUsd, cap: live.capUsd } : null, aac: Object.values(m).filter((x) => x.aac).length, art: Object.values(m).filter((x) => x.art).length,
      mapAt: S.generatedAt,
      scout: scout ? { week: scout.acquiredThisWeek, budget: scout.budgetTracks, back: scout.backcatalogueShare ?? null, decades: scout.byDecadeThisWeek ?? null, at: scout.at } : null,
      workerAt: worker?.at ?? null,
      lane,
    },
  }, { headers: noStore });
}

export async function POST(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => ({}));
  if (typeof body.name === 'string' || body.style === 'home' || body.style === 'discovery') {
    const rec = await getAccount(a.id);
    if (rec) await saveAccount({ ...rec, ...(typeof body.name === 'string' && body.name.trim() ? { name: body.name.trim().slice(0, 24) } : {}), ...(body.style === 'home' || body.style === 'discovery' ? { style: body.style } : {}) });
  }
  if (typeof body.tz === 'string' && !isValidTz(body.tz)) return NextResponse.json({ error: 'unknown timezone' }, { status: 400 });
  const p = await updateProfile(a, isQa(req), (pr) => {
    if (typeof body.tz === 'string') pr.tz = body.tz;
    if (typeof body.newShare === 'number') pr.newShare = Math.min(1, Math.max(0, body.newShare));
    if (Array.isArray(body.taste)) pr.taste = body.taste.filter((x: unknown) => typeof x === 'string').slice(0, 6);
    if (typeof body.newShareDelta === 'number') pr.newShare = Math.min(1, Math.max(0, (pr.newShare ?? 0.6) + body.newShareDelta));
  });
  // tz / newShare changes must reach the snapshot too, or the next musicstore sync (which now
  // carries them forward from the existing snapshot) reverts them.
  await writeSnapshotFromProfile(p).catch(() => {});
  return NextResponse.json({ ok: true, tz: p.tz, newShare: p.newShare }, { headers: noStore });
}
