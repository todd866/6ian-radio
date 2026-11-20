// Pure now-playing heartbeat (no framework imports, so tests load it directly).
// One PUT on the first beat of a track, one every intervalMs while playing (carrying fresh
// position), and one final PUT on stop. PUTs are fire-and-forget: at most one in flight,
// failures swallowed, no retry — a dead network must not queue or storm.
// `beat` may be called far more often than intervalMs (the audio element fires timeupdate
// ~4x/s): mid-track beats only refresh the position the next timer PUT carries.
export type Beat = {
  surface: 'browser' | 'mac' | 'tv';
  host: string;
  sha?: string;
  key?: string;
  title?: string;
  artist?: string;
  position?: number;
  duration?: number;
};

export type HeartbeatOpts = {
  put: (doc: Beat & { at: string }) => Promise<void>;
  intervalMs?: number;
  clock?: () => number;
  schedule?: (ms: number, fn: () => void) => () => void;
};

export function createHeartbeat({ put, intervalMs = 10_000, clock = Date.now, schedule = (ms, fn) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); } }: HeartbeatOpts) {
  let current: Beat | null = null;
  let lastSent = 0;
  let inFlight = false;
  let cancelled: (() => void) | null = null;
  let pending: { beat: Beat; final: boolean } | null = null;

  const send = async (beat: Beat, final: boolean) => {
    if (inFlight) { pending = { beat, final }; return; } // one slot: the newest beat wins
    inFlight = true;
    lastSent = clock(); // attempt time, success or not: a failed PUT is still not retried sooner
    try { await put({ ...beat, at: new Date(clock()).toISOString() }); } catch { /* silent */ }
    inFlight = false;
    const next = pending;
    pending = null;
    if (next && next.beat === current) void send(next.beat, next.final);
    else if (final && current === beat) current = null;
  };

  const arm = () => {
    if (!current) return;
    const wait = Math.max(1_000, lastSent + intervalMs - clock());
    cancelled?.();
    cancelled = schedule(wait, () => {
      if (current) { void send(current, false); arm(); }
    });
  };

  const api = {
    host: 'browser',
    beat(doc: Beat) {
      const prev = current;
      current = { ...doc, host: api.host };
      const sameTrack = !!prev && (prev.sha ?? prev.key) === (current.sha ?? current.key);
      // Send at once only for a new track or an elapsed interval; otherwise the timer's
      // next PUT carries the fresher position.
      if (!sameTrack || clock() - lastSent >= intervalMs) void send(current, false);
      arm();
    },
    stop() { if (current) { const d = current; cancelled?.(); cancelled = null; void send(d, true); } },
    async flush() { for (let i = 0; i < 10 && inFlight; i++) await new Promise((r) => setTimeout(r, 0)); },
  };
  return api;
}

export type Heartbeat = ReturnType<typeof createHeartbeat>;
