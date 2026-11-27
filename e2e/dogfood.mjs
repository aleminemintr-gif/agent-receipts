// INTERNAL DOGFOOD TEST. Not marketing, not customers. All claims start with "[internal-dogfood]".
// Four "agent followers" use only what the service publishes (llms.txt, openapi.json, agent card) and log what is unclear.
//   node e2e/dogfood.mjs https://agent-receipts.amin-experiments.workers.dev  > dogfood-result.json
import crypto from 'node:crypto';
import fs from 'node:fs';
const base = process.argv[2];
const log = [];
const note = (who, step, ok, detail) => { log.push({ who, step, ok, detail }); };
const J = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})), headers: r.headers });
const TAG = '[internal-dogfood] ';
const receipts = [];

// Follower A: reads llms.txt, runs the documented "fastest path".
{
  const txt = await (await fetch(base + '/llms.txt')).text();
  note('A', 'read llms.txt', txt.includes('/v1/try'), `${txt.length} chars`);
  const r = await J(await fetch(base + '/v1/try', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ check: 'http_contains', claim: TAG + 'A try', params: { url: 'https://example.com', text: 'Example Domain' } }) }));
  note('A', 'POST /v1/try', r.status === 200 && r.body.receipt && r.body.receipt.passed, `HTTP ${r.status}`);
  if (r.body.receipt) receipts.push(r.body.receipt.id);
  // Does the doc say how to read the result? Check the receipt has the fields llms.txt names.
  const x = r.body.receipt || {};
  note('A', 'receipt has documented fields (passed, observed, fingerprint, sig)', ['passed', 'observed', 'fingerprint', 'sig'].every((k) => k in x), Object.keys(x).join(','));
  note('A', 'receipt has observed.source_time', !!(x.observed && x.observed.source_time), '');
}

// Follower B: reads openapi.json, checks every path it lists really exists, then uses remote MCP.
{
  const spec = await (await fetch(base + '/openapi.json')).json();
  const missing = [];
  for (const [p, ops] of Object.entries(spec.paths)) for (const m of Object.keys(ops)) {
    if (p.includes('{')) continue;
    const res = await fetch(base + p, { method: m.toUpperCase(), headers: { 'content-type': 'application/json' }, body: m === 'post' ? '{}' : undefined });
    if (res.status === 404 || res.status === 405) missing.push(`${m} ${p} -> ${res.status}`);
  }
  note('B', 'every openapi path answers (not 404/405)', missing.length === 0, missing.join('; '));
  const rpc = async (body) => (await J(await fetch(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))).body;
  const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dogfood-B', version: '0' } } });
  note('B', 'mcp initialize', !!(init.result && init.result.serverInfo), JSON.stringify(init.result && init.result.serverInfo));
  const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  note('B', 'mcp tools/list', Array.isArray(list.result && list.result.tools), (list.result.tools || []).map((t) => t.name).join(','));
  const call = await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'verify_claim', arguments: { url: 'https://example.com', contains: 'Example Domain', claim: TAG + 'B mcp' } } });
  const t = call.result && call.result.content[0].text;
  note('B', 'mcp verify_claim', !!t && t.startsWith('VERIFIED'), t ? t.split('\n')[1] : JSON.stringify(call));
  if (t) receipts.push(t.match(/rcpt_[a-f0-9]+/)[0]);
  // A client may also send the 2025-06 protocol version; the server must not choke.
  const init2 = await rpc({ jsonrpc: '2.0', id: 4, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dogfood-B2', version: '0' } } });
  note('B', 'mcp initialize with newer protocolVersion', !!init2.result, `server answered protocolVersion ${init2.result && init2.result.protocolVersion}`);
}

// Follower C: card -> claim credits exactly as llms.txt describes -> verify with the key.
{
  const card = await (await fetch(base + '/.well-known/agent.json')).json();
  note('C', 'agent card has remote mcp url and x402 auth', !!(card.mcp && card.mcp.remote) && card.authentication.some((a) => a.type === 'x402'), JSON.stringify(card.mcp && card.mcp.remote));
  const kp = crypto.generateKeyPairSync('ed25519');
  const pub = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const ch = (await J(await fetch(base + '/v1/claim/challenge'))).body;
  note('C', 'challenge has fields named in llms.txt (challenge_id, nonce, sign, pow_bits)', ['challenge_id', 'nonce', 'sign', 'pow_bits'].every((k) => k in ch), Object.keys(ch).join(','));
  const bits = (h) => { let c = 0; for (const x of h) { const v = parseInt(x, 16); if (v === 0) { c += 4; continue; } c += Math.clz32(v) - 28; break; } return c; };
  let n = 0; const t0 = Date.now();
  while (bits(crypto.createHash('sha256').update(`${ch.nonce}:${pub}:${n}`).digest('hex')) < ch.pow_bits) n++;
  const sig = crypto.sign(null, Buffer.from(ch.sign), kp.privateKey).toString('base64');
  const cl = await J(await fetch(base + '/v1/claim', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge_id: ch.challenge_id, public_key: pub, signature: sig, pow: String(n), label: 'internal-dogfood' }) }));
  note('C', 'claim with the documented algorithm', cl.status === 201 && !!cl.body.api_key, `HTTP ${cl.status}, pow ${Date.now() - t0}ms, ${cl.body.error || ''}`);
  if (cl.body.api_key) {
    const v = await J(await fetch(base + '/v1/verify', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cl.body.api_key }, body: JSON.stringify({ check: 'json_field', claim: TAG + 'C key', params: { url: base + '/v1/info', path: 'service', equals: 'agent-receipts' } }) }));
    note('C', 'verify with claimed key (json_field on /v1/info)', v.status === 200 && v.body.receipt && v.body.receipt.passed, v.status === 200 ? v.body.receipt.error || 'ok' : `HTTP ${v.status} ${v.body.error}`);
    if (v.body.receipt) receipts.push(v.body.receipt.id);
  }
}

// Verify every receipt through the public endpoint and the standalone verifier path.
const pem = await (await fetch(base + '/.well-known/receipt-key')).text();
for (const id of receipts) {
  const r = (await J(await fetch(base + '/v1/receipts/' + id))).body;
  note('verify', `GET /v1/receipts/${id}`, r.signature_valid === true, `signature_valid=${r.signature_valid}`);
}
fs.writeFileSync(new URL('./.dogfood-receipts.json', import.meta.url), JSON.stringify(receipts));
console.log(JSON.stringify({ at: new Date().toISOString(), receipts, log, key_pem_len: pem.length }, null, 1));
