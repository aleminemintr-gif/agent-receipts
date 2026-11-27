# Front 5: open-source distribution — directories and lists, with prepared entries

Status: research done, nothing submitted. Every entry below says what it needs. "Owner account" means the listing or PR must come from the owner's GitHub/account identity.

Service facts used below (from https://agent-receipts.amin-experiments.workers.dev/llms.txt, observed 2026-11-27): Ed25519-signed receipts for public facts; x402 v2 pay-per-call (0.02 USD/receipt, Solana devnet at time of writing); programmatic free-credit claim; MCP server in repo; OpenAPI at /openapi.json; agent card at /.well-known/agent.json.

## A. MCP registries (highest value: agents actually search these)

1. Official MCP Registry — https://modelcontextprotocol.io/registry/quickstart
   - Publish `server.json` for the MCP server in the repo. Auth is GitHub-based, tied to the repo namespace.
   - Needs: owner's GitHub account (aleminemintr-gif) to publish under that namespace. Repo: https://github.com/modelcontextprotocol/registry
2. Smithery — https://www.smithery.ai/ (publish docs: https://smithery.mintlify.dev/docs/build/publish)
   - Publish via Smithery CLI from the repo. Needs: account on smithery.ai (owner or builder).
3. Glama — https://glama.ai/ (indexing: https://glama.ai/mcp/methodology)
   - Indexes MCP servers from public GitHub. Action: make sure the repo's MCP server has a clean README + `server.json`/manifest, then claim the listing on Glama. Needs: account to claim.

## B. x402 directories (where wallet-holding agents look)

4. x402.new — https://x402.new/ — has a Submit route. Needs: submit form; no account creation done yet.
5. CDP x402 Bazaar — https://docs.cdp.coinbase.com/x402/bazaar and https://docs.x402.org/extensions/bazaar
   - Caveat: the Bazaar indexes services whose payments settle through the CDP Facilitator. Our service currently settles via its own x402 v2 flow on Solana. Listing here requires either adopting the CDP facilitator or declaring Bazaar extension metadata that a CDP-indexed payment would carry. Decision needed before this one is actionable.

## C. Awesome lists (PRs; prepared text below)

6. https://github.com/punkpeye/awesome-mcp-servers
7. https://github.com/appcypher/awesome-mcp-servers
8. https://github.com/xpaysh/awesome-x402
9. https://github.com/tsubasakong/awesome-agent-payments-protocol
   - Needs: owner's GitHub account to open the PRs (they represent the project).

### Prepared PR / listing text (adapt per list's format)

> **agent-receipts** — Independent post-action verification for AI agents. An agent states what it did; the service re-checks the public world (HTTP status/body, JSON field, hash) and returns an Ed25519-signed receipt that verifies offline against a published key. x402 v2 pay-per-call (0.02 USD/receipt), programmatic free trial credits, OpenAPI + agent card + MCP server. Public facts only — it does not attest counterparty claims like "payment sent".
> https://agent-receipts.amin-experiments.workers.dev — https://github.com/aleminemintr-gif/agent-receipts

Short version for one-line lists:

> [agent-receipts](https://github.com/aleminemintr-gif/agent-receipts) - Post-action verification for AI agents: signed, offline-verifiable receipts for public facts, with x402 pay-per-call and an MCP server.
