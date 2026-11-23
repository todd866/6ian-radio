'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Initial } from '@/lib/initial';
import type { Presented } from '@/lib/present';
import { Icon } from './Icon';
import { Sleeve } from './Sleeve';
import { Tuner } from './Tuner';
import { SetView } from './SetView';
import { MapView } from './MapView';
import { MeView } from './MeView';
import { createEngine, type Engine } from './engine';
import { createHeartbeat, type Heartbeat } from '../lib/heartbeat';
import { useVoice, MicButton, type VoiceResult } from './Voice';
import { Home, Tile, Art, StationPage, type TileT, type StationT } from './Home';
import { WhyView, AboutView, LyricsView, prefetchLyrics } from './InfoPanel';

type Sheet = 'map' | 'me';
type Steer = { s: string; d: 1 | -1; early?: boolean };

const fmt = (s: number) => (Number.isFinite(s) && s > 0 ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00');

const qa = () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('silent');
export const qaHeaders = (): Record<string, string> => (qa() ? { 'x-radio-qa': '1' } : {});
function post(url: string, body: unknown) {
  return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...qaHeaders() }, body: JSON.stringify(body) });
}

export default function Radio({ name, style, init }: { name: string; style: string; init: Initial }) {
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mood, setMood] = useState(init.mood);
  const [rating, setRating] = useState<'pg' | 'm'>(init.rating ?? 'pg');
  // The Mac playing for this account (its bridge heartbeats surface "mac"): the phone becomes its remote.
  const [remote, setRemote] = useState<{ title?: string; artist?: string; state?: string; liked?: boolean; host: string } | null>(null);
  const [past, setPast] = useState<Presented[]>([]);
  const [cur, setCur] = useState<Presented | null>(init.picks[0] ?? null);
  const [next, setNext] = useState<Presented[]>(init.picks.slice(1));
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(init.picks[0]?.dur ?? 0);
  const [likes, setLikes] = useState<Set<string>>(new Set(init.likes));
  const [clock, setClock] = useState(init.clock);
  const [rule, setRule] = useState(init.rule);
  const [lossless, setLossless] = useState(false);
  const [canLossless, setCanLossless] = useState(false);
  const [err, setErr] = useState('');
  const steer = useRef<Steer[]>([]);
  const era = useRef<{ from: number; to: number } | null>(null); // a spoken "90s only" holds until the mood changes
  const audio = useRef<HTMLAudioElement | null>(null);
  const eng = useRef<Engine | null>(null);
  const [said, setSaid] = useState('');
  const preload = useRef<HTMLAudioElement | null>(null);
  const playedFor = useRef<string | null>(null);
  const silent = useRef(false);
  const fetching = useRef(false);
  const hb = useRef<Heartbeat | null>(null);

  const src = useCallback((t: Presented) => `/api/audio/${t.s}?q=${lossless ? 'alac' : 'aac'}`, [lossless]);

  useEffect(() => {
    silent.current = new URLSearchParams(location.search).has('silent');
    const a = new Audio();
    a.preload = 'auto';
    a.setAttribute('playsinline', '');
    audio.current = a;
    eng.current = createEngine(a, silent.current);
    const p = new Audio();
    p.preload = 'auto'; p.muted = true;
    preload.current = p;
    setCanLossless(a.canPlayType('audio/mp4; codecs="alac"') !== '');
    try { setLossless(localStorage.getItem('mr.lossless') === '1' && a.canPlayType('audio/mp4; codecs="alac"') !== ''); } catch {}
    let host = 'browser';
    try {
      host = localStorage.getItem('mr.now-host') ?? '';
      if (!host) { host = Math.random().toString(36).slice(2, 12); localStorage.setItem('mr.now-host', host); }
    } catch {}
    hb.current = createHeartbeat({
      put: (doc) => fetch('/api/device/now', {
        method: 'PUT', headers: { 'content-type': 'application/json', ...qaHeaders() }, body: JSON.stringify(doc), keepalive: true,
      }).then((r) => { if (!r.ok) throw new Error(String(r.status)); }),
    });
    hb.current.host = host;
    // Tab close never runs the React unmount; pagehide is the last reliable beat.
    const onHide = () => hb.current?.stop();
    window.addEventListener('pagehide', onHide, { capture: true });
    (window as unknown as { __radio: unknown }).__radio = { audio: a, engine: eng.current };
    document.documentElement.dataset.ready = '1';
    return () => { window.removeEventListener('pagehide', onHide, { capture: true }); hb.current?.stop(); a.pause(); a.src = ''; };
  }, []);

  // Load a track into the element (does not start it unless asked).
  const load = useCallback((t: Presented | null, autoplay: boolean) => {
    const a = audio.current;
    if (!a || !t) return;
    playedFor.current = null;
    a.src = src(t);
    setPos(0); setDur(t.dur);
    document.documentElement.style.setProperty('--art', t.color);
    if (autoplay) eng.current!.play().catch((e) => setErr(String(e?.message ?? e)));
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.t, artist: t.a, album: t.al,
        artwork: t.art ? [{ src: `/api/art/${t.s}`, sizes: '600x600', type: 'image/jpeg' }] : [],
      });
    }
  }, [src]);

  useEffect(() => { if (cur) document.documentElement.style.setProperty('--art', cur.color); }, [cur]);
  useEffect(() => {
    load(cur, false); // first track, once
    const w = window as unknown as { __earlyPlay?: number };
    if (w.__earlyPlay) { w.__earlyPlay = 0; eng.current?.play().catch(() => {}); }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const history = useMemo(() => [...past.map((p) => p.s), ...(cur ? [cur.s] : [])].slice(-40), [past, cur]);

  const refill = useCallback(async (opts: { replace?: boolean; mood?: string; point?: { x: number; y: number }; anchor?: string; tilt?: object; start?: string; force?: boolean; era?: { from: number; to: number } | null } = {}) => {
    if (fetching.current && !opts.force) return;
    fetching.current = true;
    try {
      const anchor = opts.anchor ?? (opts.replace ? cur?.s : (next[next.length - 1]?.s ?? cur?.s));
      const r = await post('/api/queue', { mood: opts.mood ?? mood, anchor, steer: steer.current, point: opts.point, history: [...history, ...(opts.replace ? [] : next.map((n) => n.s))], n: 10, lossless, tilt: opts.tilt, start: opts.start, era: opts.era ?? era.current, canAlac: canLossless });
      if (r.status === 401) { location.href = '/login'; return; }
      const j = await r.json();
      setClock(j.clock); setRule(j.rule);
      setNext((old) => (opts.replace ? j.picks : [...old, ...j.picks]));
      return j.picks as Presented[];
    } catch (e) {
      setErr('Queue did not load. Tap ⏭ to retry.');
    } finally {
      fetching.current = false;
    }
  }, [cur, next, mood, history, lossless, canLossless]);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      if (document.visibilityState !== 'visible') return;
      const j = await fetch('/api/device/now', { headers: qaHeaders() }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (stop || !j) return;
      const mac = (j.all ?? []).find((d: { surface: string; live: boolean }) => d.surface === 'mac' && d.live) ?? null;
      setRemote(mac);
    };
    poll();
    const t = setInterval(poll, 5000);
    return () => { stop = true; clearInterval(t); };
  }, []);
  const sendRemote = useCallback(async (cmd: string) => {
    if (cmd === 'toggle') setRemote((r) => (r ? { ...r, state: r.state === 'playing' ? 'paused' : 'playing' } : r));
    if (cmd === 'like') setRemote((r) => (r ? { ...r, liked: !r.liked } : r));
    const r = await post('/api/remote', { cmd }).catch(() => null);
    if (!r?.ok) setErr('The Mac did not get that. Try again.');
  }, []);

  const toggleRating = useCallback(async () => {
    const want = rating === 'pg' ? 'm' : 'pg';
    const r = await post('/api/rating', { rating: want }).catch(() => null);
    if (!r?.ok) return;
    setRating(want);
    refill({ replace: true, force: true }); // the songs lined up were picked under the old rating
  }, [rating, refill]);

  const event = useCallback((t: Presented, ev: string) => {
    const a = audio.current;
    return post('/api/event', { pt: t.pt, ev, pos: a?.currentTime ?? 0 }).catch(() => undefined);
  }, []);

  const advance = useCallback(async (how: 'skip' | 'finish') => {
    if (!cur) return;
    event(cur, how);
    let queue = next;
    const a = audio.current;
    if (how === 'skip' && a && a.currentTime < 30) {
      // Early skip: steer away from this song and its neighbours, and re-plan the set.
      steer.current = [...steer.current, { s: cur.s, d: -1 as const, early: true }].slice(-6);
      const fresh = await refill({ replace: true, anchor: cur.s });
      if (fresh?.length) queue = fresh;
    }
    if (!queue.length) queue = (await refill()) ?? [];
    const [n, ...rest] = queue;
    setPast((p) => [...p, cur].slice(-30));
    setCur(n ?? null); setNext(rest);
    load(n ?? null, true);
    if (rest.length < 4) setTimeout(() => refill(), 0);
  }, [cur, next, event, refill, load]);

  const back = useCallback(() => {
    const a = audio.current;
    if (!a) return;
    if (a.currentTime > 5 || !past.length) { a.currentTime = 0; return; }
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    if (cur) setNext((n) => [cur, ...n]);
    setCur(prev);
    load(prev, true);
  }, [past, cur, load]);

  const toggle = useCallback(() => {
    const a = audio.current;
    if (!a || !cur) return;
    if (!a.src) load(cur, false);
    if (a.paused) eng.current!.play().catch((e) => setErr(String(e?.message ?? e))); else eng.current!.pause();
  }, [cur, load]);

  const like = useCallback(() => {
    if (!cur) return;
    const on = !likes.has(cur.s);
    setLikes((l) => { const n = new Set(l); if (on) n.add(cur.s); else n.delete(cur.s); return n; });
    event(cur, on ? 'like' : 'unlike');
  }, [cur, likes, event]);

  const steerBy = useCallback((d: 1 | -1) => {
    if (!cur) return;
    steer.current = [...steer.current, { s: cur.s, d }].slice(-6);
    event(cur, d > 0 ? 'more' : 'less');
    if (d < 0) advance('skip'); else refill({ replace: true });
  }, [cur, event, refill, advance]);

  const tune = useCallback(async (m: string, point?: { x: number; y: number }) => {
    if (remote && !playing && !point) sendRemote(`mood:${m}`); // the Mac is the player: steer it too
    setMood(m);
    steer.current = [];
    era.current = null;
    const picks = await refill({ replace: true, mood: m, point, anchor: point ? undefined : cur?.s });
    if (picks?.length && !playing) {
      // Not playing yet: put the new mood's first song up straight away.
      const [n, ...rest] = picks;
      if (cur) setPast((p) => [...p, cur].slice(-30));
      setCur(n); setNext(rest); load(n, false);
    }
  }, [refill, cur, playing, load, remote, sendRemote]);

  // Re-plan and switch to the first new pick at once, so a spoken command is heard, not queued.
  const jump = useCallback(async (opts: Parameters<typeof refill>[0]) => {
    const picks = await refill({ replace: true, force: true, ...opts });
    if (!picks?.length) return;
    const [n, ...rest] = picks;
    if (cur) setPast((p) => [...p, cur].slice(-30));
    setCur(n); setNext(rest);
    load(n, !eng.current?.userPaused || playing);
  }, [refill, cur, load, playing]);

  // A song being fetched on the home worker: watch the job, then put the song up next when it lands.
  const watchJob = useCallback((id: string, query: string) => {
    const t0 = Date.now();
    setSaid(`Fetching ${query}… usually a minute or two.`);
    const tick = async () => {
      const r = await fetch(`/api/jobs/${id}`, { headers: qaHeaders() }).catch(() => null);
      const j = r?.ok ? await r.json() : null;
      if (j?.shas?.length && (j.status === 'done' || j.status === 'claimed')) {
        const picks = await refill({ replace: true, force: true, start: j.shas[0], anchor: j.shas[0] });
        const secs = Math.round((Date.now() - t0) / 1000);
        setSaid(picks?.length ? `${query} is in (${secs} s). Up next.` : `${query} is in the library now.`);
        (window as unknown as { __fetchLog?: unknown[] }).__fetchLog = [...((window as unknown as { __fetchLog?: unknown[] }).__fetchLog ?? []), { id, secs, shas: j.shas }];
        return;
      }
      if (j?.status === 'failed') { setSaid(`Couldn't get ${query}: ${j.note ?? 'not findable right now'}.`); return; }
      if (Date.now() - t0 < 10 * 60_000) setTimeout(tick, 4000);
    };
    setTimeout(tick, 4000);
  }, [refill]);

  const onVoice = useCallback(async (r: VoiceResult) => {
    setSaid(r.reply || '');
    if (r.job && r.query) watchJob(r.job, r.query);
    switch (r.intent) {
      case 'who': setView('np'); setUpTab('why'); return;
      case 'about': setView('np'); setUpTab('about'); return;
      case 'lyrics': setView('np'); setUpTab('lyrics'); return;
      case 'skip': return advance('skip');
      case 'back': return back();
      case 'heavier': return jump({ tilt: { heavy: 1, energy: 0.5 } });
      case 'lighter': return jump({ tilt: { heavy: -1, energy: -0.6 } });
      case 'known': return jump({ tilt: { known: true } });
      case 'more_new': await post('/api/me', { newShareDelta: 0.15 }); return jump({});
      case 'more_like': return steerBy(1);
      case 'less_like': return steerBy(-1);
      case 'mood': if (r.mood) { setMood(r.mood); steer.current = []; era.current = null; return jump({ mood: r.mood }); } return;
      case 'era': if (r.era) { era.current = r.era; return jump({ mood: 'wide', era: r.era }); } return;
      case 'play': case 'playlist':
        if (r.found?.length) {
          if (r.intent === 'playlist') steer.current = [{ s: r.found[0].s, d: 1 }];
          return jump({ start: r.found[0].s, anchor: r.found[0].s });
        }
        return jump({ mood: 'wide', tilt: { energy: 0 } }); // not in the library: something close, never silence
    }
  }, [advance, back, jump, steerBy, watchJob]);

  // Element events.
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    const onTime = () => {
      setPos(a.currentTime);
      if (!a.paused) beat(a.currentTime);
      if (Number.isFinite(a.duration)) setDur(a.duration);
      if (cur && playedFor.current !== cur.pt && a.currentTime > 0.3) { playedFor.current = cur.pt; event(cur, 'play'); }
      // Warm the next song when this one is nearly done.
      const n = next[0];
      if (n && preload.current && a.duration - a.currentTime < 25 && preload.current.dataset.s !== n.s) {
        preload.current.dataset.s = n.s; preload.current.src = src(n); preload.current.load();
      }
    };
    const beat = (position: number) => {
      if (!cur || !hb.current) return;
      hb.current.beat({ surface: 'browser', host: hb.current.host, sha: cur.s, title: cur.t, artist: cur.a, position, duration: Number.isFinite(a.duration) ? a.duration : undefined });
    };
    const onPlay = () => { setPlaying(true); beat(a.currentTime); };
    const onPause = () => { setPlaying(false); hb.current?.stop(); };
    const onEnded = () => advance('finish');
    const onError = () => { setErr('Stream failed; skipping.'); setTimeout(() => advance('skip'), 800); };
    a.addEventListener('timeupdate', onTime); a.addEventListener('play', onPlay); a.addEventListener('pause', onPause);
    a.addEventListener('ended', onEnded); a.addEventListener('error', onError);
    if ('mediaSession' in navigator) {
      navigator.mediaSession.setActionHandler('play', () => { eng.current?.play(); });
      navigator.mediaSession.setActionHandler('pause', () => eng.current?.pause());
      navigator.mediaSession.setActionHandler('nexttrack', () => advance('skip'));
      navigator.mediaSession.setActionHandler('previoustrack', back);
    }
    return () => {
      a.removeEventListener('timeupdate', onTime); a.removeEventListener('play', onPlay); a.removeEventListener('pause', onPause);
      a.removeEventListener('ended', onEnded); a.removeEventListener('error', onError);
    };
  }, [cur, next, advance, back, event, src]);

  useEffect(() => { if (err) { const t = setTimeout(() => setErr(''), 4000); return () => clearTimeout(t); } }, [err]);

  // Preload the art of the next few songs so cards never wait.
  useEffect(() => {
    for (const n of next.slice(0, 4)) if (n.art) { const i = new Image(); i.src = `/api/art/${n.s}`; i.decode?.().catch(() => {}); }
  }, [next]);

  const setLosslessPersist = (v: boolean) => { setLossless(v); try { localStorage.setItem('mr.lossless', v ? '1' : '0'); } catch {} };

  const voice = useVoice({ engine: () => eng.current, cur: cur?.s, onResult: onVoice });
  const [view, setView] = useState<'home' | 'np'>('home');
  const [upTab, setUpTab] = useState<'why' | 'about' | 'lyrics' | 'next' | 'related'>('next');
  const [hasLyrics, setHasLyrics] = useState(false);
  // A new find opens on Why this (with the album facts under it); other songs on Up next.
  useEffect(() => { if (!cur) return; setUpTab((t) => (t === 'lyrics' ? t : cur.nw ? 'why' : 'next')); setHasLyrics(false); prefetchLyrics(cur.s).then(setHasLyrics); }, [cur?.s]); // eslint-disable-line react-hooks/exhaustive-deps
  const [results, setResults] = useState<{ title: string; tiles: TileT[]; fetch?: string } | null>(null);
  const [menu, setMenu] = useState<TileT | null>(null);
  const [stationPage, setStationPage] = useState<string | null>(null);
  const [related, setRelated] = useState<TileT[]>([]);

  // Adopt the first pick without reloading the audio when the tap already started that song.
  const adopt = useCallback((picks: Presented[] | undefined) => {
    if (!picks?.length) return;
    const [n, ...rest] = picks;
    if (cur && cur.s !== n.s) setPast((p) => [...p, cur].slice(-30));
    setCur(n); setNext(rest);
    const a = audio.current;
    if (a && !a.src.includes(`/api/audio/${n.s}`)) load(n, true);
    else { setDur(n.dur); playedFor.current = null; document.documentElement.style.setProperty('--art', n.color); }
  }, [cur, load]);

  // A song tile: start that song inside the tap (iOS needs the gesture), then plan the set around it.
  const playSha = useCallback((sha: string, opts: Parameters<typeof refill>[0] = {}) => {
    const a = audio.current;
    if (a) { a.src = `/api/audio/${sha}?q=${lossless ? 'alac' : 'aac'}`; eng.current?.play().catch(() => {}); }
    setView('np');
    refill({ replace: true, force: true, start: sha, anchor: sha, mood: 'wide', ...opts }).then(adopt);
  }, [refill, adopt, lossless]);

  const openTile = useCallback((t: TileT) => {
    if (t.kind === 'station' && t.station) { setResults(null); setStationPage(t.station.id); return; }
    if (t.kind === 'soon') { voice.send(`play ${t.title} by ${t.artist}`); return; } // fetch it now
    if (t.kind === 'mix' && t.point) { setMood('wide'); steer.current = []; era.current = null; playSha(t.s!, { point: t.point }); return; }
    if (t.s) playSha(t.s);
  }, [playSha, voice]); // eslint-disable-line react-hooks/exhaustive-deps

  const playChip = useCallback((c: { id: string; label?: string; era?: { from: number; to: number } }) => {
    steer.current = [];
    if (remote && !playing && !c.era) {
      // The Mac is playing to the speakers: steer Glancebar instead of hijacking Bluetooth on the phone.
      era.current = null;
      setMood(c.id);
      sendRemote(`mood:${c.id}`);
      refill({ replace: true, mood: c.id }).then((picks) => {
        if (picks?.length) { const [n, ...rest] = picks; setCur(n); setNext(rest); load(n, false); }
      });
      setErr(`Playing ${c.label ?? c.id} on ${remote.host}`);
      return;
    }
    if (c.era) { era.current = c.era; setMood('wide'); jump({ mood: 'wide', era: c.era }).then(() => eng.current?.play().catch(() => {})); }
    else { era.current = null; setMood(c.id); jump({ mood: c.id }).then(() => eng.current?.play().catch(() => {})); }
    setView('np');
  }, [jump, remote, playing, sendRemote, refill, load]);

  const playNext = useCallback(async (t: TileT) => {
    const r = await post('/api/queue', { mood, start: t.s, n: 1, canAlac: canLossless });
    const j = await r.json().catch(() => null);
    if (j?.picks?.[0]) setNext((n) => [j.picks[0], ...n]);
  }, [mood, canLossless]);

  const showArtist = useCallback(async (artist: string) => {
    const j = await fetch(`/api/search?artist=${encodeURIComponent(artist)}`, { headers: qaHeaders() }).then((r) => r.json()).catch(() => ({ tiles: [] }));
    setResults({ title: artist, tiles: j.tiles }); setView('home');
  }, []);

  const search = useCallback(async (q: string) => {
    if (/^(not this|skip|next|heavier|harder|calmer|softer|lighter|more new|something i know|go back|back|who is this|\d0'?s|play |put on )/i.test(q.trim())) { voice.send(q); return; }
    const j = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: qaHeaders() }).then((r) => r.json()).catch(() => ({ tiles: [] }));
    setResults({ title: `Results for “${q}”`, tiles: j.tiles, fetch: q });
  }, [voice]);

  // Stations: a mix of what the station played that's in the library, or the live stream.
  const live = useRef<HTMLAudioElement | null>(null);
  const [liveOn, setLiveOn] = useState<{ name: string } | null>(null);
  const playStation = useCallback((st: StationT) => {
    live.current?.pause(); setLiveOn(null);
    steer.current = []; era.current = null;
    setMood(`station:${st.id}`);
    if (remote && !playing) {
      sendRemote(`mood:station:${st.id}`);
      refill({ replace: true, mood: `station:${st.id}` }).then((picks) => {
        if (picks?.length) { const [n, ...rest] = picks; setCur(n); setNext(rest); load(n, false); }
      });
      setErr(`Playing ${st.name} mix on ${remote.host}`);
      return;
    }
    jump({ mood: `station:${st.id}` }).then(() => eng.current?.play().catch(() => {}));
    setView('np');
  }, [jump, remote, playing, sendRemote, refill, load]);
  // The music element starting (skip, a tile, the car's next button) ends the live stream.
  useEffect(() => {
    const off = eng.current?.onMusicPlay(() => { if (live.current && !live.current.paused) live.current.pause(); setLiveOn(null); });
    return () => { off?.(); };
  }, []);
  const listenLive = useCallback((st: StationT) => {
    if (!st.live) return;
    eng.current?.pause();
    if (!live.current) { live.current = new Audio(); live.current.setAttribute('playsinline', ''); if (silent.current) live.current.muted = true; }
    const nav = navigator as unknown as { audioSession?: { type: string } };
    if (nav.audioSession && nav.audioSession.type !== 'play-and-record') nav.audioSession.type = 'playback'; // background-safe (see engine.play)
    live.current.src = st.live; live.current.play().catch(() => {});
    setLiveOn({ name: st.name });
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: `${st.name} (live)`, artist: st.name });
  }, []);

  useEffect(() => { if (view === 'np' && upTab === 'related' && cur) fetch(`/api/related?s=${cur.s}`, { headers: qaHeaders() }).then((r) => r.json()).then((j) => setRelated(j.tiles)).catch(() => {}); }, [view, upTab, cur]);

  const meView = <MeView lossless={lossless} canLossless={canLossless} setLossless={setLosslessPersist} onNewShare={() => refill({ replace: true })} />;
  const mapView = <MapView past={past} cur={cur} next={next} onTune={(p) => { setSheet(null); setMood('wide'); jump({ mood: 'wide', point: p }).then(() => eng.current?.play().catch(() => {})); setView('np'); }} />;
  void SetView; void Tuner;

  return (
    <div className="app2" data-playing={playing ? '1' : '0'}>
      {remote && !playing && (
        <div className="remotebar" data-testid="remote" title={`Playing on ${remote.host}`}>
          <Icon n="disc" size={18} />
          <button type="button" className="rt" aria-label={`Playing on ${remote.host}: ${[remote.title, remote.artist].filter(Boolean).join(' · ') || 'Mac'}`}
            title={[remote.title, remote.artist].filter(Boolean).join(' · ')}
            onClick={(e) => e.currentTarget.classList.toggle('open')}>
            {remote.title ?? 'Playing on the Mac'}{remote.artist ? <i> · {remote.artist}</i> : null}
          </button>
          <button aria-label="Dislike on the Mac" onClick={() => sendRemote('dislike')} data-testid="remote-dislike"><Icon n="thumbdown" size={18} /></button>
          <button aria-label="Previous on the Mac" onClick={() => sendRemote('prev')} data-testid="remote-prev"><Icon n="prev" size={18} /></button>
          <button aria-label={remote.state === 'paused' ? 'Play on the Mac' : 'Pause the Mac'} onClick={() => sendRemote('toggle')} data-testid="remote-toggle"><Icon n={remote.state === 'paused' ? 'play' : 'pause'} size={20} /></button>
          <button aria-label="Next on the Mac" onClick={() => sendRemote('next')} data-testid="remote-next"><Icon n="next" size={20} /></button>
          <button aria-label={remote.liked ? 'Unlike on the Mac' : 'Like on the Mac'} aria-pressed={!!remote.liked} className={remote.liked ? 'liked' : ''} onClick={() => sendRemote('like')} data-testid="remote-like"><Icon n={remote.liked ? 'thumbup-on' : 'thumbup'} size={18} /></button>
        </div>
      )}
      <header className="bar">
        <button className="logo" onClick={() => { setResults(null); setStationPage(null); setView('home'); }} aria-label="Home">6<b>IAN</b></button>
        <form className="searchbox" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get('q') as string; if (q?.trim()) search(q.trim()); }}>
          <Icon n="search" size={16} />
          <input name="q" placeholder="Search or ask" aria-label="Search, or ask for a song" data-testid="search" enterKeyHint="search" autoComplete="off" />
        </form>
        <MicButton v={voice} />
        <button className="avatar" onClick={() => setSheet('me')} aria-label={`Profile: ${name}`} data-testid="profile">{name[0]}</button>
      </header>
      {(voice.on || voice.heard || said) && (
        <p className="vline" data-state={voice.state} role="status">
          {voice.on && <b data-testid="voice-state">{voice.label}</b>}
          {voice.heard && <span>{voice.heard}</span>}
          {said && <span className="said" data-testid="said">{said}</span>}
        </p>
      )}

      <main className="home" aria-hidden={view === 'np'}>
        {results ? (
          <section className="results">
            <div className="shelfhead"><h2>{results.title}</h2><button onClick={() => setResults(null)}>Close</button></div>
            {results.fetch && <button className="fetchrow" onClick={() => voice.send(`play ${results.fetch}`)} data-testid="fetch">Play “{results.fetch}”{results.tiles.length ? '' : ' (find and add it)'}</button>}
            <div className="grid">{results.tiles.map((t) => <Tile key={t.s} t={t} onOpen={openTile} onMenu={setMenu} />)}</div>
          </section>
        ) : stationPage ? (
          <StationPage id={stationPage} onPlay={playStation} onLive={listenLive} onOpen={openTile} onMenu={setMenu} onBack={() => setStationPage(null)} />
        ) : (
          <Home onChip={playChip} onOpen={openTile} onMenu={setMenu} />
        )}
      </main>

      {cur && view === 'home' && (
        <div className="mini" onClick={() => setView('np')} role="button" aria-label="Open now playing" data-testid="mini">
          <Art s={cur.s} art={cur.art} color={cur.color} size={48} />
          <span className="mt"><b>{liveOn ? `${liveOn.name} (live)` : cur.t}</b><span>{liveOn ? 'Live radio' : cur.a}</span></span>
          {hasLyrics && !liveOn && <button className="lpill" onClick={(e) => { e.stopPropagation(); setUpTab('lyrics'); setView('np'); }} data-testid="lyrics-pill">Lyrics</button>}
          <button aria-label={playing ? 'Pause' : 'Play'} onClick={(e) => { e.stopPropagation(); toggle(); }} data-testid="mini-play"><Icon n={playing ? 'pause' : 'play'} size={24} /></button>
          <button aria-label="Skip" onClick={(e) => { e.stopPropagation(); advance('skip'); }}><Icon n="next" size={22} /></button>
          <i className="mprog" style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }} />
        </div>
      )}

      {cur && view === 'np' && (
        <section className="np" aria-label="Now playing">
          <div className="nphead">
            <button onClick={() => setView('home')} aria-label="Back to home" data-testid="np-close"><Icon n="down" size={24} /></button>
            <span>{liveOn ? 'Live radio' : 'Now playing'}</span>
            <div className="npright">
              <button className={`rating ${rating}`} onClick={toggleRating} data-testid="rating"
                aria-label={rating === 'pg' ? 'Rated PG: explicit songs are skipped. Tap to allow them for 4 hours' : 'Rated M: explicit songs allowed. Tap to go back to PG'}
                title={rating === 'pg' ? 'PG: explicit songs skipped (tap for M, 4 h)' : 'M: explicit allowed (tap for PG)'}>{rating === 'pg' ? 'PG' : 'M'}</button>
              <MicButton v={voice} />
            </div>
          </div>
          <div className="npbody">
            <div className="npplayer">
              <div className="npart"><Sleeve t={cur} big /></div>
              <div className="npmeta">
                <h1 className="title" title={cur.t} onClick={(e) => e.currentTarget.classList.toggle('open')}>{cur.t}</h1>
                <button className="npartist" onClick={() => showArtist(cur.a)}>{cur.a}</button>
                <div className="chips">{cur.chips.map((c) => <span key={c}>{c}</span>)}</div>
              </div>
              <div className="prog num">
                <span className="bar" role="slider" aria-label="Seek" aria-valuemin={0} aria-valuemax={Math.round(dur)} aria-valuenow={Math.round(pos)}
                  onClick={(e) => { const a = audio.current; const r = e.currentTarget.getBoundingClientRect(); if (a && dur) a.currentTime = ((e.clientX - r.left) / r.width) * dur; }}>
                  <i><b style={{ width: `${dur ? Math.min(100, (pos / dur) * 100) : 0}%` }} /></i>
                </span>
                <span>{fmt(pos)}</span><span>{fmt(dur)}</span>
              </div>
              <div className="transport">
                <button aria-label="Dislike" onClick={() => { event(cur, 'dislike'); steerBy(-1); }} data-testid="less"><Icon n="thumbdown" /></button>
                <button aria-label="Back" onClick={back}><Icon n="prev" size={28} /></button>
                <button className="play" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle} data-testid="play"><Icon n={playing ? 'pause' : 'play'} size={30} /></button>
                <button aria-label="Skip" onClick={() => advance('skip')} data-testid="skip"><Icon n="next" size={28} /></button>
                <button aria-label={likes.has(cur.s) ? 'Unlike' : 'Like'} aria-pressed={likes.has(cur.s)} className={likes.has(cur.s) ? 'liked' : ''} onClick={like} data-testid="like"><Icon n={likes.has(cur.s) ? 'thumbup-on' : 'thumbup'} /></button>
              </div>
            </div>
            <div className="nppanel">
              <div className="seg2" role="tablist">
                {([['why', 'Why this'], ['about', 'About'], ['lyrics', 'Lyrics'], ['next', 'Up next'], ['related', 'Related']] as const).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={upTab === k} onClick={() => setUpTab(k)} data-testid={`tab-${k}`}>{label}</button>
                ))}
              </div>
              <div className="uplist">
                {upTab === 'why' && <WhyView sha={cur.s} />}
                {upTab === 'about' && <AboutView sha={cur.s} />}
                {upTab === 'lyrics' && <LyricsView sha={cur.s} pos={pos} />}
                {(upTab === 'next' || upTab === 'related') && (upTab === 'next' ? next.slice(0, 30).map((t) => ({ kind: 'song' as const, s: t.s, title: t.t, sub: `${t.a}${t.y ? ` · ${t.y}` : ''}`, artist: t.a, art: t.art, color: t.color })) : related).map((t, i) => (
                  <button key={`${t.s}-${i}`} className="uprow" onClick={() => (upTab === 'next' ? (() => { const k = next.findIndex((n) => n.s === t.s); if (k >= 0) { const n = next[k]; if (cur) setPast((p) => [...p, cur]); setCur(n); setNext(next.slice(k + 1)); load(n, true); } })() : playSha(t.s!))}>
                    <Art s={t.s!} art={t.art} color={t.color} size={44} />
                    <span><b>{t.title}</b><span>{t.sub}</span></span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {menu && (
        <div className="scrim" onClick={() => setMenu(null)}>
          <div className="menu" role="menu" onClick={(e) => e.stopPropagation()}>
            <div className="menuhead"><Art s={menu.s ?? ''} art={menu.art} color={menu.color} size={48} src={menu.logo} /><span><b>{menu.title}</b><span>{menu.sub}</span></span></div>
            {menu.kind === 'station' ? (
              <>
                <button onClick={() => { playStation(menu.station!); setMenu(null); }}>Play songs they played</button>
                {menu.station?.live && (menu.station.liveType !== 'hls' || document.createElement('audio').canPlayType('application/vnd.apple.mpegurl')) && <button onClick={() => { listenLive(menu.station!); setMenu(null); }} data-testid="listen-live">Listen live</button>}
              </>
            ) : (
              <>
                <button onClick={() => { playNext(menu); setMenu(null); }}>Play next</button>
                <button onClick={() => { steer.current = [{ s: menu.s!, d: 1 }]; playSha(menu.s!); setMenu(null); }}>Start radio from this</button>
                {menu.artist && <button onClick={() => { showArtist(menu.artist!); setMenu(null); }}>Go to artist</button>}
              </>
            )}
          </div>
        </div>
      )}

      {sheet && (
        <div className="scrim" onClick={() => setSheet(null)}>
          <div className="sheet" role="dialog" aria-label="Profile" onClick={(e) => e.stopPropagation()}>
            <div className="sheethead">
              <div className="seg" role="tablist">
                {(['me', 'map'] as const).map((k) => <button key={k} role="tab" aria-selected={sheet === k} onClick={() => setSheet(k)} data-testid={`tab-${k}`}>{k === 'me' ? 'Profile' : 'Map'}</button>)}
              </div>
              <button className="close" onClick={() => setSheet(null)} aria-label="Close" data-testid="sheet-close">Done</button>
            </div>
            <div className="sheetbody">{sheet === 'map' ? mapView : meView}</div>
          </div>
        </div>
      )}
      {err && <div role="status" className="toast">{err}</div>}
    </div>
  );
}
