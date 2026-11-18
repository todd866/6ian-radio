import { NextResponse } from 'next/server';
import { requireAccount, noStore } from '@/lib/http';
import { getJSON } from '@/lib/r2';
import type { Job } from '@/lib/jobs';

// A listener checks on a fetch they asked for (their own jobs only).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await requireAccount();
  if (a instanceof NextResponse) return a;
  const { id } = await ctx.params;
  if (!/^[0-9]{14}-[0-9a-f]{6}$/.test(id)) return new NextResponse(null, { status: 404 });
  const j = (await getJSON<Job>(`radio/jobs/pending/${id}.json`)) ?? (await getJSON<Job>(`radio/jobs/done/${id}.json`));
  if (!j || j.user !== a.id) return new NextResponse(null, { status: 404 });
  return NextResponse.json({ id: j.id, status: j.status, query: j.query, shas: j.shas ?? [], note: j.note ?? null }, { headers: noStore });
}
