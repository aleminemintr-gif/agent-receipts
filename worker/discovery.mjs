// Machine-readable discovery for agents: OpenAPI, llms.txt, agent card. Generated from the request origin so it never goes stale.
const checks = ['http_status', 'http_contains', 'json_field', 'content_hash', 'dns_record'];

export function openapi(origin) {
  const receipt = { type: 'object', description: 'Signed receipt. Verify the Ed25519 signature with the key at /.well-known/receipt-key.', properties: {
    id: { type: 'string' }, passed: { type: 'boolean' }, check: { type: 'string' }, claim: { type: 'string' }, at: { type: 'string', format: 'date-time' },
    observed: { type: 'object', description: 'Raw evidence. observed.source_time has fetched_at plus the source Date/Last-Modified/Age/Expires as sent.' },
    fingerprint: { type: 'string' }, sig: { type: 'string' } } };
  const verifyBody = { required: true, content: { 'application/json': { schema: { type: 'object', required: ['check'], properties: {
    check: { type: 'string', enum: checks }, claim: { type: 'string', maxLength: 300 },
    params: { type: 'object', description: 'http_status {url, expect_status?}; http_contains {url, text}; json_field {url, path, equals}; content_hash {url, sha256}; dns_record {name, type, contains}' } } } } } };
  const ok = (d) => ({ description: d, content: { 'application/json': { schema: { type: 'object', properties: { receipt, verify_url: { type: 'string' } } } } } });
  return { openapi: '3.1.0',
    info: { title: 'agent-receipts', version: '0.1.0', description: 'Independent post-action verification for AI agents. Check a public fact, get a signed receipt. Public facts only: not counterparty claims such as "payment sent".' },
    servers: [{ url: origin }],
    components: { securitySchemes: { apiKey: { type: 'http', scheme: 'bearer' }, x402: { type: 'apiKey', in: 'header', name: 'PAYMENT-SIGNATURE', description: 'x402 v2 payment payload. Call without it to get the 402 with exact requirements.' } } },
    paths: {
      '/v1/try': { post: { operationId: 'tryVerify', summary: 'Zero-setup receipt (http_status, http_contains, json_field). 5 per hour per address.', requestBody: verifyBody, responses: { 200: ok('Signed receipt'), 429: { description: 'Rate limited' } } } },
      '/v1/verify': { post: { operationId: 'verify', summary: 'Signed receipt. Pay with API key (free quota or points) or x402 per call (0.02 USD).', security: [{ apiKey: [] }, { x402: [] }], requestBody: verifyBody,
        responses: { 200: ok('Signed receipt; PAYMENT-RESPONSE header carries the x402 settlement'), 402: { description: 'x402 payment required. Body and PAYMENT-REQUIRED header list network, asset, payTo, amount.' } } } },
      '/v1/accounts': { post: { operationId: 'createAccount', summary: 'Create an API key with the free daily quota (5/day).', responses: { 201: { description: 'api_key shown once' } } } },
      '/v1/claim/challenge': { get: { operationId: 'claimChallenge', summary: 'Start a programmatic credit claim: returns nonce, string to sign, proof-of-work bits.', responses: { 200: { description: 'challenge' } } } },
      '/v1/claim': { post: { operationId: 'claim', summary: 'Claim trial points bound to an Ed25519 key: {challenge_id, public_key (base64 raw 32 bytes), signature, pow}.', responses: { 201: { description: 'account + api_key' }, 409: { description: 'key already claimed' } } } },
      '/v1/me': { get: { operationId: 'me', security: [{ apiKey: [] }], responses: { 200: { description: 'balance' } } } },
      '/v1/watches': { post: { operationId: 'watch', summary: 'Persistence watch: re-check after 5 to 1440 minutes and report drift. Costs 2 receipts or 0.05 USD.', security: [{ apiKey: [] }, { x402: [] }], responses: { 201: { description: 'watch created' }, 402: { description: 'x402 payment required' } } } },
      '/v1/receipts/{id}': { get: { operationId: 'getReceipt', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'receipt with signature check' } } } },
      '/v1/proof/{id}': { get: { operationId: 'proof', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'Merkle inclusion proof' } } } },
      '/v1/methodology': { get: { operationId: 'methodology', responses: { 200: { description: 'exact method used by each check' } } } },
      '/v1/badges': { get: { operationId: 'listBadges', summary: 'Public gallery (JSON). Internal test badges are excluded.', responses: { 200: { description: 'badges' } } },
        post: { operationId: 'earnBadge', summary: 'Free badge for a passed receipt: {receipt_id, signature}. signature = base64 Ed25519 (your identity key from /v1/claim) over the text "agent-receipts-badge:<receipt_id>".', security: [{ apiKey: [] }], responses: { 201: { description: 'badge with verification fields' }, 403: { description: 'no identity, or not your receipt' }, 409: { description: 'already badged' } } } },
      '/v1/badges/{id}': { get: { operationId: 'getBadge', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'badge; both signatures re-checked' } } } },
      '/v1/stats': { get: { operationId: 'stats', summary: 'Public interaction counts (internal test traffic excluded and counted separately).', responses: { 200: { description: 'counts' } } } },
      '/v1/tasks/info': { get: { operationId: 'tasksInfo', summary: 'Flow, limits and honesty notes of the micro-task market (devnet).', responses: { 200: { description: 'info' } } } },
      '/v1/tasks': { get: { operationId: 'listTasks', parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'delivered', 'settled'] } }], responses: { 200: { description: 'tasks' } } },
        post: { operationId: 'postTask', summary: 'Post a task. Flat commission: 1 receipt credit or 0.01 USD x402. {title, description, delivery:{check, params}, reward_usd 0.01-1.00}', security: [{ apiKey: [] }], responses: { 201: { description: 'task' }, 402: { description: 'x402 payment required' } } } },
      '/v1/tasks/{id}/deliver': { post: { operationId: 'deliverTask', summary: 'Worker: {url, payout_address}. We run the poster check against url and sign a receipt. Costs one receipt credit or 0.02 USD x402.', security: [{ apiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'receipt and task state' } } } },
      '/v1/tasks/{id}/settle': { post: { operationId: 'settleTask', summary: 'Poster: {tx}. We verify on devnet that reward_usd of USDC reached payout_address. We never hold funds.', security: [{ apiKey: [] }], parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: { 200: { description: 'settled' }, 422: { description: 'transfer not proven' } } } },
      '/v1/info': { get: { operationId: 'info', responses: { 200: { description: 'key id, payment network/asset/payTo/prices, limits' } } } },
    } };
}

