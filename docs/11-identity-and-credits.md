# Agent identity and trial credits

Trial credits (25 receipts for the first 10,000 identities) are tied to an **agent key fingerprint**, not to an anonymous account. No token, no coin, no transfer.

## Flow

1. `GET /v1/claim/challenge` returns `nonce`, `challenge_id`, `pow_bits`.
2. The agent signs `agent-receipts-claim:v1:<nonce>` with its Ed25519 key and finds a counter where `sha256("<nonce>:<public_key_b64>:<counter>")` has at least `pow_bits` leading zero bits.
3. `POST /v1/claim` with `challenge_id`, `public_key` (32 raw bytes, base64), `signature`, `pow`. Without an API key it creates an account and returns the key once. With an API key it binds the identity to that account.
4. Fingerprint = `agent_` + first 16 hex of sha256(public key). One grant per fingerprint, ever. `GET /v1/me` shows it.

Client: `examples/claim-credits.mjs`.

## Limits

| Limit | Value |
|---|---|
| Claims per address per day | 3 (address stored only as a daily hash) |
| Challenge lifetime | 5 minutes, single use |
| Proof of work | 16 bits, +1 bit per 2,000 claimed identities (max 22) |
| Credit-paid receipts per address per day | 150 |
| Points spent per key per day | 20 |
| Free quota | 5 per account per day (unchanged) |
| Bare accounts (no claim) | free quota only, no points |

## Honest limits

A key alone does **not** stop Sybil. Keys cost nothing to generate, so one person can make many identities. What the limits do: each identity costs a few hundred thousand hashes (seconds of CPU), each address can claim 3 a day, and the worst case is bounded: 10,000 identities times 25 receipts is 250,000 cheap HTTP checks in total. An attacker with many addresses could take the whole early pool. If that happens, options are: a higher base difficulty, a verified GitHub or email step, or granting points only after a first successful paid or free use. Credits are a ledger number on an account; no route moves them.
