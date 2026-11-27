# x402 payments (Solana devnet)

Status: **live on devnet, end-to-end settlement not yet proven** (see "What is proven"). No private key exists on the server. The receiving address is the owner's public wallet.

## Flow (x402 V2, scheme `exact`)

1. Client calls `POST /v1/verify` (or `/v1/watches`) with no API key and no payment.
2. Server answers `402` with a base64 `PAYMENT-REQUIRED` header (and the same object in the JSON body): network, amount in base units, asset, `payTo`, and the facilitator's `feePayer`.
3. Client signs a partial Solana transaction for exactly that amount and retries with `PAYMENT-SIGNATURE`.
4. Server compares scheme, network, amount, asset and payTo with **its own** requirements (the client's idea of the price is never trusted), then asks the facilitator to `/verify`, then `/settle`. Verify failing never settles.
5. Server runs the check and returns the receipt. The receipt records the payment (`tx`, payer, network, asset, amount, usd) and the response carries `PAYMENT-RESPONSE`.

Accounts are optional. An account with free quota or points uses those first. When they run out, the 402 offers x402. A paying anonymous caller has no account; anonymous watches are read by their unguessable id.

## Prices

| Call | USD | Base units (6 decimals) |
|---|---|---|
| `POST /v1/verify` | 0.02 | 20000 |
| `POST /v1/watches` (baseline + recheck) | 0.05 | 50000 |

Free tier (5/day) and early points stay.

## Config (wrangler vars, all public)

`PAY_TO`, `X402_NETWORK` (devnet `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`), `X402_ASSET` (devnet USDC mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`), `FACILITATOR_URL` (`https://x402.org/facilitator`, supports Solana devnet `exact` and pays the network fee). Without `PAY_TO`, payments are off.

## Going to mainnet (owner decisions)

Change network to `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp`, asset to mainnet USDC, and use a mainnet facilitator (the public one is devnet only). Money received is the owner's: tax, KYC and any licence questions are his. Do not do this before devnet is proven and terms of service exist.

## Receiving account must exist

The facilitator pays the network fee but does not create the receiver's token account. The owner's wallet needs an associated token account for the asset (a one-time rent of about 0.002 SOL). `e2e/setup-wallet.mjs` creates it for a test mint using a throwaway devnet wallet.

## What is proven

- 402 shape against the real facilitator `/supported` (live fee payer fetched).
- Server logic with a mocked facilitator: amount mismatch rejected before any call, failed verify never settles, receipt records payment, anonymous watch, free quota first (20 tests).
- Not yet: a real devnet settlement. It needs devnet SOL and tokens in a test wallet. The public devnet RPC airdrop is closed (error 410), so faucets with a captcha are the only source.

## Run the end-to-end test

```bash
cd e2e && npm install
PAY_TO=<public address> node setup-wallet.mjs     # prints the test wallet address; fund it with devnet SOL first
node pay-client.mjs https://agent-receipts.amin-experiments.workers.dev
```
