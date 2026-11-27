# Devnet proof (2026-11-27)

All on Solana devnet. No real value.

## x402 settlement
- Client: e2e/pay-client.mjs, test wallet Dtjw6SMuNzCRAor2Qf4ywGHBUzeymoDYtA5FtMpb2f5B, 0.02 USDC (devnet mint 4zMMC9sr...JDncDU).
- First attempt failed with `invalid_exact_svm_recipient_ata_missing`: the receiving address had no USDC token account. Created it (permissionless, rent paid by the test wallet): B9fUeKrGry7grVxy6fc58x8WFjhRWS9XYXY6yXNfgfYn.
- Second attempt: HTTP 200, receipt signed, settlement tx
  https://explorer.solana.com/tx/5TDQGsiau8LYGw7nBKbpkddURvYv9ydYY2Qh1uJrZDiQeQ975rmkQkotie4JZBX3gtGQBwmEaTk69YYQStieJxid?cluster=devnet

## Token (token/ folder)
- Mint HVnxsHRmdRiMMJREmA9mBDgWX8nK26yMvHsPLJQRkNNQ, supply 100,000,000 (6 decimals), mint authority none, freeze authority none.
- `node verify-supply.mjs HVnxsHRmdRiMMJREmA9mBDgWX8nK26yMvHsPLJQRkNNQ` prints FIXED SUPPLY CONFIRMED.
- https://explorer.solana.com/address/HVnxsHRmdRiMMJREmA9mBDgWX8nK26yMvHsPLJQRkNNQ?cluster=devnet
- Treasury was the test wallet (devnet only, throwaway). The service does not accept the token yet.
