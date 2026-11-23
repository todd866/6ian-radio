// Phone -> Mac remote (owner, 21 Nov 2026: play from the laptop to the Bose, "control the music from my
// phone via 6ian"). The phone appends commands to radio/remote/<account>.json; the Mac's bridge
// (glancebar tools/music-remote) polls them with its device token and drives Glancebar, and its
// now-playing heartbeats (surface "mac") tell the phone what is on.
export type RemoteCmd = { seq: number; cmd: string; at: string };
export type RemoteDoc = { cmds: RemoteCmd[] };

export const CMD_RE = /^(play|pause|toggle|next|prev|like|dislike|mood:[a-z0-9:_-]{1,40})$/;
export const remoteKey = (account: string) => `radio/remote/${account}.json`;
export const KEEP = 20;

export function appendCmd(doc: RemoteDoc, cmd: string, at: string): RemoteDoc {
  const seq = (doc.cmds.at(-1)?.seq ?? 0) + 1;
  return { cmds: [...doc.cmds, { seq, cmd, at }].slice(-KEEP) };
}

export const cmdsAfter = (doc: RemoteDoc | null, after: number) => (doc?.cmds ?? []).filter((c) => c.seq > after);
