// Accounts: one per browser (anonymous, made when someone passes the site password), optionally
// linked to an email so it can be recovered on another device. Records live in R2:
//   radio/accounts/<id>.json   {id, name, style, email?, createdAt}
//   radio/emails/<sha>.json    {id}            email -> account (written once, never overwritten)
//   radio/tokens/<sha>.json    {email, acct, exp, used}   magic-link tokens (15 min, single use)
//   radio/claims/<sha>.json    {acct, used}    one-time codes to claim a migrated profile
import crypto from 'node:crypto';
import { capStore, getJSON, putJSON } from './r2';

export type Style = 'home' | 'discovery';
export type AccountRec = { id: string; name: string; style: Style; email?: string; createdAt: string; qa?: boolean };

const cache = new Map<string, { at: number; a: AccountRec | null }>();
export const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const normEmail = (e: string) => e.trim().toLowerCase();
const ID = /^(ian|mate|u[0-9a-f]{16})$/;

export async function getAccount(id: string): Promise<AccountRec | null> {
  if (!ID.test(id)) return null;
  const c = cache.get(id);
  if (c && Date.now() - c.at < 60_000) return c.a;
  const a = await getJSON<AccountRec>(`radio/accounts/${id}.json`);
  cache.set(id, { at: Date.now(), a });
  return a;
}

export async function saveAccount(a: AccountRec) {
  await putJSON(`radio/accounts/${a.id}.json`, a);
  cache.set(a.id, { at: Date.now(), a });
}

export async function createAccount(name: string, qa = false): Promise<AccountRec> {
  const a: AccountRec = {
    id: `u${crypto.randomBytes(8).toString('hex')}`,
    name: (name || 'Listener').trim().slice(0, 24) || 'Listener',
    style: 'discovery', // a new device starts wide, novelty up
    createdAt: new Date().toISOString(),
    ...(qa ? { qa: true } : {}),
  };
  await saveAccount(a);
  return a;
}

export async function accountForEmail(email: string): Promise<string | null> {
  const r = await getJSON<{ id: string }>(`radio/emails/${sha(normEmail(email))}.json`);
  return r?.id ?? null;
}

// Link an email to an account once: a second link to another account fails (If-None-Match: *).
export async function linkEmail(email: string, id: string): Promise<boolean> {
  return capStore.putIf(`radio/emails/${sha(normEmail(email))}.json`, { id } as never, null);
}

export async function newToken(email: string, acct: string): Promise<string> {
  const token = crypto.randomBytes(24).toString('base64url');
  await putJSON(`radio/tokens/${sha(token)}.json`, { email: normEmail(email), acct, exp: Date.now() + 15 * 60_000, used: false });
  return token;
}

export async function peekToken(token: string): Promise<{ email: string; acct: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const t = await getJSON<{ email: string; acct: string; exp: number; used: boolean }>(`radio/tokens/${sha(token)}.json`).catch(() => null);
  return t && !t.used && t.exp > Date.now() ? { email: t.email, acct: t.acct } : null;
}

// Single use: the token is marked used with a compare-and-swap, so two clicks can't both pass.
export async function consumeToken(token: string): Promise<{ email: string; acct: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const k = `radio/tokens/${sha(token)}.json`;
  const cur = await capStore.get(k);
  const t = cur?.body as unknown as { email: string; acct: string; exp: number; used: boolean } | undefined;
  if (!cur || !t || t.used || t.exp < Date.now()) return null;
  if (!(await capStore.putIf(k, { ...t, used: true } as never, cur.etag))) return null;
  return { email: t.email, acct: t.acct };
}

export async function consumeClaim(code: string): Promise<string | null> {
  const k = `radio/claims/${sha(code.trim().toLowerCase())}.json`;
  const cur = await capStore.get(k);
  const c = cur?.body as unknown as { acct: string; used: boolean } | undefined;
  if (!cur || !c || c.used) return null;
  if (!(await capStore.putIf(k, { ...c, used: true } as never, cur.etag))) return null;
  return c.acct;
}
