import { NextResponse } from 'next/server';
import { listPending } from '@/lib/jobs';
import { workerOk } from '@/lib/worker';

export async function GET(req: Request) {
  if (!workerOk(req)) return new NextResponse(null, { status: 401 });
  return NextResponse.json({ jobs: await listPending() }, { headers: { 'cache-control': 'no-store' } });
}
