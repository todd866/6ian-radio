// Fetch requests for songs that aren't in the library. The hosted app can't reach the home
// network, so it writes a job to R2 under radio/jobs/pending/; a worker at home pages through
// /api/worker/jobs (oldest first) with its own token, runs the scout's existing acquire path,
// and marks the job done, which moves it to radio/jobs/done/.
import crypto from 'node:crypto';
import { getJSON, putJSON, listPage, deletePending } from './r2';
import { listAll } from './paging';
import { reserveCall } from './voicecap';

export type Job = {
  id: string; user: string; kind: 'play' | 'playlist'; query: string; at: string;
  status: 'pending' | 'claimed' | 'done' | 'failed'; cap: number; note?: string; shas?: string[]; qa?: boolean;
};
export const JOB_TRACK_CAP = 20;
const ID = /^[0-9]{14}-[0-9a-f]{6}$/;
const pendingKey = (id: string) => `radio/jobs/pending/${id}.json`;

// Rate-limited: reserves from the per-user and global "job" buckets first (fails closed).
export async function createJob(user: string, kind: Job['kind'], query: string, qa = false): Promise<Job> {
  await reserveCall(user, 'job');
  const at = new Date().toISOString();
  const id = `${at.replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(3).toString('hex')}`;
  const job: Job = { id, user, kind, query: query.slice(0, 120), at, status: 'pending', cap: kind === 'play' ? 1 : JOB_TRACK_CAP, ...(qa ? { qa: true } : {}) };
  await putJSON(pendingKey(id), job);
  return job;
}

export async function listPending(): Promise<Job[]> {
  const keys = await listAll((t) => listPage('radio/jobs/pending/', t));
  const jobs = await Promise.all(keys.map((k) => getJSON<Job>(k).catch(() => null)));
  return jobs.filter((j): j is Job => !!j && !j.qa && (j.status === 'pending' || j.status === 'claimed')); // QA jobs never reach the worker
}

export async function updateJob(id: string, patch: Partial<Job>): Promise<Job | null> {
  if (!ID.test(id)) return null;
  const j = await getJSON<Job>(pendingKey(id));
  if (!j) return null;
  const next: Job = { ...j, ...patch, id: j.id, user: j.user };
  if (next.status === 'done' || next.status === 'failed') {
    await putJSON(`radio/jobs/done/${id}.json`, next);
    await deletePending(pendingKey(id));
  } else {
    await putJSON(pendingKey(id), next);
  }
  return next;
}
