import { NextResponse } from 'next/server';
import { requireAccount, noStore, isQa } from '@/lib/http';
import { space, refreshExtra, dot } from '@/lib/space';
import { stations } from '@/lib/stations';
import { loadProfile } from '@/lib/profile';
import { media } from '@/lib/media';
import { about, lyrics } from '@/lib/info';
import { capStore } from '@/lib/r2';
import { addFlag, hiddenFor, FlagRejected } from '@/lib/flags';
import { reserveCall, reserveIpFlag, clientIp, CapReached } from '@/lib/voicecap';
import type { Track } from '@/lib/space';
import type { Account } from '@/lib/auth';

const day = (iso?: string) => (iso ? new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const GROUP: Record<string, string> = { core: 'Wu-Tang & the core', golden: 'golden era', 'south-west': 'South & West', underground: 'underground', modern: "modern heads' picks", aus: 'Australian' };

// Why this / About / Lyrics for one song. Facts only: our records, Apple's catalogue, MusicBrainz,
// Wikipedia's summary (linked), LRCLIB.
export async function GET(req: Request, ctx: { params: Promise<{ sha: string }> }) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  await refreshExtra();
  const { sha } = await ctx.params;
  const S = space();
  const i = S.bySha.get(sha);
  if (i === undefined) return new NextResponse(null, { status: 404 });
  const t = S.tracks[i];
  const kind = new URL(req.url).searchParams.get('kind');

  const qa = isQa(req);
  const hidden = await hiddenFor(capStore, sha, a.id, qa);
  if (kind === 'about') {
    const ab = await about(t.a, t.t, t.al, t.y);
    return NextResponse.json({ facts: ab.facts.filter((f) => !hidden.has(f.k)), artist: hidden.has('bio') ? null : ab.artist }, { headers: noStore });
  }
  if (kind === 'lyrics') {
    if (hidden.has('lyrics')) return NextResponse.json({ geniusUrl: `https://genius.com/search?q=${encodeURIComponent(`${t.a} ${t.t}`)}`, flagged: true }, { headers: noStore });
    return NextResponse.json(await lyrics(t.a, t.t, t.al, (await media())[sha]?.dur ?? 0), { headers: noStore });
  }
  const rows = await whyRows(t, sha, i, a, qa);
  return NextResponse.json({ rows: rows.filter((r) => !hidden.has(r.k)) }, { headers: noStore });
}

// The facts the server shows for this song; only these keys can be flagged.
async function emittedKeys(t: Track, sha: string, i: number, a: Account, qa: boolean): Promise<Set<string>> {
  const ab = await about(t.a, t.t, t.al, t.y);
  const keys = new Set<string>([...ab.facts.map((f) => f.k), ...(await whyRows(t, sha, i, a, qa)).map((r) => r.k), 'lyrics']);
  if (ab.artist) keys.add('bio');
  return keys;
}

async function whyRows(t: Track, sha: string, i: number, a: Account, qa: boolean) {
  const S = space();
  const rows: { k: string; label: string; value: string; src: string }[] = [];
  const push = (label: string, value: string, src = '6IAN') => rows.push({ k: `why:${label}:${value}`, label, value, src });
  const sc = (t.sc ?? {}) as { src?: string; seed?: string; group?: string; why?: string; at?: string };
  const src = sc.src ?? '';
  if (src === 'hiphop') push('Came in with', `Hip hop batch${sc.group ? ` (${GROUP[sc.group] ?? sc.group})` : ''}${sc.seed ? `: ${sc.seed} seed` : ''}`);
  else if (src.startsWith('station:')) push('Came in with', `${stations().find((x) => x.id === src.slice(8))?.name ?? src.slice(8)}'s most-played${sc.why ? ` (${sc.why})` : ''}`);
  else if (src === 'radio') push('Came in with', `Played on several stations${sc.why ? `: ${sc.why}` : ''}`);
  else if (src === 'related') push('Came in with', `Related artists of songs you like${sc.seed ? ` (${sc.seed})` : ''}`);
  else if (src.startsWith('decade:') || src.startsWith('genre:')) push('Came in with', `Filling out ${src.startsWith('decade:') ? `the ${src.slice(9, 11)}s` : src.slice(6)}${sc.seed ? ` (${sc.seed})` : ''}`);
  else if (src === 'request') push('Came in with', 'Fetched when someone asked for it');
  else if (src) push('Came in with', src === 'triplej' ? 'The scout: triple j' : src === 'shazam' ? 'A Shazam' : `The scout (${src})`);
  else push('Came in with', t.f ? "Ian's library (a favourite)" : "Ian's library");
  if (sc.at) push('Added', day(sc.at));
  if (t.p) push('Plays (Ian)', String(t.p), 'Library');
  if (t.gl) push('Liked', 'in Glancebar', 'Glancebar');
  for (const st of stations()) if (st.played[sha]) push(st.name, `played ${day(st.played[sha])}`, 'Station playlist');
  const p = await loadProfile(a, qa);
  const likes = [...new Set([...(p.likes ?? []), ...(a.style === 'home' ? S.tracks.filter((x) => x.gl).map((x) => x.s) : [])])]
    .filter((s) => s !== sha && S.bySha.has(s)).map((s) => [s, dot(S.vec[S.bySha.get(s)!], S.vec[i])] as const)
    .filter(([, d]) => d > 0.8).sort((x, y) => y[1] - x[1]).slice(0, 3);
  for (const [s] of likes) { const x = S.tracks[S.bySha.get(s)!]; push('Near your like', `${x.a} – ${x.t}`, 'Map'); }
  push('On the map', S.clusterName[t.c] ?? '', 'Map');
  return rows;
}

// "This is wrong": hides the fact for this account; for everyone only when the admin flags it.
// QA flags go to a separate store. 30 a day per account and 60 per IP.
export async function POST(req: Request, ctx: { params: Promise<{ sha: string }> }) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  await refreshExtra();
  const { sha } = await ctx.params;
  const S = space();
  const i = S.bySha.get(sha);
  const b = (await req.json().catch(() => ({}))) as { field?: unknown; value?: unknown };
  if (i === undefined || typeof b.field !== 'string' || b.field.length > 200) return new NextResponse(null, { status: 400 });
  const qa = isQa(req);
  const allowed = await emittedKeys(S.tracks[i], sha, i, a, qa);
  if (!allowed.has(b.field)) return NextResponse.json({ error: 'unknown field' }, { status: 400 });
  let undo: (() => Promise<unknown>) | undefined;
  try { await reserveIpFlag(clientIp(req)); undo = (await reserveCall(qa ? `${a.id}-qa` : a.id, 'flag')).undo; } catch (e) {
    if (e instanceof CapReached) return NextResponse.json({ error: 'flag limit reached for today' }, { status: 429 });
    throw e;
  }
  try {
    await addFlag(capStore, sha, b.field, String(b.value ?? ''), a.id, qa, allowed);
  } catch (e) {
    await undo?.().catch(() => undefined);
    if (e instanceof FlagRejected) return NextResponse.json({ error: e.message }, { status: 400 });
    return NextResponse.json({ error: 'busy' }, { status: 503 });
  }
  return NextResponse.json({ ok: true }, { headers: noStore });
}
