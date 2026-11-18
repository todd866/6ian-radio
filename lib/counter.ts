// Daily spend counters with an atomic reserve-before-call, on any store that offers a
// compare-and-swap (R2: ETag with If-Match / If-None-Match: *). Fails closed: any read error
// blocks; only a definite not-found starts a fresh day.

export type Usage = { day: string; n: Record<string, number> };
export type CasStore = {
  // null = definitely not found. Throws on any other failure.
  get(key: string): Promise<{ body: Usage; etag: string } | null>;
  // Writes only if the object still has `etag` (or does not exist when etag is null).
  // Returns false when the condition failed (someone else wrote first).
  putIf(key: string, body: Usage, etag: string | null): Promise<boolean>;
};

export class CapReached extends Error {}

export async function reserve(store: CasStore, key: string, field: string, cap: number, day: string, tries = 12): Promise<number> {
  for (let i = 0; i < tries; i++) {
    const cur = await store.get(key); // throws -> caller blocks (fail closed)
    const body: Usage = cur && cur.body.day === day ? { day, n: { ...cur.body.n } } : { day, n: {} };
    const used = body.n[field] ?? 0;
    if (used >= cap) throw new CapReached(`${field} cap ${cap} reached`);
    body.n[field] = used + 1;
    if (await store.putIf(key, body, cur ? cur.etag : null)) return used + 1;
    await new Promise((r) => setTimeout(r, 15 + Math.random() * 60 * (i + 1)));
  }
  throw new Error('counter busy'); // contention we could not resolve: block, never allow
}

// Give a reserved unit back after a failed provider call (best effort; over-count is acceptable).
export async function release(store: CasStore, key: string, field: string, day: string, tries = 6): Promise<void> {
  for (let i = 0; i < tries; i++) {
    const cur = await store.get(key).catch(() => null);
    if (!cur || cur.body.day !== day || !(cur.body.n[field] > 0)) return;
    const body: Usage = { day, n: { ...cur.body.n, [field]: cur.body.n[field] - 1 } };
    if (await store.putIf(key, body, cur.etag).catch(() => false)) return;
  }
}
