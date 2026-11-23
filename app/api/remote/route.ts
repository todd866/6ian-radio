import { NextResponse } from 'next/server';
import { requireAccount, noStore } from '@/lib/http';
import { capStore } from '@/lib/r2';
import { appendCmd, CMD_RE, remoteKey, type RemoteDoc } from '@/lib/remote';

// The phone sends a command to the Mac that is playing (session only; the Mac reads them on /api/device/remote).
export async function POST(req: Request) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const { cmd } = await req.json().catch(() => ({}));
  if (typeof cmd !== 'string' || !CMD_RE.test(cmd)) return NextResponse.json({ error: 'bad command' }, { status: 400, headers: noStore });
  const key = remoteKey(a.id);
  for (let i = 0; i < 30; i++) {
    const cur = await capStore.get(key);
    const next = appendCmd((cur?.body as unknown as RemoteDoc) ?? { cmds: [] }, cmd, new Date().toISOString());
    if (await capStore.putIf(key, next as never, cur ? cur.etag : null)) return NextResponse.json({ ok: true, seq: next.cmds.at(-1)!.seq }, { headers: noStore });
    await new Promise((r) => setTimeout(r, 20 + Math.random() * 150));
  }
  return NextResponse.json({ error: 'busy' }, { status: 503, headers: noStore });
}
