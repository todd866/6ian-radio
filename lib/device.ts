// Device principals (Glancebar on a Mac). A device token is scoped to one account, revocable,
// and stored only as its SHA-256 under radio/devices/. A device is NOT a browser session: it is
// accepted only where a route asks for requireAccountOrDevice (the device API, the queue, song
// info). Email links, claims, account changes, flags and pages take the session cookie only.
import { headers } from 'next/headers';
import { getAccount } from './accounts';
import type { Account } from './auth';

export type Principal = Account & { via: 'session' | 'device'; device?: string };

export { bearerToken, deviceKey, deviceOk, type DeviceRec } from './device-token';
import { bearerToken, deviceKey, deviceOk, type DeviceRec } from './device-token';

export async function currentDevice(): Promise<Principal | null> {
  const token = bearerToken((await headers()).get('authorization'));
  if (!token) return null;
  const { getJSON } = await import('./r2');
  const rec = await getJSON<DeviceRec>(deviceKey(token)).catch(() => null);
  if (!deviceOk(rec)) return null;
  const a = await getAccount(rec.account).catch(() => null);
  return a ? { id: a.id, name: a.name, style: a.style, via: 'device', device: rec.name } : null;
}
