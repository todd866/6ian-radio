#!/usr/bin/env python3
"""Covers for every song on the map, ahead of the AAC tier (covers are small and fast).

For each song without art in radio/media.json or radio/media-extra.json:
  1. Glancebar's local cover cache (mix/art/<library id>.jpg), matched by artist and title;
  2. else the album art from the iTunes Search API (the same lookup the scout uses), politely
     (about 20 requests a minute, cached, generic User-Agent).
Writes radio/art/<sha>.jpg (600 px) and radio/thumb/<sha>.webp (300 px, for tiles) to R2, then
registers them with the app in batches (POST /api/worker/tracks {medias}). Idempotent.
  python3 tools/covers.py [--limit N]
"""
import argparse, collections, io, json, re, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path

from PIL import Image

HOME = Path.home()
ROOT = Path(__file__).resolve().parent.parent
for _cand in (HOME / 'Projects/music-core/embed', HOME / 'Projects/glancebar/tools/music-embed'):
    if _cand.is_dir() and str(_cand) not in sys.path:
        sys.path.insert(0, str(_cand))
from embed import match_key  # noqa: E402

STATE = HOME / '.local/state/music-radio/covers'
REMOTE = 'r2:music'
ART = HOME / 'Library/Application Support/Glancebar/mix/art'
LIB = HOME / 'Library/Application Support/Glancebar/mix/library.json'
UA = 'radio-covers/1.0 (personal music library tool)'
BASE_URL = 'https://radio.example.com'


def rclone_cat(key):
    p = subprocess.run(['rclone', 'cat', f'{REMOTE}/{key}'], capture_output=True)
    return json.loads(p.stdout) if p.returncode == 0 and p.stdout else {}


def strict_match(res, artist, title):
    """Only a result whose artist matches and whose title shares most words; else None (no art beats
    wrong art: Logic's "Ghost in the Machine" once got another artist's cover)."""
    a0, t0 = match_key(artist, title)
    want = set(t0.split())
    for x in res:
        a1, t1 = match_key(x.get('artistName', ''), x.get('trackName', ''))
        if not a1 or not (a1 == a0 or a1.startswith(a0) or a0.startswith(a1)):
            continue
        got = set(t1.split())
        if want and len(want & got) / len(want) >= 0.6:
            return x['artworkUrl100'].replace('100x100bb', '600x600bb')
    return None


def itunes_art(artist, title, cache):
    k = f'{artist}|{title}'
    if k in cache:
        return cache[k]
    q = urllib.parse.urlencode({'term': f'{artist} {re.sub(r"[\\(\\[].*?[\\)\\]]", "", title)}', 'entity': 'song', 'country': 'au', 'limit': 5})
    url = None
    try:
        with urllib.request.urlopen(urllib.request.Request(f'https://itunes.apple.com/search?{q}', headers={'user-agent': UA}), timeout=20) as r:
            res = [x for x in json.loads(r.read()).get('results', []) if x.get('artworkUrl100')]
        url = strict_match(res, artist, title)
    except Exception as e:
        print('itunes error', str(e)[:80])
        time.sleep(30)
        return None
    cache[k] = url
    time.sleep(3.1)  # ~20 a minute
    return url


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    STATE.mkdir(parents=True, exist_ok=True)
    token = dict(l.split('=', 1) for l in (HOME / '.config/music-radio/worker.env').read_text().splitlines() if '=' in l)['WORKER_TOKEN']
    S = json.loads((ROOT / 'data/space.json').read_text())
    have = {**rclone_cat('radio/media-extra.json'), **{k: v for k, v in rclone_cat('radio/media.json').items() if v.get('art')}}
    lib = collections.defaultdict(list)
    for t in json.loads(LIB.read_text())['tracks']:
        lib[match_key(t.get('artist', ''), t.get('title', ''))].append(t['id'])
    cache_p = STATE / 'itunes-cache.json'
    cache = json.loads(cache_p.read_text()) if cache_p.exists() else {}
    todo = [t for t in S['tracks'] if not (have.get(t['s']) or {}).get('art') or not (have.get(t['s']) or {}).get('thumb')]
    if a.limit:
        todo = todo[:a.limit]
    print(f'{len(todo)} songs need a cover or thumbnail', flush=True)
    batch, done, missing = [], 0, 0
    out = STATE / 'out'; out.mkdir(exist_ok=True)

    def flush():
        nonlocal batch
        if not batch:
            return
        for sub, ext in (('art', 'jpg'), ('thumb', 'webp')):
            subprocess.run(['rclone', 'copy', str(out / sub), f'{REMOTE}/radio/{sub}', '--transfers', '8', '--s3-no-check-bucket'], check=True, capture_output=True)
            for f in (out / sub).glob(f'*.{ext}'):
                f.unlink()
        req = urllib.request.Request(f'{BASE_URL}/api/worker/tracks', data=json.dumps({'medias': batch}).encode(), method='POST',
                                     headers={'authorization': f'Bearer {token}', 'content-type': 'application/json', 'user-agent': UA})
        urllib.request.urlopen(req, timeout=60).read()
        cache_p.write_text(json.dumps(cache))
        batch = []

    (out / 'art').mkdir(exist_ok=True); (out / 'thumb').mkdir(exist_ok=True)
    for i, t in enumerate(todo, 1):
        img = None
        if (have.get(t['s']) or {}).get('art'):  # the master's own cover is already in R2: thumbnail it
            p = subprocess.run(['rclone', 'cat', f"{REMOTE}/radio/art/{t['s']}.jpg"], capture_output=True)
            if p.returncode == 0 and p.stdout:
                img = Image.open(io.BytesIO(p.stdout)).convert('RGB')
        for lid in ([] if img is not None else lib.get(match_key(t['a'], t['t']), [])):
            f = ART / f'{lid}.jpg'
            if f.exists():
                img = Image.open(f).convert('RGB'); break
        if img is None:
            url = itunes_art(t['a'], t['t'], cache)
            if url:
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, headers={'user-agent': UA}), timeout=20) as r:
                        img = Image.open(io.BytesIO(r.read())).convert('RGB')
                except Exception:
                    img = None
        if img is None:
            missing += 1
            continue
        side = min(img.size)
        img = img.crop(((img.width - side) // 2, (img.height - side) // 2, (img.width + side) // 2, (img.height + side) // 2))
        img.resize((600, 600), Image.LANCZOS).save(out / 'art' / f"{t['s']}.jpg", quality=85)
        img.resize((300, 300), Image.LANCZOS).save(out / 'thumb' / f"{t['s']}.webp", quality=80)
        r, g, b = img.resize((1, 1), Image.BOX).getpixel((0, 0))
        batch.append({'s': t['s'], 'art': True, 'thumb': True, 'color': f'#{r:02x}{g:02x}{b:02x}'})
        done += 1
        if len(batch) >= 40:
            flush(); print(f'{i}/{len(todo)}: {done} covers, {missing} not found', flush=True)
    flush()
    print(f'done: {done} covers, {missing} not found', flush=True)


if __name__ == '__main__':
    main()
