#!/usr/bin/env python3
"""Original release year for every song, from MusicBrainz only: the earliest first-release-date
among recordings whose artist and title match, else the first release of the album's release
group (not for compilations). No match -> no year. File tags and library years are never used
(Sure Shot showed 2005, a reissue; Ill Communication is 1994). Cached per song; writes
data/years.json {sha: year|null}. Polite: one MusicBrainz request a second."""
import json, re, subprocess, sys, time, urllib.parse, urllib.request
from pathlib import Path
HOME = Path.home()
sys.path.insert(0, str(HOME / 'Projects/glancebar/tools/music-embed'))
from embed import match_key  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
CACHE = HOME / '.local/state/music-radio/years-cache.json'
UA = '6ian-radio/1.0 ( https://radio.example.com )'
COMP = re.compile(r'essential|greatest|best of|hits|collection|anthology|gold|definitive|playlist|now that', re.I)
cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
last = [0.0]


def mb(path, q):
    wait = 1.1 - (time.time() - last[0])
    if wait > 0:
        time.sleep(wait)
    last[0] = time.time()
    url = f'https://musicbrainz.org/ws/2/{path}?{urllib.parse.urlencode({**q, "fmt": "json"})}'
    for _ in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'user-agent': UA}), timeout=30) as r:
                return json.loads(r.read())
        except Exception:
            time.sleep(3)
    return None


def primary(artist):
    return re.split(r',| & | feat\.? | x ', artist, flags=re.I)[0].strip()


def clean(title):
    t = re.sub(r'\s*[\(\[](feat|with|ft)\.?[^\)\]]*[\)\]]', '', title, flags=re.I)
    t = re.sub(r'\s*[\(\[][^\)\]]*remaster[^\)\]]*[\)\]]|\s+-\s+.*remaster.*$', '', t, flags=re.I)
    return t.strip()


def esc(s):
    return re.sub(r'([+\-&|!(){}\[\]^"~*?:\\/])', r'\\\1', s)


def year(artist, title, album):
    a0 = match_key(primary(artist), '')[0]
    t0 = match_key('', clean(title))[1]
    ys = []
    r = mb('recording', {'query': f'recording:"{esc(clean(title))}" AND artist:"{esc(primary(artist))}"', 'limit': 50})
    for rec in (r or {}).get('recordings', []):
        if rec.get('score', 0) < 70 or match_key('', rec.get('title', ''))[1] != t0:
            continue
        names = ' '.join(match_key(ac.get('name', ''), '')[0] for ac in rec.get('artist-credit', []) if isinstance(ac, dict))
        if a0 not in names:
            continue
        d = (rec.get('first-release-date') or '')[:4]
        if d.isdigit() and int(d) >= 1900:
            ys.append(int(d))
    if ys:
        return min(ys), 'recording'
    if album and not COMP.search(album):
        r = mb('release-group', {'query': f'releasegroup:"{esc(clean(album))}" AND artist:"{esc(primary(artist))}"', 'limit': 5})
        for g in (r or {}).get('release-groups', []):
            names = ' '.join(match_key(ac.get('name', ''), '')[0] for ac in g.get('artist-credit', []) if isinstance(ac, dict))
            if g.get('score', 0) >= 90 and a0 in names and match_key('', g.get('title', ''))[1] == match_key('', clean(album))[1]:
                d = (g.get('first-release-date') or '')[:4]
                if d.isdigit():
                    return int(d), 'album'
    return None, 'none'


def main():
    tracks = json.loads((ROOT / 'data/space.json').read_text())['tracks']
    try:
        ex = json.loads(subprocess.run(['rclone', 'cat', 'r2:music/radio/extra.json'], capture_output=True, text=True, timeout=120).stdout)
        tracks += ex.get('tracks', [])
    except Exception:
        pass
    out, n = {}, 0
    for t in tracks:
        k = f"{t['a']}|{t['t']}|{t.get('al') or ''}"
        if k not in cache:
            y, how = year(t['a'], t['t'], t.get('al') or '')
            cache[k] = [y, how]
            n += 1
            if n % 25 == 0:
                CACHE.write_text(json.dumps(cache)); print(f'{n} looked up', flush=True)
        out[t['s']] = cache[k][0]
    CACHE.write_text(json.dumps(cache))
    (ROOT / 'data/years.json').write_text(json.dumps(out, separators=(',', ':')))
    print(f'done: {n} new, {sum(1 for v in out.values() if v)} with a year, {sum(1 for v in out.values() if not v)} without')


if __name__ == '__main__':
    if len(sys.argv) == 4:
        print(year(*sys.argv[1:]))
    else:
        main()
