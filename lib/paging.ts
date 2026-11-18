// Walk every page of a continuation-token listing (S3 ListObjectsV2 style), oldest key first.
export type Page = { keys: string[]; next?: string };
export async function listAll(fetchPage: (token?: string) => Promise<Page>, limit = 5000): Promise<string[]> {
  const out: string[] = [];
  let token: string | undefined;
  do {
    const p = await fetchPage(token);
    out.push(...p.keys);
    token = p.next;
  } while (token && out.length < limit);
  return out.sort();
}
