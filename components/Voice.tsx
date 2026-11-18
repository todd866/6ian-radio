'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Engine } from './engine';
import { Icon } from './Icon';
import { qaHeaders } from './Radio';

const WORKLET = `class C extends AudioWorkletProcessor{constructor(){super();this.b=[];this.n=0}process(i){const c=i[0]&&i[0][0];if(c){this.b.push(new Float32Array(c));this.n+=c.length;if(this.n>=2048){const o=new Float32Array(this.n);let k=0;for(const x of this.b){o.set(x,k);k+=x.length}this.port.postMessage(o,[o.buffer]);this.b=[];this.n=0}}return true}}registerProcessor('radio-capture',C)`;
let workletUrl: string | null = null;

export type VoiceResult = { heard: string; intent: string; mood?: string; query?: string; era?: { from: number; to: number } | null; found?: { s: string; a: string; t: string }[]; job?: string | null; reply: string; ms?: number };
type State = 'off' | 'starting' | 'listening' | 'hearing' | 'thinking' | 'speaking' | 'denied' | 'lost' | 'error';

const LABEL: Record<State, string> = {
  off: 'Voice off', starting: 'Opening mic…', listening: 'Listening', hearing: 'Hearing you', thinking: 'Thinking',
  speaking: 'DJ', denied: 'Mic blocked: type instead', lost: 'Mic lost: reconnecting', error: 'Voice error: tap to retry',
};

// One mic stream for the whole session (echo cancellation on, so the music doesn't trigger it),
// a simple energy VAD, 16 kHz WAV utterances to /api/voice, ducking while you talk and while the
// DJ answers, barge-in, automatic reconnect, and a text box that always works.
export function useVoice({ engine, cur, onResult }: { engine: () => Engine | null; cur?: string; onResult: (r: VoiceResult) => void | Promise<void> }) {
  const [state, setState] = useState<State>('off');
  const [heard, setHeard] = useState('');
  const stream = useRef<MediaStream | null>(null);
  const proc = useRef<ScriptProcessorNode | null>(null);
  const live = useRef(false);
  const stateRef = useRef<State>('off');
  const curRef = useRef(cur);
  curRef.current = cur;
  const set = (s: State) => { stateRef.current = s; setState(s); (window as unknown as { __voiceState: string }).__voiceState = s; };

  const send = useCallback(async (body: { audio?: string; text?: string }) => {
    const e = engine();
    const endAt = performance.now();
    set('thinking');
    try {
      const r = await fetch('/api/voice', { method: 'POST', headers: { 'content-type': 'application/json', ...qaHeaders() }, body: JSON.stringify({ ...body, cur: curRef.current }) });
      const j = await r.json();
      if (!r.ok) { setHeard(j.message ?? 'Voice failed'); set(live.current ? 'listening' : 'off'); e?.duck(1); return; }
      setHeard(j.heard ? `“${j.heard}”` : '');
      const w = window as unknown as { __voiceLog?: unknown[] };
      const entry = { ...j, heardMs: Math.round(performance.now() - endAt), appliedMs: 0 };
      if (j.intent !== 'none') await onResult(j);
      entry.appliedMs = Math.round(performance.now() - endAt);
      (w.__voiceLog ??= []).push(entry);
      if (j.reply && e) {
        set('speaking');
        e.duck(0.3);
        const wav = await fetch('/api/voice/say', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: j.reply }) });
        if (wav.ok && stateRef.current === 'speaking') await e.say(await wav.arrayBuffer());
      }
    } catch {
      setHeard('Could not reach the station. Try again.');
    }
    e?.duck(1, 0.6);
    set(live.current ? 'listening' : 'off');
  }, [engine, onResult]);

  const start = useCallback(async () => {
    const e = engine();
    if (!e) return;
    set('starting');
    const ctx = e.ensure();
    try {
      const nav = navigator as unknown as { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'play-and-record'; // Safari: keep the music on the speaker
      const ms = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      stream.current = ms;
      e.setGuard(true);
      if (!e.userPaused && e.el.paused) e.el.play().catch(() => {});
      const src = ctx.createMediaStreamSource(ms);
      const sink = ctx.createGain(); sink.gain.value = 0;
      sink.connect(ctx.destination);
      const rate = ctx.sampleRate;
      let floor = 0.01, above = 0, below = 0, speaking = false;
      let chunks: Float32Array[] = [];
      const pre: Float32Array[] = [];
      // VAD over blocks of about 2048 samples.
      const onBlock = (x: Float32Array) => {
        if (!live.current) return;
        const block = x.length / rate;
        let sum = 0; for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
        const rms = Math.sqrt(sum / x.length);
        const busy = stateRef.current === 'thinking';
        const thr = Math.max(0.012, floor * 3);
        if (!speaking) {
          pre.push(x); if (pre.length > Math.ceil(0.35 / block)) pre.shift();
          if (rms > thr && !busy) {
            if (++above >= 2) {
              speaking = true; below = 0; chunks = [...pre];
              if (e.speaking) e.stopReply(); // barge-in
              e.duck(0.3); set('hearing');
            }
          } else { above = 0; floor = 0.97 * floor + 0.03 * Math.min(rms, 0.05); }
        } else {
          chunks.push(x);
          below = rms < thr ? below + 1 : 0;
          const len = chunks.reduce((n, c) => n + c.length, 0) / rate;
          if (below * block > 0.55 || len > 6) {
            speaking = false; above = 0;
            if (len > 0.45) { const w = wavB64(chunks, rate); if (location.search.includes('silent')) (window as unknown as { __lastWav?: string }).__lastWav = w; send({ audio: w }); }
            else { e.duck(1); set('listening'); }
            chunks = [];
          }
        }
      };
      // Capture on the audio thread (AudioWorklet): a busy page can delay these messages but never
      // drops samples, unlike ScriptProcessor, whose callback runs on the main thread.
      if (ctx.audioWorklet) {
        if (!workletUrl) workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
        await ctx.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(ctx, 'radio-capture');
        node.port.onmessage = (ev) => onBlock(ev.data as Float32Array);
        src.connect(node); node.connect(sink);
        proc.current = node as unknown as ScriptProcessorNode;
      } else {
        const p = ctx.createScriptProcessor(2048, 1, 1);
        p.onaudioprocess = (ev) => onBlock(new Float32Array(ev.inputBuffer.getChannelData(0)));
        src.connect(p); p.connect(sink);
        proc.current = p;
      }
      ms.getAudioTracks()[0].onended = () => { if (live.current) { set('lost'); setTimeout(() => { stop(false); live.current = true; start(); }, 1000); } };
      live.current = true;
      set('listening');
    } catch (err) {
      live.current = false;
      e.setGuard(false);
      set((err as Error)?.name === 'NotAllowedError' ? 'denied' : 'error');
    }
  }, [engine, send]); // eslint-disable-line react-hooks/exhaustive-deps

  const stop = useCallback((final = true) => {
    live.current = false;
    proc.current?.disconnect(); proc.current = null;
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    const e = engine();
    e?.duck(1);
    if (final) { e?.setGuard(false); set('off'); }
  }, [engine]);

  const stopRef = useRef(stop);
  stopRef.current = stop;
  useEffect(() => () => stopRef.current(), []); // on unmount only

  const on = state !== 'off' && state !== 'denied' && state !== 'error';
  return { state, label: LABEL[state], heard, on, start, stop, send: (text: string) => send({ text }) };
}

