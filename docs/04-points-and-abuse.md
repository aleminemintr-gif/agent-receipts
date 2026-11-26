# Points and abuse

## Design

- 25 points to each of the first 10,000 accounts, once. 1 point = 1 receipt after the 5/day free quota.
- No transfer, no cash-out, no listing, no chain. Points exist only as a number on an account.
- This keeps it a usage credit, not a crypto asset. It is also why we skip a token: tokens invite securities and consumer-protection questions and attract speculators.

## Sybil farming

Accounts are free, so one human can make many. What that gets them: 25 free receipts each. Costs to us: one HTTP fetch per receipt. Mitigations in place: 5 account creations per IP per hour, 60 verifications per IP per minute, SSRF guard so receipts cannot be used to probe our network.

Not solved: someone with many IPs can drain the early pool. Options when it matters: require a proof-of-work on signup, require a verified email or GitHub login, shrink the grant, or tie points to first successful use. Decide after seeing real traffic.

## Abuse of the verifier itself

Using it as a scanner or traffic generator against a third party. Mitigations: rate limits, one GET per check, honest User-Agent. To add: a per-target limit and an opt-out list.
