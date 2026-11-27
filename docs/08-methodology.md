# Methodology and receipt fields

Every receipt says how it was produced, so an owner can repeat the check without us. The same text is served live at `GET /v1/methodology`.

## Receipt fields

| Field | Meaning |
|---|---|
| `at` | UTC time the check ran |
| `duration_ms` | How long the check took |
| `observed` | The raw evidence (below). Not just pass or fail |
| `fingerprint` | sha256 of `observed` (no timestamps). Same world, same fingerprint |
| `method` | Name, version, summary and a reproduce command for the check used |
| `prev`, `id`, `sig`, `kid` | Hash chain, content id, Ed25519 signature, key id |

## Raw evidence on HTTP checks

`status`, `final_url`, `redirects`, selected `headers` (content-type, content-length, etag, last-modified, cache-control, server), `body_bytes`, `body_excerpt` (first 300 characters), plus check-specific fields (`body_sha256`, `found`, `value`, `sha256`). Excerpts are not secret-scrubbed: do not point checks at pages that show secrets.

## The checks

| Check | How | Reproduce |
|---|---|---|
| `http_status` | One GET from a Cloudflare Worker, no cookies. Redirects followed by hand (max 4), each hop re-checked against the private-address guard. Passes if final status equals `expect_status` (default 200) | `curl -sL -o /dev/null -w "%{http_code}" URL` |
| `http_contains` | Same GET. Body up to 1,000,000 bytes as UTF-8. Passes if status < 400 and body contains the exact, case-sensitive text | `curl -sL URL \| grep -F "TEXT"` |
| `json_field` | Same GET. Parse JSON, read dot path, compare by JSON equality | `curl -sL URL \| jq .a.b.c` |
| `content_hash` | Same GET. SHA-256 of raw bytes (capped) | `curl -sL URL \| sha256sum` |
| `dns_record` | DNS-over-HTTPS to cloudflare-dns.com. Passes if any record contains the string. Resolver cache can lag | `dig +short TYPE NAME @1.1.1.1` |

## Limits you should know

One witness location (Cloudflare edge). Targets hosted on `*.workers.dev` cannot be checked (Cloudflare error 1042); the receipt says so explicitly. A site may serve different content to us than to you. Pages that need JavaScript or login are not seen. Body above 1 MB is cut, and the hash then covers the cut body.

## Persistence watches

`POST /v1/watches` with `{check, params, claim, recheck_after_minutes}` (5 to 1440). Runs the check now (baseline receipt), then again after N minutes (recheck receipt, checked by a 5-minute cron, so up to about 5 minutes late). `GET /v1/watches/:id` returns the verdict: `drift: true` when the recheck fingerprint differs from the baseline. A page that still passes but changed content is reported as drift. Cost: 2 receipts, paid up front. Max 20 open watches per account.
