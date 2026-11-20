import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { getAccount, type Style } from './accounts';

// One shared site password (SITE_PASSWORD) is the gate; past it, each browser has its own
// account, held in a signed httpOnly cookie. Email magic links recover an account elsewhere.
export type Account = { id: string; name: string; style: Style; email?: string };

const COOKIE = 'mr_session';
const MAX_AGE = 60 * 60 * 24 * 400; // about 13 months (the browser maximum)

function secret() {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) throw new Error('AUTH_SECRET missing');
  return s;
}

export function hmac(data: string) {
  return crypto.createHmac('sha256', secret()).update(data).digest('base64url');
}

export function sitePasswordOk(pass: string): boolean {
  const want = process.env.SITE_PASSWORD ?? '';
  if (!want) return false;
  const a = crypto.createHash('sha256').update(pass).digest();
  const b = crypto.createHash('sha256').update(want).digest();
  return crypto.timingSafeEqual(a, b);
}

export function sessionValue(id: string) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const body = `${id}.${exp}`;
  return `${body}.${hmac(body)}`;
}

export async function setSession(id: string) {
  (await cookies()).set(COOKIE, sessionValue(id), { httpOnly: true, secure: process.env.VERCEL === '1', sameSite: 'lax', path: '/', maxAge: MAX_AGE });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export async function sessionId(): Promise<string | null> {
  const v = (await cookies()).get(COOKIE)?.value;
  if (!v) return null;
  const [id, exp, sig] = v.split('.');
  if (!id || !exp || !sig) return null;
  const want = hmac(`${id}.${exp}`);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  if (Number(exp) < Date.now() / 1000) return null;
  return id;
}

export async function currentAccount(): Promise<Account | null> {
  const id = await sessionId(); // the session cookie only (lib/device.ts is separate and opt-in)
  if (!id) return null;
  const a = await getAccount(id).catch(() => null);
  return a ? { id: a.id, name: a.name, style: a.style, email: a.email } : null;
}

// Opaque per-pick token: the client sends it back with play/skip/like so the server knows
// whether the pick was the AI's or the random control, without the client ever seeing it.
export function pickToken(user: string, sha: string, src: string, nw: number, mood: string) {
  const body = Buffer.from(JSON.stringify({ u: user, s: sha, src, nw, m: mood })).toString('base64url');
  return `${body}.${hmac(body).slice(0, 22)}`;
}

export function readPickToken(user: string, token: string | undefined) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || hmac(body).slice(0, 22) !== sig) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { u: string; s: string; src: 'ai' | 'control'; nw: number; m: string };
  return p.u === user ? p : null;
}
