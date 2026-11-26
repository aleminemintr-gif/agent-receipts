# Free-tier deployment

Needs: Node 20+, persistent disk for `data/` (receipts and accounts), env var `SIGNING_KEY_PEM` or a persistent `data/signing.key`.

Candidates (verify current free limits before use, they change):
- A free container host with a small persistent volume (simplest, no code change).
- A serverless platform: needs the store swapped for its database (small change in `src/store.mjs`).

Rules: never set `ALLOW_PRIVATE`. Back up the signing key; losing it means old receipts cannot be verified against a new key (publish key history under `/.well-known/`).

Deployment is done by the owner from his own account. Nothing here needs a card.
