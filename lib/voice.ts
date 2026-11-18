// Voice commands: Gemini hears the utterance (or reads typed text) and returns one intent.
// Replies are composed here from our own data, so nothing about an artist is invented.

export const INTENTS = ['play', 'playlist', 'era', 'about', 'lyrics', 'skip', 'heavier', 'lighter', 'more_new', 'known', 'who', 'back', 'mood', 'more_like', 'less_like', 'none'] as const;
export type Intent = (typeof INTENTS)[number];
export type Heard = { heard: string; intent: Intent; mood?: string; query?: string };

export const VOICE_MODEL = process.env.VOICE_MODEL ?? 'gemini-3.1-flash-lite';
export const TTS_MODEL = process.env.TTS_MODEL ?? 'gemini-3.8-flash-lite-tts';

const PROMPT = `You route spoken commands for a music radio player. Music may be playing in the background; ignore sung lyrics.
Return JSON {"heard": "<what the listener said>", "intent": "<one of the intents>", "mood": "<mood id or empty>", "query": "<song/artist named, or empty>"}.
Intents:
- play: asks for a specific NAMED song or artist ("play Bulls on Parade", "put on some Radiohead"); query = the song and/or artist as said. "Play something heavier/calmer/new/I know" is NOT play: use heavier/lighter/more_new/known.
- playlist: asks for a playlist/set built around a song or artist ("make me a playlist of X and similar stuff"); query = X
- era: a decade or period ("90s only", "something from the seventies"); query = the period as said
- skip: "not this", "skip", "next", "nah"
- heavier: "something heavier", "harder", "louder", "more energy", "rock"
- lighter: "calmer", "softer", "chill it out", "something lighter"
- more_new: "more new stuff", "something I haven't heard", "surprise me"
- known: "something I know", "play the hits", "something familiar"
- who: "who is this", "what's this song", "what is playing"
- about: "tell me about this album", "tell me more about this", "who made this"
- lyrics: "show lyrics", "what are the words", "lyrics"
- back: "go back", "previous", "play that again"
- mood: a named vibe; set mood to one of: chill, alt, drive, dance, rap, heavy, wide ("something for the drive" -> drive)
- more_like: "more like this", "I like this"
- less_like: "less like this", "not this kind of thing"
- none: no command, silence, background music or lyrics only
Pick the single best intent.`;

export async function classify(input: { audioWavB64?: string; text?: string }): Promise<Heard> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('voice is not configured');
  const parts: unknown[] = [{ text: PROMPT }];
  if (input.audioWavB64) parts.push({ inlineData: { mimeType: 'audio/wav', data: input.audioWavB64 } });
  if (input.text) parts.push({ text: `Typed by the listener: ${input.text.slice(0, 200)}` });
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${VOICE_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ role: 'user', parts }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 120 },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`voice model ${r.status}`);
  const j = await r.json();
  const text = j.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  const out = JSON.parse(text) as Partial<Heard>;
  const intent = (INTENTS as readonly string[]).includes(out.intent ?? '') ? (out.intent as Intent) : 'none';
  return { heard: String(out.heard ?? '').slice(0, 200), intent, mood: out.mood || undefined, query: out.query ? String(out.query).slice(0, 120) : undefined };
}

export async function speak(text: string): Promise<Buffer> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('voice is not configured');
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `Read this like a relaxed late-night radio DJ, quietly: ${text.slice(0, 240)}` }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Charon' } } } },
    }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`tts ${r.status}`);
  const j = await r.json();
  const part = j.candidates?.[0]?.content?.parts?.find((p: { inlineData?: unknown }) => p.inlineData);
  if (!part) throw new Error('tts returned no audio');
  let buf = Buffer.from(part.inlineData.data, 'base64');
  if (buf.toString('ascii', 0, 4) === 'RIFF') return buf;
  const rate = Number(/rate=(\d+)/.exec(part.inlineData.mimeType)?.[1] ?? 24000);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + buf.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(buf.length, 40);
  buf = Buffer.concat([h, buf]);
  return buf;
}

// Typed text that is plainly a command skips the model entirely.
const FAST: [RegExp, Intent, string?][] = [
  [/^(not this|skip|next|nah)\b/i, 'skip'], [/heavier|harder|more energy/i, 'heavier'], [/calmer|softer|lighter|chill it/i, 'lighter'],
  [/more new|haven'?t heard|surprise me/i, 'more_new'], [/something i know|familiar|the hits/i, 'known'], [/who is this|what'?s this|what is playing/i, 'who'],
  [/^(go )?back\b|previous/i, 'back'], [/lyrics|the words/i, 'lyrics'], [/tell me (more )?about|about this album|who made this/i, 'about'], [/\b(\d0'?s|sixties|seventies|eighties|nineties)\b/i, 'era'], [/more like this/i, 'more_like'], [/less like this/i, 'less_like'], [/for the drive|driving/i, 'mood', 'drive'],
];
export function fastText(text: string): Heard | null {
  const m = /^(?:play|put on)\s+(.+)/i.exec(text.trim());
  if (m && !/something|more|less/i.test(m[1])) return { heard: text, intent: 'play', query: m[1] };
  for (const [re, intent, mood] of FAST) if (re.test(text)) return { heard: text, intent, mood, ...(intent === 'era' ? { query: text } : {}) };
  return null;
}

// "90s", "the seventies", "1980s", "2000s" -> a year range.
export function eraOf(q: string | undefined): { from: number; to: number } | null {
  if (!q) return null;
  const words: Record<string, number> = { sixties: 1960, seventies: 1970, eighties: 1980, nineties: 1990, noughties: 2000, 'two thousands': 2000, tens: 2010, twenties: 2020 };
  const t = q.toLowerCase();
  for (const [w, y] of Object.entries(words)) if (t.includes(w)) return { from: y, to: y + 9 };
  const m = /\b(19|20)?(\d)0'?s\b/.exec(t);
  if (!m) return null;
  const y = m[1] ? Number(`${m[1]}${m[2]}0`) : Number(m[2]) >= 5 ? 1900 + Number(m[2]) * 10 : 2000 + Number(m[2]) * 10;
  return { from: y, to: y + 9 };
}
