import { NextResponse } from 'next/server';
import { updateJob } from '@/lib/jobs';
import { workerOk } from '@/lib/worker';

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!workerOk(req)) return new NextResponse(null, { status: 401 });
  const { id } = await ctx.params;
  const b = await req.json().catch(() => ({}));
  if (!['claimed', 'done', 'failed'].includes(b.status)) return NextResponse.json({ error: 'bad status' }, { status: 400 });
  const j = await updateJob(id, { status: b.status, note: typeof b.note === 'string' ? b.note.slice(0, 300) : undefined, shas: Array.isArray(b.shas) ? b.shas.slice(0, 20) : undefined });
  return j ? NextResponse.json(j) : new NextResponse(null, { status: 404 });
}
