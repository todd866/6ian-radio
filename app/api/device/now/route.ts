import { NextResponse } from 'next/server';
import { requireAccountOrDevice, noStore, isQa } from '@/lib/http';
import { putJSON, listPage, getJSON } from '@/lib/r2';
import { nowKey, isLive, SURFACE_RE, HOST_RE, type NowDoc } from '@/lib/now-playing';

// The now-playing bus: each playing surface (browser tab, Glancebar, the TV) heartbeats its own
// small document every ~10 s; readers take the freshest live one. One writer per object, so a
// plain PUT is enough — no compare-and-swap path here.

type In = Partial<Record<'surface' | 'host' | 'sha' | 'key' | 'title' | 'artist' | 'at' | 'state', unknown>> & { position?: unknown; duration?: unknown; liked?: unknown };

export async function PUT(req: Request) {
  const a = await requireAccountOrDevice(req);
  if (a instanceof NextResponse) return a;
  if (isQa(req)) return NextResponse.json({ ok: true }, { headers: noStore }); // a silent QA run never touches the real bus
  const b = (await req.json().catch(() => ({}))) as In;
  const surface = typeof b.surface === 'string' ? b.surface : '';
  const host = typeof b.host === 'string' ? b.host.toLowerCase() : '';
  const at = typeof b.at === 'string' && Number.isFinite(Date.parse(b.at)) ? b.at : new Date().toISOString();
  if (!SURFACE_RE.test(surface) || !HOST_RE.test(host)) {
    return NextResponse.json({ error: 'bad surface or host' }, { status: 400, headers: noStore });
  }
  const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() ? v.slice(0, n) : undefined);
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined);
  const doc: NowDoc = {
    listener: a.id, surface: surface as NowDoc['surface'], host, at,
    sha: str(b.sha, 64), key: str(b.key, 200), title: str(b.title, 200), artist: str(b.artist, 200),
    position: num(b.position), duration: num(b.duration),
    ...(b.state === 'playing' || b.state === 'paused' ? { state: b.state } : {}),
    ...(typeof b.liked === 'boolean' ? { liked: b.liked } : {}),
    ...(a.via === 'device' && a.device ? { device: a.device } : {}),
  };
  await putJSON(nowKey(a.id, surface, host), doc);
  return NextResponse.json({ ok: true }, { headers: noStore });
}

export async function GET(req: Request) {
  const a = await requireAccountOrDevice(req);
  if (a instanceof NextResponse) return a;
  const now = Date.now();
  const keys = await listPage(`music/now/${a.id}/`);
  const docs = await Promise.all((keys.keys ?? []).map((k) => getJSON<NowDoc>(k)));
  const rows = docs.filter((d): d is NowDoc => !!d).map((d) => {
    const t = Date.parse(d.at);
    return Number.isFinite(t) ? { ...d, ageMs: now - t, live: isLive(d, now) } : { ...d, ageMs: null, live: false };
  });
  rows.sort((x, y) => (Number(x.live) - Number(y.live)) || ((x.ageMs ?? Infinity) - (y.ageMs ?? Infinity)));
  const live = rows.find((r) => r.live) ?? null; // `now` is a live surface or nothing: never a stale doc
  return NextResponse.json({ now: live, all: rows }, { headers: noStore });
}
