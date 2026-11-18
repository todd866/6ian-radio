// Facts about a song, each from a named source and kept only when the match is sure; nothing
// LLM-written. Our records ("why this"), Apple's catalogue, MusicBrainz, Wikipedia's summary, LRCLIB.
// Cached in R2 under radio/info/. A listener can flag a fact as wrong: it is hidden and logged.
import crypto from 'node:crypto';
import { getJSON, putJSON } from './r2';

const UA = '6ian-radio/1.0 ( https://radio.example.com )';
const h = (id: string) => crypto.createHash('sha1').update(id).digest('hex');
const V = 3; // bump to drop cached answers made under looser matching

async function cached<T>(kind: string, id: string, ttlDays: number, make: () => Promise<T>): Promise<T> {
  const k = `radio/info/${kind}/v${V}-${h(id)}.json`;
  const hit = await getJSON<{ at: number; v: T }>(k).catch(() => null);
  if (hit && Date.now() - hit.at < ttlDays * 86400e3) return hit.v;
  const v = await make();
  await putJSON(k, { at: Date.now(), v }).catch(() => undefined);
  return v;
}

async function json(url: string) {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
}

// Same normalisation idea as the library's match_key: lower case, no accents, no "feat." or brackets.
export const norm = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/\s*[\(\[](feat|with|ft)\.?[^\)\]]*[\)\]]/g, '').replace(/\s*[\(\[][^\)\]]*(remaster|version|edit|mix)[^\)\]]*[\)\]]/g, '')
  .replace(/&/g, 'and').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
export const primary = (a: string) => a.split(/,| & | feat\.? | x /i)[0].trim();
const artistOk = (want: string, got: string) => { const a = norm(primary(want)), b = norm(got); return !!a && (b === a || b.startsWith(a + ' ') || b.includes(a)); };

export type Fact = { k: string; label: string; value: string; src: string; url?: string };
export type About = { facts: Fact[]; artist?: { summary: string; url: string; title: string } | null };

