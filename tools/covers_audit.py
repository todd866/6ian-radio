#!/usr/bin/env python3
"""Re-check every cover that came from the iTunes search (not the master's own art or Glancebar's
cache) with the strict match; replace a wrong one, or drop the song's art when there is no sure
match. Polite (~20 lookups a minute). python3 tools/covers_audit.py"""
import io, json, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import covers  # noqa: E402
from PIL import Image  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
cache_p = covers.STATE / 'itunes-cache.json'
cache = json.loads(cache_p.read_text())
S = json.loads((ROOT / 'data/space.json').read_text())
base = covers.rclone_cat('radio/media.json')
token = dict(l.split('=', 1) for l in (covers.HOME / '.config/music-radio/worker.env').read_text().splitlines() if '=' in l)['WORKER_TOKEN']
by_key = {f"{t['a']}|{t['t']}": t for t in S['tracks']}
out = covers.STATE / 'audit'; (out / 'art').mkdir(parents=True, exist_ok=True); (out / 'thumb').mkdir(exist_ok=True)
fixed = dropped = ok = 0
batch = []
for k, old in list(cache.items()):
    t = by_key.get(k)
    if not t or not old:
        continue  # not on the map, or never had an iTunes cover (the master's own art is not looked up)
    q = urllib.parse.urlencode({'term': f"{t['a']} {t['t']}", 'entity': 'song', 'country': 'au', 'limit': 10})
    time.sleep(3.1)
    try:
        with urllib.request.urlopen(urllib.request.Request(f'https://itunes.apple.com/search?{q}', headers={'user-agent': covers.UA}), timeout=20) as r:
            res = [x for x in json.loads(r.read()).get('results', []) if x.get('artworkUrl100')]
    except Exception:
        continue
    new = covers.strict_match(res, t['a'], t['t'])
    cache[k] = new
    if new == old:
        ok += 1; continue
    if new is None:
        batch.append({'s': t['s'], 'art': False, 'thumb': False}); dropped += 1
    else:
        with urllib.request.urlopen(urllib.request.Request(new, headers={'user-agent': covers.UA}), timeout=20) as r:
            img = Image.open(io.BytesIO(r.read())).convert('RGB')
        img.resize((600, 600)).save(out / 'art' / f"{t['s']}.jpg", quality=85); img.resize((300, 300)).save(out / 'thumb' / f"{t['s']}.webp", quality=80)
        rr, gg, bb = img.resize((1, 1)).getpixel((0, 0))
        batch.append({'s': t['s'], 'art': True, 'thumb': True, 'color': f'#{rr:02x}{gg:02x}{bb:02x}'}); fixed += 1
    if len(batch) >= 20:
        for sub in ('art', 'thumb'):
            subprocess.run(['rclone', 'copy', str(out / sub), f'{covers.REMOTE}/radio/{sub}', '--s3-no-check-bucket'], capture_output=True)
        urllib.request.urlopen(urllib.request.Request(f'{covers.BASE_URL}/api/worker/tracks', data=json.dumps({'medias': batch}).encode(), method='POST',
                               headers={'authorization': f'Bearer {token}', 'content-type': 'application/json', 'user-agent': covers.UA}), timeout=60).read()
        batch = []
        cache_p.write_text(json.dumps(cache))
        print(f'ok {ok}, fixed {fixed}, dropped {dropped}', flush=True)
if batch:
    for sub in ('art', 'thumb'):
        subprocess.run(['rclone', 'copy', str(out / sub), f'{covers.REMOTE}/radio/{sub}', '--s3-no-check-bucket'], capture_output=True)
    urllib.request.urlopen(urllib.request.Request(f'{covers.BASE_URL}/api/worker/tracks', data=json.dumps({'medias': batch}).encode(), method='POST',
                           headers={'authorization': f'Bearer {token}', 'content-type': 'application/json', 'user-agent': covers.UA}), timeout=60).read()
cache_p.write_text(json.dumps(cache))
print(f'done: ok {ok}, fixed {fixed}, dropped {dropped}')
