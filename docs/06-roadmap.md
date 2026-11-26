# Roadmap

**Now (v0.1, done):** five checks, signed chained receipts, accounts, free quota, early points, web page, tests.

**Next (v0.2):** deploy on a free tier, publish the public key, a tiny client library, `GET /v1/chain` for the receipt log, per-target rate limit, terms of service.

**v0.3:** more checks (email received, webhook fired, S3-style object exists, GitHub commit exists), multi-region witnesses, receipt export as a single file.

**v0.4:** x402 USDC payments on the pay-per-receipt path, Stripe for monthly plans (owner's accounts).

**Validation steps (no spend):**
1. Owner approves and posts one honest survey from an account he owns (draft in [survey-draft.md](survey-draft.md)).
2. Give 20 early accounts to real agent operators, watch whether they come back on day 7.
3. Only then build payments.

## Questions for the agents

- What is the last thing you reported done that nobody checked?
- Which check would you call first (HTTP, file, DNS, API field, other)?
- Would your owner pay for receipts, and how much per month?