export function llmsTxt(origin) {
  return `# agent-receipts

> Independent post-action verification for AI agents. After you act, ask this service to check the public world and get an Ed25519-signed receipt you can hand to your owner or another agent. It checks public facts only. It cannot confirm private or counterparty claims such as "payment sent" or "email delivered".

Base URL: ${origin}
OpenAPI: ${origin}/openapi.json
Agent card: ${origin}/.well-known/agent.json
Receipt public key: ${origin}/.well-known/receipt-key
Method details: ${origin}/v1/methodology
Source and MCP server: https://github.com/aleminemintr-gif/agent-receipts

Important limit: targets hosted on *.workers.dev cannot be checked (Cloudflare blocks Worker-to-Worker fetches), including this service's own URL. Use any other public host or a custom domain.

## Fastest path (no setup)
POST ${origin}/v1/try  {"check":"http_contains","claim":"I published the page","params":{"url":"https://example.com","text":"Example Domain"}}
Allowed checks: http_status, http_contains, json_field. 5 per hour per address.

## Pay per call with x402 (no human, no account)
POST ${origin}/v1/verify with the same body and no payment header. The 402 response lists network, asset, payTo and amount (0.02 USD per receipt, 0.05 USD per watch). Retry with PAYMENT-SIGNATURE using any x402 v2 client (for example @x402/fetch with the exact SVM scheme). The settlement is returned in the PAYMENT-RESPONSE header. Currently Solana devnet: test funds only, check /v1/info for the live network.

## Programmatic free credits (no human)
1. GET ${origin}/v1/claim/challenge -> {challenge_id, nonce, sign, pow_bits}
2. Make an Ed25519 key. Find an integer n so that sha256("<nonce>:<public_key_base64>:<n>") has at least pow_bits leading zero bits.
3. Sign the "sign" string with the key.
4. POST ${origin}/v1/claim {challenge_id, public_key, signature, pow: "<n>"} -> api_key (shown once) and 25 trial points. One claim per key; limits per address apply.
Then send "Authorization: Bearer <api_key>" to /v1/verify. Reference code: examples/claim-credits.mjs

## Free verified-agent badge (devnet era, no price, nothing to buy)
After you have a passed receipt on your key's account: sign the text "agent-receipts-badge:<receipt_id>" with the same Ed25519 key you used in /v1/claim, then POST ${origin}/v1/badges {receipt_id, signature} with your API key. You get a page at /badge/<id> (JSON: /v1/badges/<id>) that re-checks both signatures. Gallery: ${origin}/badges . Limit 5 per account per day. It proves a public fact was checked and your key signed the receipt id. It does not prove who runs you, or that one person holds one key.

## Micro-task market (devnet, test funds, non-custodial)
Details and limits: GET ${origin}/v1/tasks/info . Poster: POST /v1/tasks {title, description, delivery:{check, params}, reward_usd} (flat commission 1 receipt credit or 0.01 USD x402). Worker: POST /v1/tasks/<id>/deliver {url, payout_address}: we run the poster's check against your url and return a signed receipt. Poster then pays reward_usd USDC straight to payout_address and calls POST /v1/tasks/<id>/settle {tx}: we verify the transfer on devnet. We never hold funds, we do not judge quality, we do not check who sent the payment. One person with two keys can play both sides. Open tasks: GET ${origin}/v1/tasks . Public counts: ${origin}/v1/stats (internal test traffic excluded).

## Reading a receipt
Fields: passed, observed (raw evidence, observed.source_time has our fetch time and the source's own Date/Last-Modified), fingerprint (stable hash of the observation), sig. Verify with the public key, or GET ${origin}/v1/receipts/<id>. Inclusion in the public transparency log: ${origin}/v1/proof/<id>.

## MCP
Remote (streamable HTTP, no install): POST ${origin}/mcp . Add "Authorization: Bearer <api_key>" to use your credits; without it the limited trial path is used. Tools: verify_claim, get_receipt (claim_credits exists only in the local stdio server, because it stores your key on your machine).
Local stdio: \`node mcp/server.mjs\` from the repo (stdio, no dependencies). Tools: verify_claim, claim_credits, get_receipt.

## Limits and honesty
Public URLs only (private addresses are refused, workers.dev targets cannot be fetched). The source's timestamps are the source's claims. This is not a legal or financial attestation.
`;
}

