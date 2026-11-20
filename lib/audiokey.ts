// Which R2 object to stream: AAC unless the master is asked for and exists; the master when the AAC
// tier hasn't reached the song; null when neither exists (a stand-in find has no master key).
export function audioKey(sha: string, master: string | undefined, hasAac: boolean, q: string | null): string | null {
  const m = master?.trim() ? master : '';
  if (hasAac && !(q === 'alac' && m)) return `radio/aac/${sha}.mp4`;
  return m || null;
}
