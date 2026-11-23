import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendCmd, cmdsAfter, CMD_RE, KEEP } from '../lib/remote.ts';

test('commands get increasing seq numbers and only the last KEEP are kept', () => {
  let d = { cmds: [] as { seq: number; cmd: string; at: string }[] };
  for (let i = 0; i < KEEP + 5; i++) d = appendCmd(d, 'next', 't');
  assert.equal(d.cmds.length, KEEP);
  assert.equal(d.cmds.at(-1)!.seq, KEEP + 5);
  assert.deepEqual(cmdsAfter(d, KEEP + 3).map((c) => c.seq), [KEEP + 4, KEEP + 5]);
  assert.deepEqual(cmdsAfter(null, 0), []);
});

test('only known commands pass', () => {
  for (const ok of ['play', 'pause', 'toggle', 'next', 'prev', 'like', 'dislike', 'mood:chill', 'mood:station:kexp']) assert.ok(CMD_RE.test(ok), ok);
  for (const bad of ['rm -rf', 'mood:', 'Play', 'next; ls', 'mood:a b']) assert.ok(!CMD_RE.test(bad), bad);
});
