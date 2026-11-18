// "This is wrong" flags. Only the admin account hides a fact for everyone (cookie accounts are free
// to make, so a count of accounts proves nothing). Anyone else's flag hides it for that account
// alone and is logged for correction. Each account writes only its own doc, so nobody can fill a
// shared slot: the admin doc holds at most MAX_ADMIN fields, an account's doc at most MAX_OWN.
// QA sessions use a separate prefix. Keys must be ones the server emitted; writes are conditional.
export const ADMIN = 'ian';
export const MAX_ADMIN = 20;
export const MAX_OWN = 10;

export type FlagEntry = { value: string; at: string };
export type FlagDoc = { fields: Record<string, FlagEntry> };
export type Store = {
  get(key: string): Promise<{ body: unknown; etag: string } | null>;
  putIf(key: string, body: never, etag: string | null): Promise<boolean>;
};

export class FlagRejected extends Error {}

const root = (qa: boolean) => `radio/info/${qa ? 'flags-qa' : 'flags'}`;
// Only the admin/ prefix is ever read as global. (Docs at the bare flags/<sha>.json key, from the
// first version, are never read; none had been written when this changed, 18 Nov 2026.)
export const adminKey = (sha: string, qa: boolean) => `${root(qa)}/admin/${sha}.json`;
export const ownKey = (sha: string, account: string, qa: boolean) => `${root(qa)}/own/${sha}/${account.replace(/[^a-z0-9-]/gi, '_')}.json`;
export const keyFor = (sha: string, account: string, qa: boolean) => (account === ADMIN ? adminKey(sha, qa) : ownKey(sha, account, qa));

export async function readFlags(store: Store, key: string): Promise<FlagDoc> {
  const cur = await store.get(key);
  return (cur?.body as FlagDoc) ?? { fields: {} };
}

// Hidden for this account: the admin's flags plus its own.
export async function hiddenFor(store: Store, sha: string, account: string, qa: boolean): Promise<Set<string>> {
  const [g, own] = await Promise.all([
    readFlags(store, adminKey(sha, qa)).catch(() => ({ fields: {} }) as FlagDoc),
    account === ADMIN ? Promise.resolve({ fields: {} } as FlagDoc) : readFlags(store, ownKey(sha, account, qa)).catch(() => ({ fields: {} }) as FlagDoc),
  ]);
  return new Set([...Object.keys(g.fields), ...Object.keys(own.fields)]);
}

export async function addFlag(store: Store, sha: string, field: string, value: string, account: string, qa: boolean, allowed: Set<string>, tries = 30): Promise<FlagDoc> {
  if (!allowed.has(field)) throw new FlagRejected('unknown field');
  const key = keyFor(sha, account, qa);
  const cap = account === ADMIN ? MAX_ADMIN : MAX_OWN;
  for (let i = 0; i < tries; i++) {
    const cur = await store.get(key);
    const doc: FlagDoc = structuredClone((cur?.body as FlagDoc) ?? { fields: {} });
    if (doc.fields[field]) return doc;
    if (Object.keys(doc.fields).length >= cap) throw new FlagRejected('too many flagged fields');
    doc.fields[field] = { value: value.slice(0, 300), at: new Date().toISOString() };
    if (await store.putIf(key, doc as never, cur ? cur.etag : null)) return doc;
    await new Promise((r) => setTimeout(r, 10 + Math.random() * 60));
  }
  throw new Error('busy');
}
