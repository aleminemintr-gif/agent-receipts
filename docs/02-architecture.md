# Architecture

```
agent --POST /v1/verify--> [api] --charge--> [accounts]
                             |
                             +--> [checks] --pinned public IP--> the outside world
                             |
                             +--> [receipt] canonicalize, hash chain, Ed25519 sign
                             |
                             +--> [store] receipts.jsonl (append only)
```

| File | Role |
|---|---|
| `src/server.mjs` | HTTP routes, rate limits, key loading |
| `src/checks.mjs` | The five checks. Never trusts the claim |
| `src/ssrf.mjs` | Blocks private, loopback, link-local, CGNAT, multicast ranges |
| `src/receipt.mjs` | Canonical JSON, id = hash of content, Ed25519 signature |
| `src/accounts.mjs` | Keys (stored hashed), free quota, points |
| `src/store.mjs` | File-backed store, atomic account writes |

## Receipt format

```json
{
  "v": 1, "account": "acct_...", "check": "http_contains",
  "params": {"url": "...", "text": "..."}, "claim": "I published the page",
  "passed": true, "observed": {"status": 200, "body_sha256": "...", "found": true},
  "error": null, "at": "ISO time", "paid_with": "free",
  "prev": "rcpt_... or null", "kid": "key id", "id": "rcpt_...", "sig": "base64"
}
```

The id is the first 24 hex chars of sha256 over the canonical unsigned body, so editing any field breaks the id and the signature. `prev` chains receipts, so deleting one in the middle is visible to anyone who kept the neighbours.

## Check parameters

- `http_status`: `url`, `expect_status` (default 200)
- `http_contains`: `url`, `text`
- `json_field`: `url`, `path` (dot path), `equals`
- `content_hash`: `url`, `sha256`
- `dns_record`: `name`, `type` (default A), `contains`

## Security choices

- DNS is resolved once, checked, then the connection is pinned to that IP (stops DNS rebinding).
- Redirects are followed manually (max 4) and re-checked each hop.
- Body capped at 1 MB, 8 s timeout, 20 KB request cap.
- API keys are stored as sha256 only.
- Signing key: `SIGNING_KEY_PEM` env var, else `data/signing.key` (mode 600, git-ignored).

## Known limits

- A single witness location. A site can serve different content to our IP. Multi-region witnesses are on the roadmap.
- The service attests what it saw at a moment. It does not prove the agent did the action.
- File store is single-process. Move to SQLite or D1 before running two instances.
