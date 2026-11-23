import { NextResponse } from 'next/server';
import { requireAccountOrDevice, noStore } from '@/lib/http';
import { capStore } from '@/lib/r2';
import { cmdsAfter, remoteKey, type RemoteDoc } from '@/lib/remote';

// The Mac bridge polls the phone's commands: GET ?after=<last seq it ran>.
export async function GET(req: Request) {
  const a = await requireAccountOrDevice(req);
  if (a instanceof NextResponse) return a;
  const after = Number(new URL(req.url).searchParams.get('after') ?? 0) || 0;
  const cur = await capStore.get(remoteKey(a.id));
  const doc = (cur?.body as unknown as RemoteDoc) ?? null;
  return NextResponse.json({ cmds: cmdsAfter(doc, after), last: doc?.cmds.at(-1)?.seq ?? 0 }, { headers: noStore });
}
