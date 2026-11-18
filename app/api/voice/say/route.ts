import { NextResponse } from 'next/server';
import { requireAccount } from '@/lib/http';
import { speak } from '@/lib/voice';
import { reserveCall } from '@/lib/voicecap';

export const maxDuration = 20;

// The DJ's spoken reply, as WAV, for the player to mix over the ducked music.
export async function POST(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const { text } = await req.json().catch(() => ({}));
  if (typeof text !== 'string' || !text.trim()) return new NextResponse(null, { status: 400 });
  let undo: () => Promise<unknown>;
  try { undo = (await reserveCall(a.id, 'tts')).undo; } catch { return new NextResponse(null, { status: 429 }); }
  try {
    const wav = await speak(text);
    return new NextResponse(new Uint8Array(wav), { headers: { 'content-type': 'audio/wav', 'cache-control': 'no-store' } });
  } catch {
    await undo().catch(() => undefined);
    return new NextResponse(null, { status: 502 });
  }
}
