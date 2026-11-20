// The queue engine lives in music-core (one implementation, three runtimes: 6ian on Vercel,
// the Mac CLI, OTV). This repo vendors it at vendor/engine, copied by music-core's
// tools/sync-engine.sh; tests/engine-sync.test.ts fails if the copies drift. This shell keeps
// every existing import path working.
export * from '../vendor/engine/engine.ts';
