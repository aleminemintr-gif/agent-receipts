# Errors and fixes

A running log of what broke while building this and how it was fixed.

| # | Symptom | Cause | Fix |
|---|---------|-------|-----|
| 1 | `npm test` failed with `MODULE_NOT_FOUND` on `test/` | `node --test test/` treats the folder as a module path on Node 22 | Use a glob: `node --test test/*.test.mjs` |
| 2 | Needed Ed25519 in Workers, where `node:crypto` signing is not guaranteed | Different runtime | Added `worker/receipt-web.mjs` on WebCrypto and a test that the Node verifier accepts Worker-signed receipts |
| 3 | `dns.resolve` does not exist in Workers | No resolver API | DNS check uses DNS-over-HTTPS (cloudflare-dns.com) in the Worker build |
| 4 | Free/point charging could race under concurrent calls | Read-modify-write on accounts | One conditional `UPDATE ... WHERE` decides free vs point in D1 |
| 5 | Deployed `/` returned 404 | Worker code ran before static assets | Added `ASSETS` binding and served `/` from it |
| 6 | Receipt for a self-fetch (Worker checking its own URL) failed | Self-fetch returned 404 (cause not confirmed, likely loopback routing) | Demo uses an external target; the failed receipt was correct behaviour (fail, not fake pass) |
| 7 | Service checking its own URL returned a 404 receipt | Cloudflare error 1042: a Worker cannot fetch another Worker on `*.workers.dev` (the 404 body is the text `error code: 1042`). Found by the new `body_excerpt` field | Worker build now reports an explicit error naming 1042 instead of a misleading status. Limit: targets hosted on workers.dev cannot be verified from this deployment; custom domains and other hosts work. Documented in docs/08-methodology.md |
| 8 | Test harness for cron awaited nothing, so a watch stayed `running` | `ctx.waitUntil` promise was dropped in the test | Test now awaits it. Also added retry for rows stuck in `running` for 10+ minutes |
| 9 | Devnet SOL airdrop from the test script failed (HTTP 410) | The public devnet RPC faucet is closed | Needs a web faucet (captcha); documented in docs/09 and the e2e README step |
| 10 | First live persistence watch (example.com, 5 min) reported drift although the body hash was identical | The fingerprint included response headers; last-modified changed between fetches | Fingerprint now covers only stable content fields (status, final_url, hashes, found/value, DNS records). Headers stay in the receipt as evidence. Test added. |
| 11 | Standalone verifier rejected a correct daily root | The server adds an `anchor` field to the root after signing; the verifier included it in the signed bytes | Verifier strips `anchor` before checking the root signature. Test covers it |
| 12 | Test for two sealed days produced one root | Test changed a receipt's date after a leaf row had been created, so the leaf kept the old day | Test updates the leaf row too. Not a production path (a receipt's `at` never changes) |
| 13 | Known limit, not fixed: two receipts created at the same instant can share a `prev` | `prev` is read before insert, no lock | Documented in docs/10. The daily Merkle root is the integrity anchor, `prev` is a convenience chain |
| 14 | Existing tests assumed accounts get 25 points on creation | Credits moved to the identity claim | Tests use a claim helper (signature + proof of work); bare accounts get free quota only |

## 15. Token work scope reversed twice
Cause: the instruction changed from "cancel coin work" to "build devnet-only utility token tech". Fix: acted only on the later one after checking the owner's own message; the earlier sandbox code was never pushed. Scope kept: devnet only, no mainnet script, no sale, no liquidity, no price claims.

## 16. x402 settle failed: recipient token account missing
Symptom: 402 with invalid_exact_svm_recipient_ata_missing. Cause: the receiving address never held devnet USDC, so it had no associated token account. Fix: created the account (anyone can, payer funds rent), retried, settled. Lesson: create the recipient token account before going live on any network.
