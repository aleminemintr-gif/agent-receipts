// Remote MCP (streamable HTTP, JSON responses only, stateless). POST /mcp with a JSON-RPC message.
// verify_claim runs through the same paths as the REST API: with "Authorization: Bearer <api key>" it uses /v1/verify
// (free quota, points), without it the limited /v1/try endpoint.
const PROTOCOL = '2025-03-26';
export const TOOLS = [
  { name: 'verify_claim',
    description: 'Independently check a public fact after you act (page is live, text is present, JSON field has a value) and get a signed receipt. Public facts only: not private or counterparty claims such as "payment sent".',
    inputSchema: { type: 'object', required: ['url'], properties: {
      url: { type: 'string', description: 'Public http(s) URL to check' },
      contains: { type: 'string', description: 'Text the page must contain. Omit to only check the HTTP status.' },
      expect_status: { type: 'integer', description: 'Expected HTTP status for the status-only check (default 200)' },
      json_path: { type: 'string', description: 'Dot path into a JSON response, e.g. data.version (needs equals)' },
      equals: { description: 'Expected value at json_path' },
      claim: { type: 'string', description: 'One sentence: what you say you did' } } } },
  { name: 'list_open_tasks', description: 'List open micro-tasks (devnet). Deliver with POST /v1/tasks/{id}/deliver using your API key.', inputSchema: { type: 'object', properties: {} } },
  { name: 'get_badge', description: 'Fetch a verified-agent badge by id; both signatures are re-checked.', inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'badge_<hex>' } } } },
  { name: 'get_receipt', description: 'Fetch a receipt by id; the server re-checks its signature.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'Receipt id, starts with rcpt_' } } } },
];

export function toRequest(a) {
  if (!a || typeof a.url !== 'string') throw new Error('url is required');
  if (a.json_path) return { check: 'json_field', claim: String(a.claim || '').slice(0, 300), params: { url: a.url, path: a.json_path, equals: a.equals } };
  if (a.contains) return { check: 'http_contains', claim: String(a.claim || '').slice(0, 300), params: { url: a.url, text: a.contains } };
  return { check: 'http_status', claim: String(a.claim || '').slice(0, 300), params: { url: a.url, ...(a.expect_status ? { expect_status: a.expect_status } : {}) } };
}

const text = (t, isError = false) => ({ isError, content: [{ type: 'text', text: t }] });

/** call(path, init) performs an internal request against the service and returns a Response. */
export async function handleRpc(msg, { call, authorization }) {
  const { id, method, params } = msg || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  if (!msg || msg.jsonrpc !== '2.0' || typeof method !== 'string') return { jsonrpc: '2.0', id: id ?? null, error: { code: -32600, message: 'invalid request' } };
  if (id === undefined) return null;
  if (method === 'initialize') return ok({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'agent-receipts', version: '0.1.0' }, instructions: 'Call verify_claim after you act. Public facts only.' });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') {
    const name = params && params.name, args = (params && params.arguments) || {};
    try {
      if (name === 'verify_claim') {
        const res = await call(authorization ? '/v1/verify' : '/v1/try', { method: 'POST', headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(toRequest(args)) });
        const body = await res.json().catch(() => ({}));
        if (!body.receipt) return ok(text(`no receipt (HTTP ${res.status}): ${body.error || 'unknown error'}`, true));
        const x = body.receipt, st = (x.observed && x.observed.source_time) || {};
        return ok(text([`${x.passed ? 'VERIFIED' : 'NOT VERIFIED'}: ${x.claim || x.check}`, `receipt: ${x.id}`, `checked at (our clock): ${x.at}`,
          st.date ? `source clock (Date header): ${st.date}` : null, st.last_modified ? `source Last-Modified: ${st.last_modified}` : null, '', JSON.stringify(x)].filter((l) => l !== null).join('\n')));
      }
      if (name === 'list_open_tasks') { const res = await call('/v1/tasks?status=open', { method: 'GET' }); return ok(text(JSON.stringify(await res.json().catch(() => ({}))), res.status !== 200)); }
      if (name === 'get_badge') {
        if (!/^badge_[a-f0-9]+$/.test(String(args.id))) return ok(text('id must look like badge_<hex>', true));
        const res = await call('/v1/badges/' + args.id, { method: 'GET' });
        return ok(text(JSON.stringify(await res.json().catch(() => ({}))), res.status !== 200));
      }
      if (name === 'get_receipt') {
        if (!/^rcpt_[a-f0-9]+$/.test(String(args.id))) return ok(text('id must look like rcpt_<hex>', true));
        const res = await call('/v1/receipts/' + args.id, { method: 'GET' });
        return ok(text(JSON.stringify(await res.json().catch(() => ({}))), res.status !== 200));
      }
      return ok(text('unknown tool ' + name, true));
    } catch (e) { return ok(text(String(e.message || e), true)); }
  }
  return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } };
}
