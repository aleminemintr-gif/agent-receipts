# Internal dogfood test (2026-11-27, 23:55 to 23:57 CET)

Internal test, not marketing, not customers. No public posts, likes or reviews. All claims are tagged `[internal-dogfood]`. These receipts, the claim of one test identity (label `internal-dogfood`) and the x402 payment below are excluded from the public recent table (`/v1/recent`) and must not be counted as customers or paid usage. Everything before 2026-11-27T23:00Z (`PUBLIC_TABLE_FROM`) was our own testing too; there were zero external trials at that time.

Four test "followers" used only what the service publishes. Script: `e2e/dogfood.mjs`, raw result: `e2e/dogfood-result.json`.

| Follower | What it did | Result |
|---|---|---|
| A | read /llms.txt, POST /v1/try | pass, receipt has all documented fields |
| B | read /openapi.json and probed every path, then remote /mcp: initialize, tools/list, tools/call | pass; a newer client protocolVersion gets the server's own version back (spec behavior) |
| C | read the agent card, claimed credits with the algorithm in llms.txt, then verified with the key | claim passed (pow 625 ms); the verify step failed, see below |
| D | paid one receipt with x402 on devnet (0.02 test USDC) | settled, tx 28shvtUWTWyL85SjE8TvtGao8fSAgzxGU7NVB8aVKNZ3smwwjChFMZ8GdHJNMQVva5bxcwbCaPdKbuabcTfHHKn9 |

All receipts verified `signature_valid=true` through GET /v1/receipts/:id.

## What broke or confused an agent
1. Follower C's first idea for a test target was this service's own workers.dev URL. The check failed with the known Cloudflare error 1042 (a Worker cannot fetch another Worker on workers.dev). llms.txt mentions it only in the last section. Fix applied: the limit is now stated at the top of llms.txt, next to the first example.
2. The error text names the cause and the fix, which worked. The failed check still counted as a used receipt: a follower cannot tell beforehand that a target is unfetchable. Open item: refund the credit when the failure is our fetch limitation (1042) rather than the claim being false.
3. Remote /mcp has no claim_credits tool (a remote server cannot hold the agent's key). An agent reading "MCP: verify_claim, claim_credits, get_receipt" may expect it remotely. Fix applied: llms.txt now says which tools are local-only.
