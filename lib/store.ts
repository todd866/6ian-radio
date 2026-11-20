// Unified music-core R2 store client (docs/music-unify.md):
//   - music/ids.json:   single alias table (embedMatchKey, apple, youtube, persistent -> sha)
//   - music/facts.json: single sourced song facts (MusicBrainz year, LRCLIB lyrics id, Wikipedia bio)
//   - music/taste/<listener>/<YYYY-MM>/6ian-vercel.jsonl: append-only event log (this app's own shard)
import crypto from 'node:crypto';

const PY_BRACKET_RE = /\[[^\]]*\]|\([^)]*\)/g;
const PY_REMASTERED_RE = /\s*-\s*remastered.*$/i;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SHA_RE = /^[0-9a-f]{64}$/;

function pyStrip(text: string): string {
  let t = String(text || '').toLowerCase();
  t = t.replace(PY_REMASTERED_RE, '').replace(PY_BRACKET_RE, '');
  t = t.replace(/[^\p{L}\p{N}_\s]/gu, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

// Exact mirror of music-core embed.match_key ("artist|title") and onto-the-tv embedMatchKey.
export function embedMatchKey(artist: string, title: string): string | null {
  let a = String(artist || '').toLowerCase();
  for (const needle of [',', '&', ' feat.', ' feat ', ' ft.', ' ft ']) {
    const idx = a.indexOf(needle);
    if (idx >= 0) a = a.slice(0, idx);
  }
  a = pyStrip(a);
  const t = pyStrip(title);
  return a && t ? `${a}|${t}` : null;
}

export type IdsDoc = {
  key?: Record<string, string>;
  apple?: Record<string, string>;
  youtube?: Record<string, string>;
  persistent?: Record<string, string>;
  isrc?: Record<string, string>;
};

export type SongFact = {
  year?: number | null;
  yearSource?: string | null;
  album?: string | null;
  lyrics?: { id?: number; synced?: boolean; plain?: boolean; instrumental?: boolean; source?: string; url?: string } | null;
  bio?: { title?: string; description?: string; url?: string; source?: string } | null;
  cover?: { art?: string | null; thumb?: string | null; source?: string } | null;
};

export type FactsDoc = { songs?: Record<string, SongFact> };

let idsCache: { doc: IdsDoc; at: number } | null = null;
let factsCache: { doc: FactsDoc; at: number } | null = null;

export async function loadIds(ttlMs = 5 * 60_000): Promise<IdsDoc | null> {
  if (idsCache && Date.now() - idsCache.at < ttlMs) return idsCache.doc;
  const { getJSON } = await import('./r2');
  const doc = await getJSON<IdsDoc>('music/ids.json').catch(() => null);
  if (doc) idsCache = { doc, at: Date.now() };
  return idsCache?.doc ?? null;
}

export async function loadFacts(ttlMs = 15 * 60_000): Promise<FactsDoc | null> {
  if (factsCache && Date.now() - factsCache.at < ttlMs) return factsCache.doc;
  const { getJSON } = await import('./r2');
  const doc = await getJSON<FactsDoc>('music/facts.json').catch(() => null);
  if (doc) factsCache = { doc, at: Date.now() };
  return factsCache?.doc ?? null;
}

export function cachedFact(sha: string): SongFact | null {
  return factsCache?.doc.songs?.[sha] ?? null;
}

export function resolveFromIds(ids: IdsDoc | null, q: { sha?: string; apple?: string; youtube?: string; persistent?: string; artist?: string; title?: string }): string | null {
  if (q.sha && SHA_RE.test(q.sha)) return q.sha;
  if (!ids) return null;
  if (q.apple && ids.apple?.[q.apple]) return ids.apple[q.apple];
  if (q.youtube && ids.youtube?.[q.youtube]) return ids.youtube[q.youtube];
  if (q.persistent && ids.persistent?.[q.persistent]) return ids.persistent[q.persistent];
  if (q.artist && q.title) {
    const k = embedMatchKey(q.artist, q.title);
    if (k && ids.key?.[k]) return ids.key[k];
  }
  return null;
}

export type TasteKind = 'play' | 'finish' | 'skip' | 'early-skip' | 'like' | 'unlike' | 'dislike' | 'undislike' | 'heart' | 'unheart' | 'more' | 'less';

export type TasteEvent = {
  at: string;
  listener: string;
  app: string;
  host: string;
  kind: TasteKind;
  sha?: string;
  alias?: string;
  fraction?: number;
  id: string;
};

// Exact mirror of musicstore.py event_id: sha1(listener|app|host|at|sha|alias|kind)[:20].
export function tasteEventId(ev: Omit<TasteEvent, 'id'>): string {
  const basis = [ev.listener, ev.app, ev.host, ev.at, ev.sha ?? '', ev.alias ?? '', ev.kind].join('|');
  return crypto.createHash('sha1').update(basis, 'utf8').digest('hex').slice(0, 20);
}

export function buildTasteEvent(listener: string, kind: TasteKind, sha: string, opts?: { ts?: number; fraction?: number; host?: string }): TasteEvent | null {
  if (!NAME_RE.test(listener) || !SHA_RE.test(sha)) return null;
  const at = new Date(opts?.ts ?? Date.now()).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const host = opts?.host ?? 'vercel';
  const base: Omit<TasteEvent, 'id'> = { at, listener, app: '6ian', host, kind, sha };
  if (typeof opts?.fraction === 'number' && Number.isFinite(opts.fraction)) {
    base.fraction = Math.round(Math.max(0, Math.min(1, opts.fraction)) * 10000) / 10000;
  }
  return { ...base, id: tasteEventId(base) };
}

export type TextCasStore = {
  get(key: string): Promise<{ text: string; etag: string } | null>;
  putIf(key: string, text: string, etag: string | null): Promise<boolean>;
};

export async function appendTasteEvent(ev: TasteEvent, store?: TextCasStore, tries = 12): Promise<boolean> {
  const s = store ?? (await import('./r2')).tasteStore;
  const month = ev.at.slice(0, 7);
  const key = `music/taste/${ev.listener}/${month}/${ev.app}-${ev.host}.jsonl`;
  const line = JSON.stringify(ev);
  for (let i = 0; i < tries; i++) {
    const cur = await s.get(key);
    const existing = cur?.text ?? '';
    if (existing.includes(`"id":"${ev.id}"`)) return true;
    const next = existing ? (existing.endsWith('\n') ? `${existing}${line}\n` : `${existing}\n${line}\n`) : `${line}\n`;
    if (await s.putIf(key, next, cur ? cur.etag : null)) return true;
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 80 * (i + 1)));
  }
  return false;
}
