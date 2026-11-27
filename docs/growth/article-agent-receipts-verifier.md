# Agent Receipts: post-action verification for AI agents, and how to check a receipt offline

Status: draft for review. Prepared by the project's human-supervised agent team. Not yet published anywhere.

## The problem

When an AI agent says "I deployed the page" or "the record exists", its owner has two options: trust it, or go check by hand. Neither scales. A third party that re-checks the claim against the public world and signs the result turns trust into something you can verify.

## What agent-receipts does

agent-receipts is an outside witness. You tell it what your agent claims it did, it fetches the public evidence itself, and it returns an Ed25519-signed receipt stating what it actually observed.

Live service: https://agent-receipts.amin-experiments.workers.dev

A receipt answers one narrow question: at this moment, did the public world match this claim? It checks only publicly fetchable facts: an HTTP response, a field in a JSON document, a content hash, a DNS record. It does not and cannot confirm counterparty claims such as "payment sent" or "email delivered", because those are not public facts anyone can fetch.

## How a claim becomes a receipt

1. The caller posts a claim: `{check, claim, params}`. Example: `http_contains` with `{"url": "https://example.com", "text": "Example Domain"}`.
2. The service fetches the URL itself, at its own clock time, and records exactly what came back.
3. It evaluates the check against the observed response.
4. It signs the receipt with its Ed25519 key. The public key is published at `/.well-known/receipt-key`, so anyone can verify receipts offline, forever, without trusting the service to stay up.

Fastest path, no account:

```
POST https://agent-receipts.amin-experiments.workers.dev/v1/try
{"check":"http_contains","claim":"I published the page","params":{"url":"https://example.com","text":"Example Domain"}}
```

## What a receipt records

- `passed`: whether the observation matched the claim.
- The observation itself: status code, body excerpt or field value, content hash.
- `observed.source_time`: the service's own fetch time plus the source's `Date`, `Last-Modified`, `Age` and `Expires` headers recorded verbatim, and `skew_seconds`, the difference between the service clock and the source's `Date` header.

One honesty note matters here: the source's timestamps are the source's own claims, not attested time. A source that rewrites its history can fool them. The receipt attests that these bytes were observed at the service's fetch time, and preserves the source's claims alongside for inspection. It does not vouch for them.

## Paying per call, agent to service

The service speaks x402 v2. An agent with a wallet can pay per receipt with no account and no human in the loop: call `/v1/verify` without a payment header, read the 402 response (network, asset, payTo, amount: 0.02 USD per receipt, 0.05 USD per watch), retry with `PAYMENT-SIGNATURE`, and read the settlement from `PAYMENT-RESPONSE`. The live network is announced at `/v1/info` (Solana devnet at the time of writing; test funds only).

For trials without a wallet, there is a fully programmatic free-credit claim: fetch `/v1/claim/challenge`, generate an Ed25519 key, solve a small proof of work, sign the challenge, and receive an API key with 25 trial points. Reference code: `examples/claim-credits.mjs` in the repo.

## Verifying a receipt offline

The point of a signed receipt is that the service is not needed to check it:

1. Fetch the public key from `/.well-known/receipt-key` (or use a copy you pinned earlier).
2. Recompute the receipt fingerprint from its canonical fields. Timing metadata such as `observed.source_time` is deliberately excluded from the fingerprint so that re-fetching the same fact does not change what was attested.
3. Verify the Ed25519 signature over the fingerprint.

The repo ships a standalone verifier so this works with no account and no network calls back to the service. If agent-receipts disappeared tomorrow, every receipt it ever issued would still verify.

## Who this is for

- Agent frameworks that want a post-action check step in their loop.
- Agent owners who want evidence for a counterparty or an audit log.
- Agent-to-agent commerce, where the paying agent wants proof of the public fact it paid for.

## Honest limits

- Public fetchable facts only. No counterparty claims, nothing behind a login.
- A receipt is an observation at a moment in time, not a guarantee about the future.
- Source-supplied timestamps are the source's claims, recorded as-is, not attested time.
