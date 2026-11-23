#!/usr/bin/env python3
"""Build data/space.json for the web radio from the song map.

Inputs (M5): the 3072-D Gemini track vectors (tracks.f32 + tracks-index.jsonl, keyed by the
master's sha256), the R2 catalogue (sha256 -> relativePath, tags), the Glancebar mix library
(genre, plays, favourites) and music-space.json (map kinds, keyed by library id).

Output: one compact JSON the server loads: per track metadata, kind, map position (t-SNE),
cluster ("corner"), energy and heaviness axes in 0..1, 16 nearest neighbours, and a
48-D PCA vector (int8) for steering. Songs offered must be in R2 (catalogue) AND embedded.
"""
import argparse, base64, collections, json, re, sys
from pathlib import Path

import numpy as np

HOME = Path.home()
for _cand in (HOME / 'Projects/music-core/embed', HOME / 'Projects/glancebar/tools/music-embed'):
    if _cand.is_dir() and str(_cand) not in sys.path:
        sys.path.insert(0, str(_cand))
from embed import match_key, music_kind_for_genre  # noqa: E402

DEF = dict(
    vectors=HOME / '.local/state/music-embed/vectors',
    catalogue=HOME / '.local/state/music-radio/catalogue.json',  # copied from R2: the main machine's own copy can lag
    library=HOME / 'Library/Application Support/Glancebar/mix/library.json',
    space=HOME / 'Library/Application Support/Glancebar/mix/music-space.json',
)
DIM = 3072
HIGH_ENERGY = re.compile(r'rock|punk|metal|hardcore|bass|dance|house|techno|jungle|drum|electro(?!nica)|edm|trap|grime', re.I)
LOW_ENERGY = re.compile(r'ambient|jazz|classical|singer|folk|downtempo|soundtrack|new age|bossa|acoustic|easy|instrumental|blues|country', re.I)
HEAVY = re.compile(r'rock|punk|metal|hardcore|grunge|psychedelic|surf|garage', re.I)


def rank01(x):
    order = np.argsort(np.argsort(x))
    return order / max(1, len(x) - 1)


GATE_SKIT = re.compile(r'\b(skit|intro|interlude)\b', re.I)
GATE_COVER = re.compile(r'karaoke|tribute|in the style of|made famous|originally performed|\(cover\)|cover version', re.I)


VERSION_DROP = re.compile(r'^(feat\.?|ft\.?|with)\b|remaster|deluxe|single|edit|radio|version$|\b(19|20)\d\d\b', re.I)


def version_of(title):
    """The version a title names: '[Isme Remix]' -> 'isme remix', '(Live)' -> 'live'. Featured artists,
    remasters and edits don't make a different recording."""
    parts = re.findall(r'[\(\[]([^\)\]]+)[\)\]]', title)
    keep = [p.strip().lower() for p in parts if not VERSION_DROP.search(p.strip())]
    return ' / '.join(sorted(keep))


