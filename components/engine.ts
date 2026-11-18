'use client';
// The player's audio graph. The music element plays through one AudioContext:
//   <audio> -> MediaElementSource -> music gain (ducking) -> master -> speakers
//   DJ reply buffers ------------------> reply gain -----------^
// The element is same-origin (/api/audio/...) so Web Audio can read it without bucket CORS.
// On iOS the graph is built only when the mic is turned on (so lock-screen playback keeps working);
// elsewhere it is built on first play. Once built it stays for the session.

export type Engine = ReturnType<typeof createEngine>;

const IOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

export function createEngine(el: HTMLAudioElement, silent: boolean) {
  if (silent) el.muted = true; // silent QA before the graph exists; the master gain is 0 after
  let ctx: AudioContext | null = null;
  let music: GainNode | null = null;
  let reply: GainNode | null = null;
  let master: GainNode | null = null;
  let current: AudioBufferSourceNode | null = null;
  let userPaused = true;
  let guard = false; // set while voice is live: an unexpected pause is resumed at once
  const gaps: number[] = [];
  let lastT = -1, lastAt = 0;

  function graph() {
    if (ctx) return ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: 'playback' });
    const src = ctx.createMediaElementSource(el);
    music = ctx.createGain(); reply = ctx.createGain(); master = ctx.createGain();
    master.gain.value = silent ? 0 : 1; // silent QA: the real graph runs, the output is zero
    src.connect(music).connect(master).connect(ctx.destination);
    reply.connect(master);
    ctx.onstatechange = () => { if (ctx?.state === 'suspended' || (ctx?.state as string) === 'interrupted') ctx?.resume().catch(() => {}); };
    return ctx;
  }

  el.addEventListener('pause', () => {
    if (!userPaused && guard && !el.ended) el.play().catch(() => {});
  });
  el.addEventListener('timeupdate', () => {
    const now = performance.now();
    if (!el.paused && lastT >= 0 && el.currentTime > lastT) gaps.push(now - lastAt);
    lastT = el.currentTime; lastAt = now;
  });

  return {
    el,
    ensure() { const c = graph(); if (c.state !== 'running') c.resume().catch(() => {}); return c; },
    play() {
      userPaused = false;
      // iOS: the graph waits for the mic (lock-screen playback). Elsewhere: build it now, so opening
      // the mic later never reroutes a playing song (that caused a stall in the voice tests).
      if (!IOS) this.ensure(); else if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
      return el.play();
    },
    pause() { userPaused = true; el.pause(); },
    get userPaused() { return userPaused; },
    setGuard(on: boolean) { guard = on; },
    duck(level: number, seconds = 0.25) {
      if (!ctx || !music) return;
      music.gain.cancelScheduledValues(ctx.currentTime);
      music.gain.setTargetAtTime(level, ctx.currentTime, seconds / 3);
    },
    async say(wav: ArrayBuffer): Promise<void> {
      const c = this.ensure();
      const buf = await c.decodeAudioData(wav.slice(0));
      this.stopReply();
      const s = c.createBufferSource();
      s.buffer = buf; s.connect(reply!);
      current = s;
      return new Promise((done) => { s.onended = () => { if (current === s) current = null; done(); }; s.start(); });
    },
    stopReply() { try { current?.stop(); } catch {} current = null; },
    get speaking() { return !!current; },
    context() { return ctx; },
    gaps,
  };
}
