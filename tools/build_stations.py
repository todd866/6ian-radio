#!/usr/bin/env python3
"""data/stations.json: for each scouted station, the library songs it played (newest first), a
logo (fetched from the station's own site into R2 radio/art/stations/<id>.png) and its public live
stream, kept only if it answers. Private two-listener app: logos are tile art here only.
  python3 tools/build_stations.py
"""
import collections, io, json, re, subprocess, sys, urllib.parse, urllib.request
from pathlib import Path

HOME = Path.home()
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HOME / 'Projects/glancebar/tools/music-embed'))
from embed import match_key  # noqa: E402
from PIL import Image  # noqa: E402

PLAYS = HOME / '.local/state/music-scout/radio-cache/plays'
TRIPLEJ = HOME / '.local/state/selector/plays.jsonl'
REMOTE = 'r2:music'
UA = 'radio-stations/1.0 (personal music library tool)'

STATIONS = [  # id, name, brand colour, home page (for the logo), public live stream candidates
    ('kexp', 'KEXP', '#000000', 'https://www.kexp.org', ['https://kexp.streamguys1.com/kexp160.aac']),
    ('triplej', 'triple j', '#e21e26', 'https://www.abc.net.au/triplej', ['https://mediaserviceslive.akamaized.net/hls/live/2038308/triplejnsw/index.m3u8']),
    ('doublej', 'Double J', '#f5a623', 'https://www.abc.net.au/doublej', ['https://mediaserviceslive.akamaized.net/hls/live/2038316/doublejnsw/index.m3u8']),
    ('rrr', 'RRR', '#0b0b0b', 'https://www.rrr.org.au', ['https://realtime.rrr.org.au/p1h', 'http://realtime.rrr.org.au/p1h']),
    ('pbs', 'PBS', '#1d1d1b', 'https://www.pbsfm.org.au', ['https://playerservices.streamtheworld.com/api/livestream-redirect/3PBS_FM.mp3', 'https://eno.emit.com:8000/pbsfm_live_64.mp3']),
    ('bbc6', '6 Music', '#ff4c98', 'https://www.bbc.co.uk/6music', []),  # live streams are UK-only
    ('nts', 'NTS', '#000000', 'https://www.nts.live', ['https://stream-relay-geo.ntslive.net/stream']),
    ('wfmu', 'WFMU', '#000000', 'https://wfmu.org', ['https://stream0.wfmu.org/freeform-128k']),
    ('4zzz', '4ZZZ', '#f04e23', 'https://4zzz.org.au', ['https://stream.4zzz.org.au/4zzz', 'https://4zzz.out.airtime.pro/4zzz_a']),
    ('rtr', 'RTRFM', '#ec008c', 'https://rtrfm.com.au', ['https://live.rtrfm.com.au/stream1', 'https://live.rtrfm.com.au/stream2']),
    ('kcrw', 'KCRW', '#000000', 'https://www.kcrw.com', ['https://kcrw.streamguys1.com/kcrw_192k_mp3_e24_internet_radio']),
    ('rp', 'Radio Paradise', '#1e3a5f', 'https://radioparadise.com', ['https://stream.radioparadise.com/aac-320']),
]


def get(url, n=None):
    req = urllib.request.Request(url, headers={'user-agent': UA, **({'range': f'bytes=0-{n}'} if n else {})})
    return urllib.request.urlopen(req, timeout=12)


ART_CACHE = HOME / '.local/state/music-radio/covers/itunes-cache.json'
_art = json.loads(ART_CACHE.read_text()) if ART_CACHE.exists() else {}


def itunes_art(artist, title):
    k = f'{artist}|{title}'
    if k in _art:
        return _art[k]
    import time as _t
    _t.sleep(3.1)  # ~20 a minute, as the covers job
    try:
        q = urllib.parse.urlencode({'term': f'{artist} {title}', 'entity': 'song', 'country': 'au', 'limit': 3})
        with get(f'https://itunes.apple.com/search?{q}') as r:
            res = [x for x in json.loads(r.read()).get('results', []) if x.get('artworkUrl100')]
        url = res[0]['artworkUrl100'].replace('100x100bb', '300x300bb') if res else None
    except Exception:
        return None
    _art[k] = url
    ART_CACHE.write_text(json.dumps(_art))
    return url


def live_ok(url):
    if url.endswith('.m3u8'):  # HLS: the playlist answering is enough (Safari plays it natively)
        try:
            with get(url) as r:
                return r.status == 200 and b'#EXTM3U' in r.read(2000)
        except Exception:
            return False
    try:
        with get(url) as r:
            ct = r.headers.get('content-type', '')
            chunk = r.read(4096)
            return r.status in (200, 206) and ('audio' in ct or 'mpeg' in ct or 'aac' in ct or len(chunk) > 1000)
    except Exception:
        return False