export async function about(artist: string, title: string, album: string, year: number | null): Promise<About> {
  const base = await cached('about', `${artist}|${title}|${album}`, 60, async () => {
    const facts: Fact[] = [];
    // Apple: only a result whose artist and title both match; album/label/genre from that release.
    try {
      const q = new URLSearchParams({ term: `${primary(artist)} ${title.replace(/\s*[\(\[].*$/, '')}`, entity: 'song', country: 'au', limit: '15' });
      const s = await json(`https://itunes.apple.com/search?${q}`);
      const hits = (s.results ?? []).filter((x: { artistName?: string; trackName?: string }) => artistOk(artist, x.artistName ?? '') && norm(x.trackName ?? '') === norm(title));
      const hit = hits.find((x: { collectionName?: string }) => album && norm(x.collectionName ?? '') === norm(album)) ?? (album ? null : hits[0]);
      if (hit) {
        const url = hit.collectionViewUrl ?? 'https://music.apple.com';
        facts.push({ k: 'album', label: 'Album', value: hit.collectionName, src: 'Apple', url });
        const al = await json(`https://itunes.apple.com/lookup?id=${hit.collectionId}&country=au`);
        const c = al.results?.[0]?.copyright as string | undefined;
        // Apple gives the release's copyright line, not a clean label name: show it as it is.
        if (c?.trim()) facts.push({ k: 'copyright', label: 'Copyright', value: c.trim(), src: 'Apple', url });
        if (hit.primaryGenreName) facts.push({ k: 'genre', label: 'Genre', value: hit.primaryGenreName, src: 'Apple', url });
      } else if (album) facts.push({ k: 'album', label: 'Album', value: album, src: 'Library' });
    } catch { if (album) facts.push({ k: 'album', label: 'Album', value: album, src: 'Library' }); }
    // MusicBrainz: credits from a recording whose title and artist match exactly (score >= 90).
    try {
      const esc = (x: string) => x.replace(/["\\]/g, ' ');
      const q = encodeURIComponent(`recording:"${esc(title.replace(/\s*[\(\[].*$/, ''))}" AND artist:"${esc(primary(artist))}"`);
      const s = await json(`https://musicbrainz.org/ws/2/recording?query=${q}&limit=10&fmt=json`);
      const rec = (s.recordings ?? []).find((r: { score: number; title: string; 'artist-credit'?: { name: string }[] }) =>
        r.score >= 90 && norm(r.title) === norm(title) && (r['artist-credit'] ?? []).some((ac) => artistOk(artist, ac.name)));
      if (rec) {
        await new Promise((r) => setTimeout(r, 1100)); // MusicBrainz asks for one request a second
        const full = await json(`https://musicbrainz.org/ws/2/recording/${rec.id}?inc=artist-credits+artist-rels&fmt=json`);
        const url = `https://musicbrainz.org/recording/${rec.id}`;
        const seen = new Set<string>();
        for (const ac of full['artist-credit'] ?? []) if (ac.name && !artistOk(artist, ac.name) && !seen.has(ac.name)) { seen.add(ac.name); facts.push({ k: `with:${ac.name}`, label: 'With', value: ac.name, src: 'MusicBrainz', url }); }
        for (const rel of full.relations ?? []) {
          const role = String(rel.type ?? '');
          if (rel.artist?.name && /producer|mix|engineer|vocal|instrument/.test(role)) {
            const label = role === 'instrument' && rel.attributes?.length ? rel.attributes.join(', ') : role[0].toUpperCase() + role.slice(1);
            facts.push({ k: `${role}:${rel.artist.name}`, label, value: rel.artist.name, src: 'MusicBrainz', url });
          }
        }
      }
    } catch { /* no credits rather than unsure ones */ }
    return { facts, artist: await artistSummary(primary(artist)) };
  });
  const facts = [...base.facts];
  if (year) facts.splice(facts.findIndex((f) => f.k === 'album') + 1, 0, { k: 'year', label: 'Released', value: String(year), src: 'MusicBrainz', url: 'https://musicbrainz.org' });
  return { ...base, facts };
}

// Wikipedia: the page must be titled the artist's name (optionally with a music disambiguator) and
// read as a music article; otherwise no bio.
async function artistSummary(name: string) {
  return cached('artist', name.toLowerCase(), 30, async () => {
    for (const t of [name, `${name} (band)`, `${name} (rapper)`, `${name} (musician)`, `${name} (group)`, `${name} (singer)`, `${name} (DJ)`]) {
      try {
        const s = await json(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(t.replace(/ /g, '_'))}`);
        const titleOk = norm(String(s.title ?? '').replace(/\s*\(.*\)$/, '')) === norm(name);
        if (s.type === 'standard' && titleOk && s.extract && /\b(rapper|singer|band|musician|record producer|DJ|hip hop|duo|group|songwriter|composer|electronic music|album)\b/i.test(s.extract)) {
          return { summary: s.extract as string, url: s.content_urls?.desktop?.page as string, title: s.title as string };
        }
      } catch { /* try the next title */ }
    }
    return null;
  });
}

export type Lyrics = { synced?: { t: number; line: string }[]; plain?: string; source?: string; url?: string; geniusUrl: string };

// LRCLIB: an exact get (artist, title, album, duration within 2 s); a search hit only when artist and
// title match and the length is within 3 s. Otherwise none, with a Genius search link.
export async function lyrics(artist: string, title: string, album: string, dur: number): Promise<Lyrics> {
  const geniusUrl = `https://genius.com/search?q=${encodeURIComponent(`${primary(artist)} ${title.replace(/\s*[\(\[].*$/, '')}`)}`;
  return cached('lyrics', `${artist}|${title}|${Math.round(dur)}`, 90, async () => {
    type L = { id?: number; artistName?: string; trackName?: string; duration?: number; syncedLyrics?: string; plainLyrics?: string; instrumental?: boolean };
    let r: L | null = null;
    const q = new URLSearchParams({ artist_name: primary(artist), track_name: title.replace(/\s*[\(\[]feat.*$/i, '').trim() });
    if (album) q.set('album_name', album);
    if (dur) q.set('duration', String(Math.round(dur)));
    try { r = await json(`https://lrclib.net/api/get?${q}`); } catch {
      try {
        const s = await json(`https://lrclib.net/api/search?${new URLSearchParams({ track_name: title.replace(/\s*[\(\[].*$/, ''), artist_name: primary(artist) })}`);
        r = (Array.isArray(s) ? (s as L[]) : []).filter((x) => artistOk(artist, x.artistName ?? '') && norm(x.trackName ?? '') === norm(title) && (!dur || Math.abs((x.duration ?? 0) - dur) <= 3))
          .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics))[0] ?? null;
      } catch { r = null; }
    }
    const out: Lyrics = { geniusUrl };
    if (!r || r.instrumental) return out;
    out.source = 'LRCLIB'; out.url = r.id ? `https://lrclib.net/api/get/${r.id}` : 'https://lrclib.net';
    if (r.syncedLyrics) {
      out.synced = r.syncedLyrics.split('\n').map((l) => {
        const m = /^\[(\d+):(\d+(?:\.\d+)?)\]\s?(.*)$/.exec(l.trim());
        return m ? { t: Number(m[1]) * 60 + Number(m[2]), line: m[3] } : null;
      }).filter((x): x is { t: number; line: string } => !!x);
    }
    if (r.plainLyrics) out.plain = r.plainLyrics;
    return out;
  });
}
