'use client';
// The player's audio graph. The music element plays through one AudioContext:
//   <audio> -> MediaElementSource -> music gain (ducking) -> master -> speakers
//   DJ reply buffers ------------------> reply gain -----------^
// The element is same-origin (/api/audio/...) so Web Audio can read it without bucket CORS.
// On iOS the music element is never routed into Web Audio, even with the mic on: a MediaElementSource is
// permanent for the element, and iOS suspends the context when Safari leaves the screen, so once voice had
// been used the music stopped in the background for the rest of the session (Ian, 21 Nov 2026). There the
// context carries only the mic and the DJ replies, and ducking falls back to the element volume (which iOS
// ignores: no duck, but the music never stops). Elsewhere the music joins the graph on first play.

export type Engine = ReturnType<typeof createEngine>;

const IOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

export function createEngine(el: HTMLAudioElement, silent: boolean) {
  if (silent) el.muted = true; // silent QA before the graph exists; the master gain is 0 after
  let ctx: AudioContext | null = null;
  let music: GainNode | null = null;
  let reply: GainNode | null = null;
  let master: GainNode | null = null;
  let current: AudioBufferSourceNode | null = null;
  let replyEl: HTMLAudioElement | null = null; // iOS with the mic off: replies on their own element
  let userPaused = true;
  let guard = false; // set while voice is live: an unexpected pause is resumed at once
  const gaps: number[] = [];
  let lastT = -1, lastAt = 0;

  function graph() {
    if (ctx) return ctx;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC({ latencyHint: 'playback' });
    reply = ctx.createGain(); master = ctx.createGain();
    master.gain.value = silent ? 0 : 1; // silent QA: the real graph runs, the output is zero
    master.connect(ctx.destination);
    reply.connect(master);
    if (!IOS) {
      music = ctx.createGain();
      ctx.createMediaElementSource(el).connect(music).connect(master);
    }
    // Never fight the system for the audio session. iOS 'interrupts' the context for keyboard dictation, Siri and
    // calls; resuming at once grabbed the session back and blocked dictation in every app while 6IAN was open
    // (Ian, 19 Nov 2026). A plain 'suspended' context (iOS backgrounding) is resumed while the music is meant to be
    // playing, including in the background: skipping that stopped background playback (Ian, 19 Nov 09:09).
    // (iOS: the music is not in this graph, so a suspended context there is left alone.)
    if (!IOS) ctx.onstatechange = () => { if (ctx?.state === 'suspended' && !userPaused) ctx.resume().catch(() => {}); };
    return ctx;
  }

  // Anything else that plays (the live stream) stops when the music starts: two streams at once
  // through a car or Bluetooth route is the garbling heard on CarPlay (19 Nov).
  const others = new Set<() => void>();
  el.addEventListener('play', () => { for (const f of others) f(); });
  // Never auto-resume after another app takes the audio session (an Instagram video, the Claude app's
  // voice input): on 21 Nov a resume when Safari reported the interruption over grabbed the session back
  // mid-recording and blocked transcription in the Claude app, as the context auto-resume did on 19 Nov.
  // After an interruption the listener presses play.
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
      // Safari's default session type 'auto' stops the music when 6IAN leaves the screen; 'playback' keeps
      // it going in the background and on the lock screen (19 Nov). It was only set after the mic had been
      // used, so a listener who never touched voice got foreground-only playback (21 Nov). The mic sets
      // 'play-and-record' while it is live; never override that here.
      const nav = navigator as unknown as { audioSession?: { type: string } };
      if (nav.audioSession && nav.audioSession.type !== 'play-and-record') nav.audioSession.type = 'playback';
      // Not on iOS (the music stays off the graph there). Elsewhere: build it now, so opening
      // the mic later never reroutes a playing song (that caused a stall in the voice tests).
      if (!IOS) this.ensure();
      return el.play();
    },
    pause() { userPaused = true; el.pause(); },
    get userPaused() { return userPaused; },
    setGuard(on: boolean) { guard = on; },
    duck(level: number, seconds = 0.25) {
      if (!ctx || !music) { if (!silent) el.volume = Math.max(0, Math.min(1, level)); return; }
      music.gain.cancelScheduledValues(ctx.currentTime);
      music.gain.setTargetAtTime(level, ctx.currentTime, seconds / 3);
    },
    async say(wav: ArrayBuffer): Promise<void> {
      if (IOS && !ctx) {
        // iOS, mic off: no context is needed just to speak a reply.
        this.stopReply();
        const r = new Audio(URL.createObjectURL(new Blob([wav], { type: 'audio/wav' })));
        r.setAttribute('playsinline', '');
        if (silent) r.muted = true;
        replyEl = r;
        return new Promise((done) => { const end = () => { if (replyEl === r) replyEl = null; URL.revokeObjectURL(r.src); done(); }; r.onended = end; r.onerror = end; r.play().catch(end); });
      }
      const c = this.ensure();
      const buf = await c.decodeAudioData(wav.slice(0));
      this.stopReply();
      const s = c.createBufferSource();
      s.buffer = buf; s.connect(reply!);
      current = s;
      return new Promise((done) => { s.onended = () => { if (current === s) current = null; done(); }; s.start(); });
    },
    stopReply() { try { current?.stop(); } catch {} current = null; if (replyEl) { replyEl.pause(); replyEl = null; } },
    get speaking() { return !!current || !!replyEl; },
    context() { return ctx; },
    onMusicPlay(f: () => void) { others.add(f); return () => others.delete(f); },
    gaps,
  };
}
