// Pure device-token helpers (no framework imports, so tests can load them).
import crypto from 'node:crypto';

export const TOKEN_RE = /^Bearer ([A-Za-z0-9_-]{32,128})$/;
export function bearerToken(header: string | null): string | null {
  const m = TOKEN_RE.exec(header ?? '');
  return m ? m[1] : null;
}
export const deviceKey = (token: string) => `radio/devices/${crypto.createHash('sha256').update(token).digest('hex')}.json`;

export type DeviceRec = { account: string; name: string; at: string; revoked?: boolean };
export function deviceOk(rec: DeviceRec | null): rec is DeviceRec {
  return !!rec && !rec.revoked && typeof rec.account === 'string' && !!rec.account;
}
