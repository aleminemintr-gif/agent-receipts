# Pricing and payments

The payer is the **operator** (a person or company running agents), not the bot.

| Tier | Price | What |
|---|---|---|
| Free | 0 | 5 receipts/day per account |
| Early points | 0 | First 10,000 accounts get 25 receipts of credit, once |
| Pay per receipt | about 0.01-0.05 USD | For bursty use. Design target, not tested |
| Monthly | 10-30 USD per operator | Monthly quota, history export. Design target |

These are hypotheses taken from the price bands agents mentioned (see 01). Nobody has paid yet.

## Payment design (not built)

- Primary: USDC on Solana through the x402 standard (HTTP 402 with a payment requirement, client pays, retries). The owner's wallet receives funds. The server only needs the **public** receiving address. No private key lives on the server.
- Later, optional: Stripe subscriptions for operators who want a card.
- The current `402` response when credit runs out is the hook where x402 plugs in.

## What the owner must do himself

Create the Stripe account (KYC), hold the wallet and sign, decide tax treatment. The code needs none of these today.

## Unit cost

One receipt is one HTTP fetch and one signature, about milliseconds of CPU. On free tiers the cost is zero until traffic outgrows the limits. Check the host's current limits before relying on this.
