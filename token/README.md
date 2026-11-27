# token/ (utility credit token, devnet only)

Separate from the service. Nothing in `src/` or `worker/` imports this folder, and it is not deployed.

## What it is
A fixed-supply SPL token meant for one use: paying for receipts and persistence watches at this service,
the same way prepaid credits work. It is not an investment, carries no promise of return, and this repo makes no price claim.

## What exists
- `config.json`: proposed parameters (placeholders: the owner chooses name, symbol and supply).
- `plan.mjs`: pure plan and checks, no network, no keys.
- `deploy-devnet.mjs`: devnet only; creates the mint, mints the whole supply once, then removes the mint authority. Refuses any non-devnet RPC.
- `verify-supply.mjs`: read-only check that a mint is fixed-supply.
- `docs/DESIGN.md`, `docs/MAINNET_CHECKLIST.md`.

## Run
    npm install
    npm test
    node deploy-devnet.mjs --plan --treasury <PUBLIC_ADDRESS>

A real devnet run needs about 0.01 devnet SOL on a throwaway deployer key. Status: not run yet, because the public devnet faucet is closed to us.
There is no mainnet script on purpose.
