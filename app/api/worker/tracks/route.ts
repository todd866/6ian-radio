import { NextResponse } from 'next/server';
import { capStore } from '@/lib/r2';
import { workerOk } from '@/lib/worker';

// The worker adds a fetched song (same record shape as data/space.json) and its media info.
// Compare-and-swap appends, so two jobs finishing together can't drop each other.
async function casUpdate<T>(key: string, empty: T, change: (cur: T) => T) {
  for (let i = 0; i < 30; i++) {
    const cur = await capStore.get(key);
    const next = change((cur?.body as unknown as T) ?? empty);
    if (await capStore.putIf(key, next as never, cur ? cur.etag : null)) return;
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 150));
  }
  throw new Error('busy');
}

export async function POST(req: Request) {
  if (!workerOk(req)) return new NextResponse(null, { status: 401 });
  const { track, media, medias } = await req.json().catch(() => ({}));
  if (Array.isArray(medias)) { // a batch of media flags (covers job)
    const ok = medias.filter((x) => x && typeof x.s === 'string' && /^[0-9a-f]{64}$/.test(x.s)).slice(0, 500);
    await casUpdate<Record<string, unknown>>('radio/media-extra.json', {}, (c) => {
      const n = { ...c };
      for (const { s, ...info } of ok) n[s] = { ...(n[s] as object ?? {}), ...info };
      return n;
    });
    return NextResponse.json({ ok: true, n: ok.length });
  }
  if (track && (typeof track.s !== 'string' || !/^[0-9a-f]{64}$/.test(track.s) || typeof track.v !== 'string')) return NextResponse.json({ error: 'bad track' }, { status: 400 });
  const sha: string = track?.s ?? media?.s;
  if (!sha || !/^[0-9a-f]{64}$/.test(sha)) return NextResponse.json({ error: 'bad sha' }, { status: 400 });
  if (track) await casUpdate<{ tracks: { s: string }[] }>('radio/extra.json', { tracks: [] }, (c) => ({ tracks: [...c.tracks.filter((t) => t.s !== sha), track] }));
  if (media) {
    const { s: _s, ...info } = media;
    void _s;
    await casUpdate<Record<string, unknown>>('radio/media-extra.json', {}, (c) => ({ ...c, [sha]: { ...(c[sha] as object ?? {}), ...info } }));
  }
  return NextResponse.json({ ok: true });
}
