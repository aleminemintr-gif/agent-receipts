# Where agents find paid tools (researched 2026-11-27)

Sources are the sites' own docs. Listing text below is ready to paste.

## Entry text (reuse everywhere)
- Name: agent-receipts
- One line: Independent post-action verification for AI agents. Checks a public fact (HTTP status, page text, JSON field, content hash, DNS) and returns an Ed25519-signed receipt with raw evidence and the source's own timestamps.
- Price: 0.02 USD per receipt, 0.05 USD per persistence watch, x402 on Solana (devnet today). Free trial endpoint and key-bound free credits.
- URL: https://agent-receipts.amin-experiments.workers.dev (docs: /llms.txt, /openapi.json, /.well-known/agent.json)
- Repo: https://github.com/aleminemintr-gif/agent-receipts
- Scope: public facts only, not counterparty claims.

## 1. x402 Bazaar (facilitator discovery layer)
https://docs.x402.org/extensions/bazaar . Listing is automatic: the 402 response must carry a `bazaar` discovery declaration, the paying client echoes it, the facilitator catalogs it on verify/settle. PayAI's version also probes the URL first and lists it only after a settled payment (https://docs.payai.network/x402/facilitators/bazaar).
Needs from the owner: nothing. Needs from us: add `extensions.bazaar` (input/output schema) to the 402 and a mainnet settlement; devnet is unlikely to be indexed.

## 2. x402 directories
- x402 List (https://x402-list.com/about): free, submit form at /submit, probes your 402 and reads network and price automatically, manual review. Owner: an email address for the form.
- x402.new (https://x402.new/submit): no form; indexes Bazaar. Comes free after item 1.
- x402dash (https://x402dash.com/submit/): requires USDC on Base. We are on Solana, so not eligible now.

## 3. MCP registries
- Official MCP Registry (https://modelcontextprotocol.io/registry/quickstart, preview): publish metadata with `mcp-publisher`. Package route needs an npm account and `mcpName`; remote-only route needs a public HTTP MCP endpoint. Namespace `io.github.aleminemintr-gif/...` needs a GitHub login by the owner. Our server is stdio only, so the cleanest path is a remote /mcp endpoint on the Worker (not built yet) and a remote-only server.json.
- PulseMCP: submissions paused (page dated 2026-09-03); it says it will pick up Official Registry entries automatically.
- mcp.so (https://mcp.so/submit): free listing needs the GitHub repo URL; $39 paid tier optional (owner decision, we recommend not paying yet).
- Awesome lists (PRs to a public repo, e.g. https://github.com/punkpeye/awesome-mcp-servers and https://github.com/xpaysh/awesome-x402): need a GitHub account to open the PR.

## 4. Agent frameworks and Solana ecosystems
- Solana Agent Kit plugins (https://github.com/sendaifun/solana-agent-kit): plugin architecture; a plugin wrapping our API is a possible PR. Not built.
- ElizaOS plugin registry (https://docs.elizaos.ai/guides/publish-a-plugin): publishing needs an npm package and the owner's account. Not built.

## Account and signature needs
Owner: GitHub login for mcp-publisher (device approval) and for any PR under his account; npm account only if a package route is chosen; an email for x402 List. No wallet signature is needed for listing, but Bazaar cataloging needs a real settled mainnet payment, which is the owner's wallet and decision.
