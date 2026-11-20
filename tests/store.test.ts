// Unified music-core store contract tests: match-key parity, alias resolution, taste event IDs,
// and append-only CAS writes into music/taste/<listener>/<YYYY-MM>/6ian-vercel.jsonl.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { embedMatchKey, resolveFromIds, buildTasteEvent, appendTasteEvent, tasteEventId, type TextCasStore } from '../lib/store.ts';

test('embedMatchKey matches the shared music-core fixture', () => {
  const fixturePath = path.join(os.homedir(), 'Projects/music-core/store/match-key-fixture.json');
  if (!fs.existsSync(fixturePath)) return;
  const rows = JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as { artist: string; title: string; key: string }[];
  assert.ok(rows.length > 0);
  for (const r of rows) {
    assert.equal(embedMatchKey(r.artist, r.title), r.key, `${r.artist} — ${r.title}`);
  }
});

test('resolveFromIds resolves sha, apple, youtube, persistent, and embedMatchKey', () => {
  const sha = 'a'.repeat(64);
  const sha2 = 'b'.repeat(64);
  const ids = {
    apple: { '123': sha },
    youtube: { 'ZQymUqbFD9c': sha2 },
    persistent: { '9A605B61': sha },
    key: { 'tame impala|the less i know the better': sha2 },
  };
  assert.equal(resolveFromIds(ids, { sha }), sha);
  assert.equal(resolveFromIds(ids, { apple: '123' }), sha);
  assert.equal(resolveFromIds(ids, { youtube: 'ZQymUqbFD9c' }), sha2);
  assert.equal(resolveFromIds(ids, { persistent: '9A605B61' }), sha);
  assert.equal(resolveFromIds(ids, { artist: 'Tame Impala', title: 'The Less I Know The Better - Remastered 2020' }), sha2);
  assert.equal(resolveFromIds(ids, { artist: 'Unknown', title: 'Song' }), null);
});

test('buildTasteEvent and appendTasteEvent are deterministic, CAS-safe, and deduplicated', async () => {
  const sha = 'c'.repeat(64);
  const ev = buildTasteEvent('ian', 'like', sha, { ts: Date.UTC(2026, 10, 20, 6, 0, 0), fraction: 0.42 });
  assert.ok(ev);
  assert.equal(ev.at, '2026-11-20T06:00:00Z');
  assert.equal(ev.id, tasteEventId({ at: ev.at, listener: 'ian', app: '6ian', host: 'vercel', kind: 'like', sha, fraction: 0.42 }));
  assert.equal(ev.id.length, 20);

  const mem = new Map<string, { text: string; etag: string }>();
  let ver = 0;
  const mock: TextCasStore = {
    async get(key) { return mem.get(key) ?? null; },
    async putIf(key, text, etag) {
      const cur = mem.get(key);
      if ((cur?.etag ?? null) !== etag) return false;
      mem.set(key, { text, etag: `v${++ver}` });
      return true;
    },
  };

  assert.equal(await appendTasteEvent(ev, mock), true);
  assert.equal(await appendTasteEvent(ev, mock), true); // idempotent dedup
  const stored = mem.get('music/taste/ian/2026-11/6ian-vercel.jsonl');
  assert.ok(stored);
  assert.equal(stored.text.trim().split('\n').length, 1);
  assert.equal(JSON.parse(stored.text.trim()).id, ev.id);
});
