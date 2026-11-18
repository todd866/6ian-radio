// The home worker worker's quick tunnel (trycloudflare.com). Its URL changes on every restart; the worker
// reports the current one to /api/worker/tunnel. Each request to it carries a fresh token,
// valid 60 s, bound to the song and the listener, signed with a key derived from WORKER_TOKEN.
import crypto from 'node:crypto';
import { getJSON } from './r2';

let cached: { at: number; url: string | null } | null = null;
export async function tunnelUrl(): Promise<string | null> {
  if (cached && Date.now() - cached.at < 15_000) return cached.url;
  const w = await getJSON<{ url: string; at: string }>('radio/jobs/worker.json').catch(() => null);
  cached = { at: Date.now(), url: w?.url && /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(w.url) ? w.url : null };
  return cached.url;
}

export function streamKey() {
  return crypto.createHmac('sha256', process.env.WORKER_TOKEN ?? '').update('6ian-stream-v1').digest();
}

export function streamToken(sha: string, user: string) {
  const exp = Math.floor(Date.now() / 1000) + 60;
  const sig = crypto.createHmac('sha256', streamKey()).update(`${sha}|${user}|${exp}`).digest('hex');
  return `u=${encodeURIComponent(user)}&exp=${exp}&sig=${sig}`;
}