def logo(home):
    """apple-touch-icon / og:image / icon link from the station's home page."""
    try:
        with get(home) as r:
            html = r.read(400_000).decode('utf-8', 'ignore')
    except Exception:
        return None
    cands = []
    for pat in (r'<link[^>]+rel=["\']apple-touch-icon[^"\']*["\'][^>]*href=["\']([^"\']+)', r'<link[^>]+href=["\']([^"\']+)["\'][^>]*rel=["\']apple-touch-icon',
                r'<meta[^>]+property=["\']og:image["\'][^>]*content=["\']([^"\']+)', r'<link[^>]+rel=["\'](?:shortcut )?icon["\'][^>]*href=["\']([^"\']+\.(?:png|svg|jpg))'):
        cands += re.findall(pat, html, re.I)
    for c in cands:
        url = urllib.parse.urljoin(home, c)
        if url.endswith('.svg'):
            continue
        try:
            with get(url) as r:
                img = Image.open(io.BytesIO(r.read(3_000_000))).convert('RGBA')
            if min(img.size) >= 96:
                return img
        except Exception:
            continue
    return None


def main():
    S = json.loads((ROOT / 'data/space.json').read_text())
    by_key = {}
    for t in S['tracks']:
        if not t.get('gx'):
            by_key.setdefault(match_key(t['a'], t['t']), t['s'])
    out = []
    for sid, name, color, home, lives in STATIONS:
        plays = []
        f = PLAYS / f'{sid}.json'
        if f.exists():
            for u in json.loads(f.read_text()).get('units', {}).values():
                plays += [(p.get('at') or u.get('at'), p.get('artist', ''), p.get('title', '')) for p in u.get('plays', [])]
        if sid == 'triplej' and TRIPLEJ.exists():
            for l in TRIPLEJ.read_text().splitlines():
                try:
                    p = json.loads(l); plays.append((p.get('played_time') or p.get('at'), p.get('artist', ''), p.get('title', '')))
                except ValueError:
                    pass
        # The station's most-played songs we don't have yet (for "Coming soon" and the lane).
        counts = collections.Counter()
        names_ = {}
        for at, a, t in plays:
            k = match_key(a, t)
            if k[0] and k[1] and k not in by_key and not re.search(r'\b(live|remix|edit)\b', t, re.I):
                counts[k] += 1; names_[k] = (a, t)
        missing = []
        for k, n in counts.most_common(30):
            a_, t_ = names_[k]
            missing.append({'artist': a_, 'title': t_, 'plays': n, 'art': itunes_art(a_, t_)})
        hits = {}
        for at, a, t in sorted(plays, key=lambda x: x[0] or '', reverse=True):
            s = by_key.get(match_key(a, t))
            if s and s not in hits:
                hits[s] = at
        live = next((u for u in lives if live_ok(u)), None)
        img = logo(home)
        has_logo = False
        if img is None:  # no logo to fetch: the name as a wordmark on the brand colour
            from PIL import ImageDraw, ImageFont
            img = Image.new('RGBA', (400, 160), (0, 0, 0, 0))
            d = ImageDraw.Draw(img)
            try:
                font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Black.ttf', 110 if len(name) <= 4 else 70)
            except OSError:
                font = ImageFont.load_default()
            box = d.textbbox((0, 0), name, font=font)
            img = Image.new('RGBA', (box[2] - box[0] + 20, box[3] - box[1] + 20), (0, 0, 0, 0))
            ImageDraw.Draw(img).text((10 - box[0], 10 - box[1]), name, font=font, fill='white')
        if img is not None:
            side = 300
            canvas = Image.new('RGBA', (side, side), color)
            img.thumbnail((int(side * 0.7), int(side * 0.7)))
            canvas.alpha_composite(img, ((side - img.width) // 2, (side - img.height) // 2))
            tmp = Path(f'/tmp/station-{sid}.png') if False else ROOT / f'.station-{sid}.png'
            canvas.convert('RGB').save(tmp)
            has_logo = subprocess.run(['rclone', 'copyto', str(tmp), f'{REMOTE}/radio/art/stations/{sid}.png', '--s3-no-check-bucket'], capture_output=True).returncode == 0
            tmp.unlink()
        out.append({'id': sid, 'name': name, 'color': color, 'live': live, 'liveType': 'hls' if live and live.endswith('.m3u8') else 'direct', 'logo': has_logo, 'count': len(hits),
                    'shas': list(hits)[:200], 'played': {s: (hits[s] or '')[:10] for s in list(hits)[:200]}, 'missing': missing})
        print(f'{name}: {len(plays)} plays, {len(hits)} in the library, live {"yes" if live else "no"}, logo {"yes" if has_logo else "no"}', flush=True)
    (ROOT / 'data/stations.json').write_text(json.dumps({'stations': out}, separators=(',', ':')))


if __name__ == '__main__':
    main()
