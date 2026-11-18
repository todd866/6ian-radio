import { NextResponse } from 'next/server';
import { requireAccount, noStore, isQa } from '@/lib/http';
import { classify, fastText, eraOf } from '@/lib/voice';
import { search } from '@/lib/search';
import { createJob } from '@/lib/jobs';
import { reserveCall, CapReached, CAPS } from '@/lib/voicecap';
import { space, refreshExtra } from '@/lib/space';

export const maxDuration = 20;

// One utterance (16 kHz mono WAV, base64) or typed text in; one intent and a short reply out.
export async function POST(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const body = await req.json().catch(() => ({}));
  const audio = typeof body.audio === 'string' && body.audio.length < 1_400_000 ? body.audio : undefined;
  const text = typeof body.text === 'string' ? body.text.trim().slice(0, 200) : undefined;
  if (!audio && !text) return NextResponse.json({ error: 'nothing heard' }, { status: 400 });
  const fast = text ? fastText(text) : null;
  let undo: (() => Promise<unknown>) | null = null;
  let left = CAPS.voice;
  if (!fast) {
    try {
      const r = await reserveCall(a.id, 'voice');
      undo = r.undo; left = r.left;
    } catch (e) {
      const cap = e instanceof CapReached;
      return NextResponse.json({ error: cap ? 'cap' : 'counter', message: cap ? 'Voice is done for today. Type a request or use the buttons.' : 'Voice is unavailable right now. Type a request or use the buttons.' }, { status: cap ? 429 : 503 });
    }
  }
  const t0 = Date.now();
  let h;
  try {
    h = fast ?? (await classify({ audioWavB64: audio, text }));
  } catch (e) {
    await undo?.().catch(() => undefined);
    return NextResponse.json({ error: 'model', message: 'Could not hear that. Try again or type it.' }, { status: 502 });
  }
  await refreshExtra();
  // The search bar: plain text that isn't a command is a song or artist to play.
  if (text && h.intent === 'none') h = { heard: text, intent: 'play', query: text };
  const S = space();
  const cur = typeof body.cur === 'string' ? S.tracks[S.bySha.get(body.cur) ?? -1] : undefined;
  // "play X": straight to the library, no model beyond the transcript.
  let found: { s: string; a: string; t: string }[] = [];
  if ((h.intent === 'play' || h.intent === 'playlist') && h.query) {
    found = search(h.query).map((x) => ({ s: S.tracks[x.i].s, a: S.tracks[x.i].a, t: S.tracks[x.i].t }));
  }
  let job: { id: string } | null = null;
  let jobLimited = false;
  if ((h.intent === 'play' || h.intent === 'playlist') && h.query && (!found.length || h.intent === 'playlist')) {
    job = await createJob(a.id, h.intent, h.query, isQa(req)).catch((e) => { jobLimited = e instanceof CapReached; return null; });
  }
  const era = h.intent === 'era' ? eraOf(h.query ?? h.heard) : null;
  let reply = replyFor(h.intent, h.mood, cur);
  if (h.intent === 'era') reply = era ? `The ${era.from}s, then.` : `Which decade?`;
  if (h.intent === 'play' || h.intent === 'playlist') {
    reply = found.length ? `${found[0].t}, by ${found[0].a}.${h.intent === 'playlist' ? ' Then more around it.' : ''}` : job ? `${h.query} isn't in the library yet. Fetching it now; something close meanwhile.` : jobLimited ? `${h.query} isn't in the library, and today's fetch requests are used up. Something close for now.` : `${h.query ?? 'That'} isn't in the library yet. Something close for now.`;
  }
  return NextResponse.json({ ...h, era, found, job: job?.id ?? null, reply, ms: Date.now() - t0, left }, { headers: noStore });
}

type T = ReturnType<typeof space>['tracks'][number];
function replyFor(intent: string, mood: string | undefined, cur?: T): string {
  switch (intent) {
    case 'who': return cur ? `That's ${cur.t}, by ${cur.a}${cur.al ? `, off ${cur.al}` : ''}${cur.y ? `, ${cur.y}` : ''}.` : 'Nothing playing yet.';
    case 'about': return cur ? (cur.al ? `Off ${cur.al}${cur.y ? `, ${cur.y}` : ', year not sure'}. Details on screen.` : 'Not sure of the album. What I have is on screen.') : 'Nothing playing yet.';
    case 'lyrics': return 'Lyrics on screen.';
    case 'skip': return 'Gone. Something else.';
    case 'heavier': return 'Heavier, coming up.';
    case 'lighter': return 'Bringing it down.';
    case 'more_new': return 'More new stuff, then.';
    case 'known': return 'One you know.';
    case 'back': return 'Back one.';
    case 'mood': return mood ? `Over to ${mood}.` : 'Changing the station.';
    case 'more_like': return 'More like this.';
    case 'less_like': return 'Less of that.';
    default: return '';
  }
}
