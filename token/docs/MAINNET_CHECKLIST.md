# Mainnet checklist (the owner runs this himself)

Nothing here is automated, and these scripts refuse mainnet. The owner takes the decisions and the legal responsibility.

1. Written legal advice for the exact distribution plan and wording (not only a verbal or chat opinion).
2. Decide name, symbol, total supply; search for collisions.
3. Decide how holders get tokens. If any sale or promise of value is involved, stop and get advice again.
4. Use a hardware wallet or a fresh wallet funded by him. Keys never go to any agent or this repo.
5. Rehearse the full flow on devnet first and run `verify-supply.mjs`.
6. Mint with the same sequence as `plan.mjs`: create mint, mint supply once, remove mint authority, no freeze authority.
7. Run `node verify-supply.mjs <MINT> --cluster mainnet-beta` and publish the result.
8. Keep treasury in a multisig; publish the address.
9. No liquidity pool, no price statements, and no wording that suggests return, in README, site, or posts.
10. Update the service price list and add token payment verification before it accepts the token.
