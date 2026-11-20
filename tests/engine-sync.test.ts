// The vendored engine (vendor/engine) must be byte-identical to music-core/engine, the one
// source of truth. Skips (with a loud note) when the sibling checkout is absent (CI).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const VENDOR = path.join(import.meta.dirname, '../vendor/engine');
const CORE = path.join(import.meta.dirname, '../../music-core/engine');

test('vendored engine matches music-core/engine', { skip: !fs.existsSync(CORE) ? 'music-core checkout not present beside this repo — run music-core tools/sync-engine.sh' : false }, () => {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const vendor = walk(VENDOR).sort();
  const core = walk(CORE).sort().filter((f) => !f.endsWith('.DS_Store'));
  assert.deepEqual(vendor.map((f) => path.basename(f)), core.map((f) => path.basename(f)), 'file sets differ — run music-core tools/sync-engine.sh');
  for (let i = 0; i < vendor.length; i++) {
    assert.ok(fs.readFileSync(vendor[i]).equals(fs.readFileSync(core[i])), `${path.basename(vendor[i])} differs from music-core — run music-core tools/sync-engine.sh`);
  }
});
