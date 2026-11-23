// Pure now-playing helpers (no framework imports, so tests load them directly).
// Every playing surface writes one small document under
//   music/now/<listener>/<surface>-<host>.json
// and refreshes it roughly every 10 s; anything older than NOW_LIVE_MS is stale.
export type Surface = 'browser' | 'mac' | 'tv';

export type NowDoc = {
  listener: string;
  surface: Surface;
  host: string;
  sha?: string;
  key?: string;
  title?: string;
  artist?: string;
  at: string; // ISO timestamp of this heartbeat
  position?: number;
  duration?: number;
  device?: string;
  state?: 'playing' | 'paused'; // the Mac bridge says which, so the phone remote shows the right button
  liked?: boolean;
};

export const NOW_LIVE_MS = 60_000;

export const SURFACE_RE = /^(browser|mac|tv)$/;
export const HOST_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;

export const nowKey = (listener: string, surface: string, host: string) => `music/now/${listener}/${surface}-${host}.json`;

export const isLive = (d: Pick<NowDoc, 'at'>, now = Date.now()) => {
  const t = Date.parse(d.at);
  return Number.isFinite(t) && now - t < NOW_LIVE_MS && t < now + 60_000; // a future stamp is not live either
};
