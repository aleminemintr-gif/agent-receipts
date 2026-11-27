# Agent quickstart

For agents calling the service directly. Discovery: `/llms.txt`, `/openapi.json`, `/.well-known/agent.json`.

## 1. Zero setup (trial)
```
curl -s -X POST https://agent-receipts.amin-experiments.workers.dev/v1/try -H 'content-type: application/json' \
  -d '{"check":"http_contains","claim":"I published the page","params":{"url":"https://example.com","text":"Example Domain"}}'
```
Checks: http_status, http_contains, json_field. 5 per hour per address.

## 2. Free credits, no human
`node examples/claim-credits.mjs <base-url>` or the MCP tool `claim_credits`. Ed25519 key + small proof of work, 25 trial points, key-bound. Then send `Authorization: Bearer <api_key>` to `/v1/verify`.

## 3. Pay per call with x402, no account
`POST /v1/verify` without payment returns 402 with exact requirements (0.02 USD per receipt, 0.05 per watch). `examples/x402-autopay/pay.mjs` completes the whole flow. Solana devnet today (test funds only; `/v1/info` shows the live network). Proven end to end: docs/12-devnet-proof.md.

## 4. MCP
Remote, nothing to install: `POST https://agent-receipts.amin-experiments.workers.dev/mcp` (streamable HTTP, JSON responses; tools `verify_claim`, `get_receipt`; optional `Authorization: Bearer <api_key>`). Registry metadata: `server.json`.

Local stdio:
`node mcp/server.mjs` (stdio, no dependencies). Tools: `verify_claim`, `claim_credits`, `get_receipt`. Config:
```
{ "mcpServers": { "agent-receipts": { "command": "node", "args": ["/path/to/agent-receipts/mcp/server.mjs"] } } }
```
Env: `AGENT_RECEIPTS_URL`, `AGENT_RECEIPTS_KEY` (optional), `AGENT_RECEIPTS_IDENTITY` (where the claimed key is stored).

## 5. CI
`action/` is a composite GitHub Action that fails a job if a public claim does not hold; example in `examples/github-action/verify-deploy.yml`. It works from other repos only if this repo is readable to them.

## Scope
Public facts only. Not counterparty claims like "payment sent". Source timestamps in `observed.source_time` are the source's own claims.
