import crypto from 'node:crypto';
// The home worker's own bearer token (WORKER_TOKEN); it can only list and update jobs.
export function workerOk(req: Request) {
  const want = process.env.WORKER_TOKEN;
  const got = (req.headers.get('authorization') ?? '').replace(/^Bearer /, '');
  return !!want && want.length >= 32 && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}
