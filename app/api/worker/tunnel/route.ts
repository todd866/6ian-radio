import { NextResponse } from 'next/server';
import { putJSON } from '@/lib/r2';
import { workerOk } from '@/lib/worker';

// The home worker worker reports its current quick-tunnel URL on every (re)start.
export async function POST(req: Request) {
  if (!workerOk(req)) return new NextResponse(null, { status: 401 });
  const { url } = await req.json().catch(() => ({}));
  if (typeof url !== 'string' || !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/.test(url)) return NextResponse.json({ error: 'bad url' }, { status: 400 });
  await putJSON('radio/jobs/worker.json', { url, at: new Date().toISOString() });
  return NextResponse.json({ ok: true });
}
