# Transparency log, daily roots and the offline verifier

Goal: you should not have to trust the operator. Receipts are signed, chained and committed to a public Merkle root every day, and anyone can check one with a single file and no network.

## What is public

| Endpoint | Content |
|---|---|
| `GET /v1/log?after=SEQ&limit=100` | Append-only list of **commitments only**: `seq`, `id`, `prev`, `at`, `leaf` (hash). Never params, claims, accounts or observations |
| `GET /v1/roots`, `GET /v1/roots/:day` | One signed root statement per sealed UTC day: `root`, `tree_size`, `first_seq`, `last_seq`, `prev_root`, `kid`, `sig`, optional `anchor` |
| `GET /v1/proof/:receipt_id[?include=receipt]` | Audit path from that receipt to its day's root. Only after the day is sealed |
| `GET /.well-known/receipt-key` | Public key (PEM) |

Roots are sealed by the 5-minute cron about 10 minutes after 00:00 UTC for days that had receipts. Each root names the previous one (`prev_root`), so silently dropping a whole day is visible.

## How the tree works

RFC 6962 style: leaf = `sha256(0x00 || canonical_json(receipt))`, node = `sha256(0x01 || left || right)`, split at the largest power of two. The leaf covers the whole signed receipt (including `sig`). Shared code: `src/merkle.mjs`, tested for tree sizes 1 to 17.

The receipt `prev` field is a second, simple chain. Honest limit: two receipts created at the same instant can name the same `prev`. The Merkle root, not `prev`, is the integrity anchor.

## Verify a receipt offline

```bash
curl -s "$B/v1/proof/rcpt_xxx?include=receipt" > proof.json
curl -s "$B/.well-known/receipt-key" > key.pem
node verifier/verify.mjs --bundle proof.json --key key.pem
```

Checks: receipt id matches content, Ed25519 signature, bundle is for this receipt, leaf hash, audit path folds to the published root, root statement signed by the same key, receipt date matches the root's day. Add `--check-anchor` to also look the memo up on Solana (online). Exit code 1 on any failure. The file has no dependencies and its canonical JSON and Merkle code are independent copies, tested against the service's.

What this proves: the operator cannot show you a different receipt than the one it committed to for that day, or change it later, without breaking the root. What it does not prove: that the observed world was real (single witness location), or that the operator did not leave a receipt out before sealing. Anchoring narrows the second point.

## Step 2: Solana memo anchoring (built, switched off until a wallet is funded)

Each sealed root can be written to Solana as an SPL Memo: `agent-receipts:v1:<day>:<root>` (about 100 bytes, fee about 5000 lamports, under one cent). That gives an independent timestamp: the operator cannot later swap the day's root.

- Script: `e2e/anchor-root.mjs <service-url> <day>` builds the memo transaction, sends it, then posts the tx signature to `POST /v1/roots/:day/anchor`.
- The service does **not** trust the poster: it fetches the transaction from Solana RPC and records the anchor only if the memo equals the exact expected string. The first anchor is kept. Anyone, including a third-party watcher, may submit it.
- Key handling: no key in the Worker. Run the script from a machine holding a **dedicated low-balance wallet** (a few cents of SOL), never the owner's main wallet. Mainnet is a deliberate switch (`ANCHOR_CLUSTER=mainnet-beta`, and `SOLANA_RPC` on the Worker). Cost at one anchor per day: about 0.002 USD per year at today's fees.
- Status: transaction format and the acceptance rule are tested with a mocked RPC. Not yet sent on-chain, because there is no funded wallet (devnet faucet is blocked and captchas are not bypassed).

Switch-on checklist: fund the dedicated wallet, run the script for the latest sealed day, confirm `GET /v1/roots/:day` shows `anchor`, add the script to a daily schedule.
