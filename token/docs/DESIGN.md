# Design

## Purpose
Credits for the receipt service. Today the service takes USDC via x402. The token would be an alternative way to prepay, nothing more.

## Parameters (proposals, owner decides)
- Classic SPL token, 6 decimals, no extensions (no transfer fee, no hooks), so wallets and explorers read it plainly.
- Fixed supply, minted once, 100,000,000 whole tokens in the current config. The mint authority is then set to none, which cannot be undone. Freeze authority is none from the start.
- Supply is documented in config.json and checkable by anyone with `verify-supply.mjs`.

## Utility model
Service price list in token units (`priceListTokenUnits`), set by the operator. Payment would be an x402-style transfer to the treasury address; the service would verify the transfer, then issue the receipt. Not built: the worker does not accept the token yet. Points (non-transferable loyalty) stay separate and unchanged.

## What this design deliberately does not do
No sale, no presale, no airdrop promise, no liquidity pool, no buyback, no staking yield, no price or return statements. If any of these were added, the project would very likely be treated as a securities-like offering in many jurisdictions.

## Honest risks
- Utility with no users has no use. A token does not create demand for receipts.
- Anyone can create a market for a freely transferable token without our involvement; we cannot stop it and the price may fall to zero.
- Legal status depends on jurisdiction and on how it is distributed and described. An accountant's opinion relayed in chat is not a legal opinion on securities or consumer law. Get written advice from a lawyer for the exact distribution before anything on mainnet.
- Name "Acoin" and symbol ACOIN may collide with existing tokens; check before mainnet. The devnet mint carries no on-chain metadata yet.
- Distribution is unsolved: how users get tokens without a sale is an open question, and the answer drives the legal risk.