def quality_gate(rows, cat):
    """Hard filters. Sets r['gx'] to the reason; the engine drops gated songs unless the
    listener liked them. Durations come from the embed tool's tracks.jsonl (the home worker's ffprobe)."""
    durs = {}
    p = HOME / '.local/state/music-radio/embed-tracks.jsonl'
    for line in (p.read_text().splitlines() if p.exists() else []):
        try:
            x = json.loads(line); durs[x['id']] = float(x.get('durationSeconds') or 0)
        except (ValueError, KeyError):
            pass
    fb = HOME / 'Library/Application Support/Glancebar/mix/feedback.jsonl'
    liked, disliked = set(), set()
    for line in (fb.read_text().splitlines() if fb.exists() else []):
        try:
            x = json.loads(line)
        except ValueError:
            continue
        k = match_key(x.get('artist', ''), x.get('title', ''))
        (liked if x.get('liked') else disliked).add(k)
        if x.get('liked'):
            disliked.discard(k)
        else:
            liked.discard(k)
    lib = json.loads(DEF['library'].read_text())['tracks']
    for t in lib:
        if t.get('dislike'):
            disliked.add(match_key(t.get('artist', ''), t.get('title', '')))
    quarantined = set()
    lib_cfg = HOME / '.config/glancebar/music-library.json'
    if lib_cfg.is_file():
        try:
            quarantined.update(json.loads(lib_cfg.read_text()).get('quarantine_sha256') or [])
        except (OSError, ValueError):
            pass
    trunc_p = HOME / '.local/state/music-core/truncated-masters-2026-11-22.json'
    if trunc_p.is_file():
        try:
            quarantined.update(x['sha256'] for x in json.loads(trunc_p.read_text()) if isinstance(x, dict) and x.get('sha256'))
        except (OSError, ValueError):
            pass
    groups = collections.defaultdict(list)
    for r in rows:
        r['d'] = round(durs.get(r['s'], 0), 1)
        k = match_key(r['a'], r['t'])
        groups[(k, version_of(r['t']))].append(r)  # a remix, live cut or instrumental is its own song
        if k in liked:
            r['gl'] = 1
        reason = None
        size = cat[r['s']]['sizeBytes']
        if r['s'] in quarantined or (r['d'] and r['d'] < 25):
            reason = 'truncated'
        elif 'children' in r['g'].lower():
            reason = "kids' music"
        elif GATE_SKIT.search(r['t']):
            reason = 'skit/intro/interlude'
        elif GATE_COVER.search(f"{r['t']} {r['a']} {r['al']}"):
            reason = 'karaoke/cover/tribute'
        elif r['d'] and r['d'] < 90:
            reason = 'under 1:30'
        elif r['d'] and size * 8 / r['d'] < 256_000:
            reason = 'low bitrate'
        elif k in disliked:
            reason = 'disliked in Glancebar'
        if reason:
            r['gx'] = reason
    for k, rs in groups.items():
        if len(rs) > 1:  # duplicate recordings: keep the largest (best) master
            rs.sort(key=lambda r: -cat[r['s']]['sizeBytes'])
            for r in rs[1:]:
                r.setdefault('gx', 'duplicate')
    return dict(collections.Counter(r['gx'] for r in rows if r.get('gx')))