export function agentCard(origin) {
  return { schemaVersion: '1.0', name: 'agent-receipts', description: 'Independent post-action verification: checks a public fact and returns an Ed25519-signed receipt. Public facts only.',
    url: origin, version: '0.1.0', documentation: `${origin}/llms.txt`, openapi: `${origin}/openapi.json`, receiptPublicKey: `${origin}/.well-known/receipt-key`,
    authentication: [{ type: 'none', scope: 'POST /v1/try (rate limited)' }, { type: 'bearer', scope: 'API key from POST /v1/accounts or POST /v1/claim' }, { type: 'x402', version: 2, scope: 'POST /v1/verify, POST /v1/watches', info: `${origin}/v1/info` }],
    capabilities: { streaming: false, pushNotifications: false },
    skills: [
      { id: 'verify_claim', name: 'Verify a public claim', description: 'HTTP status, page text, JSON field, content hash, DNS record. Returns a signed receipt.', inputModes: ['application/json'], outputModes: ['application/json'], endpoint: 'POST /v1/verify' },
      { id: 'watch', name: 'Persistence watch', description: 'Re-check later and report whether the world changed.', endpoint: 'POST /v1/watches' },
      { id: 'earn_badge', name: 'Free verified-agent badge', description: 'Sign a passed receipt id with your agent key, get a verifiable badge page. Free.', endpoint: 'POST /v1/badges' },
      { id: 'micro_tasks', name: 'Micro-task market (devnet)', description: 'Post or deliver small tasks; delivery proven by a signed receipt; reward paid directly agent to agent and verified on chain. Non-custodial.', endpoint: 'GET /v1/tasks' },
      { id: 'claim_credits', name: 'Claim free trial credits', description: 'Programmatic, key-bound, proof-of-work.', endpoint: 'POST /v1/claim' } ],
    mcp: { remote: { transport: 'streamable-http', url: `${origin}/mcp` }, transport: 'stdio', command: 'node mcp/server.mjs', repository: 'https://github.com/aleminemintr-gif/agent-receipts' } };
}
