# Errors and fixes

A running log of what broke while building this and how it was fixed.

| # | Symptom | Cause | Fix |
|---|---------|-------|-----|
| 1 | `npm test` failed with `MODULE_NOT_FOUND` on `test/` | `node --test test/` treats the folder as a module path on Node 22 | Use a glob: `node --test test/*.test.mjs` |
| 2 | Needed Ed25519 in Workers, where `node:crypto` signing is not guaranteed | Different runtime | Added `worker/receipt-web.mjs` on WebCrypto and a test that the Node verifier accepts Worker-signed receipts |
| 3 | `dns.resolve` does not exist in Workers | No resolver API | DNS check uses DNS-over-HTTPS (cloudflare-dns.com) in the Worker build |
| 4 | Free/point charging could race under concurrent calls | Read-modify-write on accounts | One conditional `UPDATE ... WHERE` decides free vs point in D1 |