def fill_from_coverage_map(idx, V):
    """Dual map (Ian, 21 Nov 2026: "only use high detail 3072D as available"). Songs with a Gemini
    vector keep it. Songs only in the EmbeddingGemma coverage map (vectors-gemma/, 768-D) get their
    vector through the relation map's 768->3072 projection (vectors/relation/), in memory only, and
    are tagged mp='gemma' in space.json. Missing coverage or relation files: Gemini only, as before."""
    emb = DEF['vectors'].parent
    gdir, rdir = emb / 'vectors-gemma', DEF['vectors'] / 'relation'
    try:
        from relation import load_projection, apply_projection
        W, meta = load_projection(rdir)
        gidx = [json.loads(l) for l in (gdir / 'tracks-index.jsonl').read_text().splitlines() if l.strip()]
        E = np.fromfile(gdir / 'tracks.f32', dtype='<f4').reshape(len(gidx), int(meta.get('dimIn', 768)))
    except (ImportError, OSError, ValueError) as e:
        print(f'coverage map not used: {e}', file=sys.stderr)
        return idx, V, 0
    have = {m['id'] for m in idx}
    extra = [i for i, m in enumerate(gidx) if m['id'] not in have]
    if not extra:
        return idx, V, 0
    P = apply_projection(E[extra], W)
    rows = [dict(gidx[i], mp='gemma') for i in extra]
    return idx + rows, np.vstack([V, P]).astype(np.float32), len(extra)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default=str(Path(__file__).resolve().parent.parent / 'data/space.json'))
    ap.add_argument('--clusters', type=int, default=18)
    a = ap.parse_args()

    idx = [json.loads(l) for l in (DEF['vectors'] / 'tracks-index.jsonl').read_text().splitlines() if l.strip()]
    V = np.fromfile(DEF['vectors'] / 'tracks.f32', dtype='<f4').reshape(len(idx), DIM)
    V /= np.linalg.norm(V, axis=1, keepdims=True) + 1e-9
    idx, V, filled = fill_from_coverage_map(idx, V)
    cat = {e['sha256']: e for e in json.loads(DEF['catalogue'].read_text())['entries']}
    lib = json.loads(DEF['library'].read_text())['tracks']
    space = json.loads(DEF['space'].read_text())['tracks']

    # Scout acquisitions: sha/path -> source and the scout's own note (real ledger data).
    scout = {}
    ledger = HOME / '.local/state/music-scout/ledger.jsonl'
    offered = {}
    for line in (ledger.read_text().splitlines() if ledger.exists() else []):
        try:
            x = json.loads(line)
        except ValueError:
            continue
        if x.get('action') == 'offered':
            offered[x.get('track_key')] = x
        elif x.get('action') == 'acquired':
            o = offered.get(x.get('track_key'), {})
            info = dict(src=x.get('source') or o.get('source') or 'scout', why=o.get('why'), at=x.get('at'))
            for k in (x.get('sha256'), x.get('catalogue_relative_path')):
                if k:
                    scout[k] = info
    # Songs the radio's fetch worker brought in (lane and requests): finds, with their real source.
    lane_done = HOME / '.local/state/music-radio/lane-done.jsonl'
    for line in (lane_done.read_text().splitlines() if lane_done.exists() else []):
        try:
            x = json.loads(line)
        except ValueError:
            continue
        if x.get('sha') and x['sha'] not in scout:
            scout[x['sha']] = dict(src=x.get('tag') or 'lane', why=x.get('why'), at=x.get('at'))
    by_path = {e['relativePath']: s for s, e in cat.items()}

    lib_by_key = collections.defaultdict(list)
    for t in lib:
        lib_by_key[match_key(t.get('artist', ''), t.get('title', ''))].append(t)

    rows, keep = [], []
    gaps = {'embeddedNotInR2': 0}
    for i, m in enumerate(idx):
        sha = m['id']
        c = cat.get(sha)
        if not c:
            gaps['embeddedNotInR2'] += 1
            continue
        tags = c.get('tags', {})
        artist = tags.get('artist') or m.get('artist', '')
        title = tags.get('title') or m.get('title', '')
        libs = lib_by_key.get(match_key(artist, title), [])
        L = max(libs, key=lambda t: t.get('plays', 0), default={})
        kind = None
        for t in libs:
            s = space.get(str(t.get('id')))
            if s:
                kind = s['kind']; break
        rows.append(dict(s=sha, a=artist, t=title, al=tags.get('album') or m.get('album', ''),
                         y=L.get('year'), g=L.get('genre') or '', p=int(L.get('plays') or 0),
                         f=int(L.get('fav') or 0), k=kind, key=c['relativePath']))
        if m.get('mp'):
            rows[-1]['mp'] = m['mp']  # vector from the coverage map, not Gemini
        sc = scout.get(sha) or scout.get(c['relativePath'])
        if sc:
            rows[-1]['sc'] = sc
        # "new" means new to him: a scout, lane or request find, not yet played. Everything else in
        # the catalogue is his own Apple Music library, including unplayed albums (owner, 19 Nov:
        # "it's all just my current albums"); library.json misses many album tracks, so it is not
        # the test. o=1 marks his own library songs.
        own = not sc
        if own:
            rows[-1]['o'] = 1
        rows[-1]['nw'] = 1 if (not own and rows[-1]['p'] == 0) else 0
        keep.append(i)
    gaps['inR2NotEmbedded'] = len(set(cat) - {m['id'] for m in idx})
    V = V[keep]
    n = len(rows)

    # Kinds: map kind when matched, else genre seed, else nearest kind centroid.
    for r in rows:
        if not r['k']:
            g = music_kind_for_genre(r['g'])
            r['k'] = g if g in ('dance', 'alt', 'rap', 'chill') else None
    cents = {}
    for k in ('dance', 'alt', 'rap', 'chill'):
        ix = [i for i, r in enumerate(rows) if r['k'] == k]
        c = V[ix].mean(0); cents[k] = c / np.linalg.norm(c)
    C = np.stack([cents[k] for k in cents]); names = list(cents)
    for i, r in enumerate(rows):
        if not r['k']:
            r['k'] = names[int(np.argmax(C @ V[i]))]

    # Axes: direction between genre-seeded groups, projected and rank-normalised.
    def axis(pos, neg):
        P = [i for i, r in enumerate(rows) if pos(r['g'])]
        N = [i for i, r in enumerate(rows) if neg(r['g'])]
        d = V[P].mean(0) - V[N].mean(0)
        axis.dirs.append(d)
        return rank01(V @ d), len(P), len(N)
    axis.dirs = []
    energy, ep, en = axis(lambda g: bool(HIGH_ENERGY.search(g)), lambda g: bool(LOW_ENERGY.search(g)))
    heavy, hp, hn = axis(lambda g: bool(HEAVY.search(g)), lambda g: not HEAVY.search(g))

    # PCA 48 for steering; t-SNE for the map; k-means corners.
    mu = V.mean(0)
    U, S, Wt = np.linalg.svd(V - mu, full_matrices=False)
    P48 = (V - mu) @ Wt[:48].T
    P48 /= np.linalg.norm(P48, axis=1, keepdims=True) + 1e-9
    from sklearn.cluster import KMeans
    from sklearn.manifold import TSNE
    xy = TSNE(n_components=2, metric='cosine', perplexity=30, init='pca', random_state=7).fit_transform(V)
    xy = (xy - xy.min(0)) / (xy.max(0) - xy.min(0))
    km = KMeans(n_clusters=a.clusters, n_init=10, random_state=7).fit(P48)
    lab = km.labels_

    sims = V @ V.T
    np.fill_diagonal(sims, -1)
    nbr = np.argsort(-sims, axis=1)[:, :16]
    density = np.sort(sims, axis=1)[:, -10:].mean(1)  # mean sim to 10 nearest
    quiet = rank01(-density)

    clusters = []
    for c in range(a.clusters):
        ix = np.where(lab == c)[0]
        genres = collections.Counter(rows[i]['g'] for i in ix if rows[i]['g']).most_common(2)
        artists = collections.Counter(rows[i]['a'].split(',')[0].split(' feat')[0] for i in ix).most_common(8)
        kinds = collections.Counter(rows[i]['k'] for i in ix).most_common(1)[0][0]
        clusters.append(dict(id=c, n=int(len(ix)), kind=kinds, genres=[g for g, _ in genres],
                             artists=[x for x, _ in artists],
                             x=float(xy[ix, 0].mean()), y=float(xy[ix, 1].mean()),
                             e=float(energy[ix].mean()), h=float(heavy[ix].mean())))

    gate_counts = quality_gate(rows, cat)

    for i, r in enumerate(rows):
        r.update(x=round(float(xy[i, 0]), 4), yy=round(float(xy[i, 1]), 4), c=int(lab[i]),
                 e=round(float(energy[i]), 3), h=round(float(heavy[i]), 3), q=round(float(quiet[i]), 3),
                 n=[[int(j), round(float(sims[i, j]), 3)] for j in nbr[i]],
                 v=base64.b64encode(np.clip(np.round(P48[i] * 127), -127, 127).astype(np.int8).tobytes()).decode())
    out = dict(schemaVersion=1, generatedAt=__import__('time').strftime('%Y-%m-%dT%H:%M:%SZ', __import__('time').gmtime()),
               model='gemini-embedding-2', dims=48, tracks=rows, clusters=clusters,
               stats=dict(tracks=n, embedded=len(idx), catalogue=len(cat), gaps=gaps,
                          axisSeeds=dict(energy=[ep, en], heavy=[hp, hn]),
                          byKind=dict(collections.Counter(r['k'] for r in rows)), new=sum(r['nw'] for r in rows), gate=gate_counts, glancebarLikes=sum(1 for r in rows if r.get('gl')), scout=sum(1 for r in rows if 'sc' in r)))
    # The model the home worker fetch worker uses to place a newly fetched song exactly as this build would.
    model = Path(a.out).resolve().parent.parent / 'model/space-model.npz'
    model.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(model, mean=mu.astype('<f4'), comps=Wt[:48].astype('<f4'), centers=km.cluster_centers_.astype('<f4'),
                        kinds=np.array(names), kindC=C.astype('<f4'), energyDir=axis.dirs[0].astype('<f4'), heavyDir=axis.dirs[1].astype('<f4'),
                        energySorted=np.sort(V @ axis.dirs[0]).astype('<f4'), heavySorted=np.sort(V @ axis.dirs[1]).astype('<f4'),
                        densitySorted=np.sort(density).astype('<f4'), shas=np.array([r['s'] for r in rows]), xy=xy.astype('<f4'))
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    Path(a.out).write_text(json.dumps(out, separators=(',', ':'), ensure_ascii=False))
    print(json.dumps(out['stats']), Path(a.out).stat().st_size // 1024, 'KB')
    for c in clusters:
        print(c['id'], c['n'], c['kind'], c['genres'], c['artists'], round(c['e'], 2), round(c['h'], 2))


if __name__ == '__main__':
    main()
