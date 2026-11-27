# Front 7: agent frameworks and MCP projects — integration proposals

Status: research done, nothing sent. Each proposal below is a prepared issue/discussion text. All must go from the owner's GitHub account after review, with the human-supervised disclosure kept in.

## Targets, ranked by fit

### 1. coinbase/agentkit — https://github.com/coinbase/agentkit
Why first: AgentKit already ships an x402 action provider (PRs #753, #914), so a verification action is a natural sibling: pay 0.02 USD, get a signed receipt, feed it back into the agent loop.

Prepared issue text:
> **Feature: post-action verification action provider (agent-receipts)**
> Agents using AgentKit can pay and act, but nothing closes the loop: after acting, the agent's owner still has to trust that the action matched the public world. agent-receipts (https://github.com/aleminemintr-gif/agent-receipts) is an independent witness: the agent states its claim, the service re-fetches the public fact (HTTP status/body, JSON field, hash) and returns an Ed25519-signed receipt that verifies offline against a published key. It speaks x402 v2 (0.02 USD/receipt), so an AgentKit agent can pay for its own verification with no human step. Scope is public facts only — it does not attest counterparty claims like "payment sent". Proposal: an `agentReceipts` action provider (verify_claim, verify_receipt) plus a README example. Happy to open the PR. (Disclosure: this project is built and operated with human supervision.)

### 2. coinbase/x402 — https://github.com/coinbase/x402
Why: the reference implementation and its ecosystem/examples section is where x402 services get discovered by framework authors.

Prepared text (ecosystem/example submission):
> Example service: pay-per-call post-action verification for agents. A buyer agent pays 0.02 USD over x402 v2 and receives an Ed25519-signed receipt attesting a re-checked public fact, verifiable offline. Repo: https://github.com/aleminemintr-gif/agent-receipts. Live: https://agent-receipts.amin-experiments.workers.dev (network announced at /v1/info). Useful as a worked example of x402 v2 on SVM plus a discovery story (OpenAPI, agent card, llms.txt).

### 3. modelcontextprotocol/servers — https://github.com/modelcontextprotocol/servers
Why: the community-server listing is where MCP clients look first. Our repo ships an MCP server wrapping verify.

Prepared text: add agent-receipts to the community servers list — "MCP server for post-action verification: tools `verify_claim` and `verify_receipt` returning signed receipts for public facts; x402-paid or free-credit auth."

### 4. ComposioHQ/composio — https://github.com/ComposioHQ/composio
Why: Composio is a tool marketplace agents already call; a "verify a claim" tool fits its catalogue model.

Prepared text: integration offer as a Composio tool pack (verify_claim, get_receipt, verify_receipt) with x402 or API-key auth; we maintain the pack.

### 5. vercel/ai (AI SDK) — https://github.com/vercel/ai
Prepared text: a tool-calling example (`tools: { verifyClaim }`) showing a verify-then-report pattern, contributed to examples/docs.

### 6. elizaOS/eliza — https://github.com/elizaOS/eliza
Prepared text: a plugin giving Eliza agents a VERIFY_CLAIM action that returns a signed receipt and teaches the agent to state receipts when it reports actions taken.

### 7. agno-agi/agno — https://github.com/agno-agi/agno
Prepared text: an Agno toolkit (AgentReceiptsToolkit) with cookbook example.

### 8. microsoft/autogen — https://github.com/microsoft/autogen
Prepared text: a tool/example for AutoGen agents: post-action verification step with offline receipt checking.

## Rules for all outreach (kept in every message)
- Human-supervised disclosure stays in the text.
- No coin/token promotion, no price talk beyond the factual per-call price where relevant.
- One issue per repo, no duplicates, no cross-posting the same text as comments.
- Owner's GitHub account sends everything; nothing has been sent yet.
