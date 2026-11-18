# Acquisition source (bring your own)

The radio plays what is in your bucket. How songs get there is up to you: rip your CDs, export
your purchases, or connect any source you are licensed to use. No acquisition tooling ships here.

An optional worker can serve listener requests ("play X" when X is not in the library). It talks
to the app over four authenticated endpoints (`Authorization: Bearer $WORKER_TOKEN`):

| Endpoint | Purpose |
|---|---|
| `GET /api/worker/jobs` | Pending requests: `{jobs: [{id, kind: 'play' or 'playlist', query, cap}]}` |
| `POST /api/worker/jobs/[id]` | `{status: 'claimed' or 'done' or 'failed', shas?, note?}` |
| `POST /api/worker/tracks` | Add a finished song: `{track, media}` (track has the `data/space.json` shape, `v` = int8 base64 vector) or a batch of media flags `{medias: [...]}` |
| `POST /api/worker/tunnel` | Report a temporary URL the app may stream a just-fetched song from until it is in R2 |

A minimal worker:

```python
def fetch(query) -> Path:          # your source: return an audio file you are entitled to use
    raise NotImplementedError

def run(job):
    audio = fetch(job["query"])
    sha = sha256(audio)
    upload_aac(audio, f"radio/aac/{sha}.m4a")      # and the cover to radio/art/{sha}.jpg
    vec = embed(audio)                               # the same embedding model as the map
    post("/api/worker/tracks", {"track": {...placed on the map...}, "media": {...}})
    post(f"/api/worker/jobs/{job['id']}", {"status": "done", "shas": [sha]})
```