export type VoiceApi = ReturnType<typeof useVoice>;

export function MicButton({ v }: { v: VoiceApi }) {
  return (
    <button className={`mic ${v.on ? 'on' : ''}`} data-state={v.state} aria-pressed={v.on} aria-label={v.on ? 'Turn voice off' : 'Talk to the DJ'} data-testid="mic"
      onClick={() => (v.on ? v.stop() : v.start())}>
      <Icon n="mic" size={20} />
    </button>
  );
}

export function TypeRequest({ v, onSent }: { v: VoiceApi; onSent?: () => void }) {
  const [text, setText] = useState('');
  return (
    <form className="vtext" onSubmit={(e) => { e.preventDefault(); if (text.trim()) { v.send(text); setText(''); onSent?.(); } }}>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a request" aria-label="Type a request" data-testid="voice-text" enterKeyHint="send" />
    </form>
  );
}

function wavB64(chunks: Float32Array[], rate: number) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const all = new Float32Array(n);
  let o = 0; for (const c of chunks) { all.set(c, o); o += c.length; }
  const outRate = 16000, m = Math.floor((n * outRate) / rate);
  const pcm = new Int16Array(m);
  for (let i = 0; i < m; i++) {
    const v = Math.max(-1, Math.min(1, all[Math.floor((i * rate) / outRate)]));
    pcm[i] = v * 32767;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const d = new DataView(buf);
  const w = (p: number, s: string) => { for (let i = 0; i < s.length; i++) d.setUint8(p + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); d.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, outRate, true);
  d.setUint32(28, outRate * 2, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); w(36, 'data'); d.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  let s = ''; const u = new Uint8Array(buf);
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
