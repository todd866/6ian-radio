import { NextResponse } from 'next/server';
import { requireAccountOrDevice, noStore, isQa } from '@/lib/http';
import { applyEvent, updateProfile, writeSnapshotFromProfile, type Ev } from '@/lib/profile';
import { appendTasteEvent, buildTasteEvent } from '@/lib/store';
import { shaFor } from '@/lib/match';

// Taste from another player (Glancebar): likes, dislikes, skips, plays and finishes, named by
// artist and title. They land in the same profile the radio uses. Unmatched songs are counted
// and returned so the device can log them; nothing is guessed.
const OK = new Set(['play', 'skip', 'like', 'unlike', 'finish', 'dislike', 'undislike']);
type In = { ev?: unknown; s?: unknown; sha?: unknown; artist?: unknown; title?: unknown; at?: unknown };

export async function POST(req: Request) {
  const a = await requireAccountOrDevice(req);
  if (a instanceof NextResponse) return a;
  const body = (await req.json().catch(() => ({}))) as { events?: In[]; via?: unknown };
  const via = a.via === 'device' ? (a.device ?? 'device') : 'session';
  const list = Array.isArray(body.events) ? body.events.slice(0, 500) : [];
  const evs: Ev[] = [];
  const unmatched: { artist: string; title: string }[] = [];
  for (const x of list) {
    if (typeof x.ev !== 'string' || !OK.has(x.ev)) continue;
    const hint = [x.s, x.sha].find((v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v as string)); // NowDoc names it sha
    const shaHint = hint as string | undefined;
    const artist = typeof x.artist === 'string' ? x.artist : '';
    const title = typeof x.title === 'string' ? x.title : '';
    if (!shaHint && (!artist || !title)) continue;
    const s = await shaFor(artist, title, shaHint ? { sha: shaHint } : undefined);
    if (!s) { unmatched.push({ artist: artist.slice(0, 120), title: title.slice(0, 160) }); continue; }
    const ts = typeof x.at === 'number' && x.at > 1.6e12 && x.at < Date.now() + 60e3 ? x.at : Date.now();
    evs.push({ ts, s, ev: x.ev as Ev['ev'], via });
  }
  evs.sort((p, q) => p.ts - q.ts);
  const qa = isQa(req);
  if (evs.length) {
    const p = await updateProfile(a, qa, (pr) => { for (const e of evs) applyEvent(pr, e); });
    await writeSnapshotFromProfile(p);
    // The device does not keep its own taste log, so this IS its logger: without the append,
    // the next musicstore sync rebuilds the snapshot from the log and these events vanish.
    if (!qa) for (const e of evs) {
      const te = buildTasteEvent(a.id, e.ev, e.s, { ts: e.ts, host: a.via === 'device' ? (a.device ?? 'device') : 'vercel' });
      if (te) await appendTasteEvent(te).catch(() => {});
    }
  }
  return NextResponse.json({ applied: evs.length, unmatched }, { headers: noStore });
}
