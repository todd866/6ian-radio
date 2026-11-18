#!/usr/bin/env python3
"""Nightly fact audit: 50 random songs, the MusicBrainz year (data/years.json) and our album checked
against Apple's catalogue; disagreements and listener flags ("this is wrong") are logged to
~/.local/state/music-radio/fact-audit.jsonl for correction. Apple dates reissues, so a year gap is
evidence to look at, not proof either side is wrong."""
import json, random, re, subprocess, sys, time, unicodedata, urllib.parse, urllib.request
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
LOG = Path.home() / '.local/state/music-radio/fact-audit.jsonl'
UA = '6ian-radio/1.0 ( https://radio.example.com )'


def norm(s):
    s = unicodedata.normalize('NFKD', s or '').encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\s*[\(\[](feat|with|ft)\.?[^\)\]]*[\)\]]', '', s)
    s = re.sub(r'\s*[\(\[][^\)\]]*(remaster|version|edit|deluxe|expanded|anniversary)[^\)\]]*[\)\]]|\s+-\s+(single|ep)$', '', s)
    return re.sub(r'\s+', ' ', re.sub(r'[^a-z0-9 ]+', ' ', s.replace('&', 'and'))).strip()


def primary(a):
    return re.split(r',| & | feat\.? | x ', a, flags=re.I)[0].strip()


S = json.loads((ROOT / 'data/space.json').read_text())['tracks']
Y = json.loads((ROOT / 'data/years.json').read_text()) if (ROOT / 'data/years.json').exists() else {}
day = time.strftime('%Y-%m-%d', time.gmtime())
out = []
for t in random.sample(S, min(50, len(S))):
    q = urllib.parse.urlencode({'term': f"{primary(t['a'])} {re.sub(r'\s*[\(\[].*$', '', t['t'])}", 'entity': 'song', 'country': 'au', 'limit': 15})
    time.sleep(3.1)
    try:
        with urllib.request.urlopen(urllib.request.Request(f'https://itunes.apple.com/search?{q}', headers={'user-agent': UA}), timeout=20) as r:
            res = json.loads(r.read()).get('results', [])
    except Exception:
        continue
    hits = [x for x in res if norm(primary(t['a'])) in norm(x.get('artistName')) and norm(x.get('trackName')) == norm(t['t'])]
    if not hits:
        out.append({'day': day, 'kind': 'no-apple-match', 's': t['s'], 'a': t['a'], 't': t['t']}); continue
    same = [x for x in hits if norm(x.get('collectionName')) == norm(t.get('al'))]
    ay = min(int(x['releaseDate'][:4]) for x in hits if x.get('releaseDate'))
    my = Y.get(t['s'])
    if t.get('al') and not same:
        out.append({'day': day, 'kind': 'album', 's': t['s'], 'a': t['a'], 't': t['t'], 'ours': t['al'], 'apple': sorted({x['collectionName'] for x in hits})[:4]})
    if my and ay and my != ay:
        out.append({'day': day, 'kind': 'year', 's': t['s'], 'a': t['a'], 't': t['t'], 'musicbrainz': my, 'apple_earliest': ay})
    if not my:
        out.append({'day': day, 'kind': 'no-year', 's': t['s'], 'a': t['a'], 't': t['t'], 'apple_earliest': ay})
try:
    # radio/info/flags/admin/<sha>.json (hidden for all) and own/<sha>/<account>.json (that listener)
    keys = [k for k in subprocess.run(['rclone', 'lsf', '-R', '--files-only', 'r2:music/radio/info/flags/'], capture_output=True, text=True, timeout=120).stdout.split() if k.endswith('.json')]
    for k in keys:
        f = json.loads(subprocess.run(['rclone', 'cat', f'r2:music/radio/info/flags/{k}'], capture_output=True, text=True, timeout=60).stdout or '{}')
        parts = k.split('/')  # admin/<sha>.json or own/<sha>/<account>.json
        if parts[0] == 'admin':
            who, s = 'admin', parts[1][:-5]
        elif parts[0] == 'own' and len(parts) == 3:
            who, s = parts[2][:-5], parts[1]
        else:
            continue
        for field, v in (f.get('fields') or {}).items():
            out.append({'day': day, 'kind': 'flag', 's': s, 'by': who, 'field': field, **v})
except Exception:
    pass
with LOG.open('a') as fh:
    for o in out:
        fh.write(json.dumps(o) + '\n')
c = {}
for o in out:
    c[o['kind']] = c.get(o['kind'], 0) + 1
print(json.dumps({'day': day, 'checked': 50, **c}))
