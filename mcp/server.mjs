#!/usr/bin/env node
// Minimal MCP server (stdio, newline-delimited JSON-RPC 2.0). No dependencies, Node 20+.
// Tools: verify_claim (get a signed receipt), get_receipt (re-read one).
// Env: AGENT_RECEIPTS_URL (default: the public service), AGENT_RECEIPTS_KEY (optional API key; without it the no-signup /v1/try endpoint is used).
import readline from 'node:readline';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BASE = (process.env.AGENT_RECEIPTS_URL || 'https://agent-receipts.amin-experiments.workers.dev').replace(/\/$/, '');
const IDENTITY_FILE = process.env.AGENT_RECEIPTS_IDENTITY || path.join(os.homedir(), '.agent-receipts', 'identity.json');
const readId = () => { try { return JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf8')); } catch { return null; } };
// An explicit key wins; otherwise a key saved by claim_credits; otherwise the no-signup trial endpoint.
const currentKey = () => process.env.AGENT_RECEIPTS_KEY || (readId() || {}).api_key || '';
const PROTOCOL = '2025-03-26';

export const TOOLS = [
  { name: 'verify_claim',
    description: 'Independently check a public fact after you act (page is live, text is present, JSON field has a value) and get a signed receipt. Public facts only: it cannot confirm private or counterparty claims such as "payment sent".',
    inputSchema: { type: 'object', required: ['url'], properties: {
      url: { type: 'string', description: 'Public http(s) URL to check' },
      contains: { type: 'string', description: 'Text the page must contain (uses http_contains). Omit to only check the HTTP status.' },
      expect_status: { type: 'integer', description: 'Expected HTTP status for the status-only check (default 200)' },
      json_path: { type: 'string', description: 'Dot path into a JSON response, e.g. data.version (uses json_field, needs equals)' },
      equals: { description: 'Expected value at json_path' },
      claim: { type: 'string', description: 'One sentence: what you say you did' } } } },
  { name: 'claim_credits', description: 'Claim free trial credits for this agent, no human needed. Makes an Ed25519 identity (saved locally), solves a small proof of work, and stores the API key so verify_claim uses it. One claim per key.',
    inputSchema: { type: 'object', properties: {} } },
  { name: 'get_receipt', description: 'Fetch a receipt by id and re-check its signature on the server.',
    inputSchema: { type: 'object', required: ['id'], properties: { id: { type: 'string', description: 'Receipt id, starts with rcpt_' } } } },
];

export function toRequest(args) {
  if (!args || typeof args.url !== 'string') throw new Error('url is required');
  let check, params;
  if (args.json_path) { check = 'json_field'; params = { url: args.url, path: args.json_path, equals: args.equals }; }
  else if (args.contains) { check = 'http_contains'; params = { url: args.url, text: args.contains }; }
  else { check = 'http_status'; params = { url: args.url, ...(args.expect_status ? { expect_status: args.expect_status } : {}) }; }
  return { check, claim: String(args.claim || '').slice(0, 300), params };
}

async function api(path, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { 'content-type': 'application/json', ...(currentKey() ? { authorization: 'Bearer ' + currentKey() } : {}), ...(init.headers || {}) } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const powBits = (h) => { let c = 0; for (const x of h) { const v = parseInt(x, 16); if (v === 0) { c += 4; continue; } c += Math.clz32(v) - 28; break; } return c; };
export async function claimCredits() {
  const saved = readId();
  if (saved && saved.api_key) return { content: [{ type: 'text', text: 'Already claimed. Using the saved key in ' + IDENTITY_FILE }] };
  const priv = saved && saved.private ? crypto.createPrivateKey(saved.private) : crypto.generateKeyPairSync('ed25519').privateKey;
  const pub = crypto.createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const ch = (await api('/v1/claim/challenge')).body;
  if (!ch.nonce) return { isError: true, content: [{ type: 'text', text: 'could not get a challenge' }] };
  let n = 0; while (powBits(crypto.createHash('sha256').update(`${ch.nonce}:${pub}:${n}`).digest('hex')) < ch.pow_bits) n++;
  const signature = crypto.sign(null, Buffer.from(ch.sign), priv).toString('base64');
  const r = await api('/v1/claim', { method: 'POST', body: JSON.stringify({ challenge_id: ch.challenge_id, public_key: pub, signature, pow: String(n) }) });
  if (!r.body.api_key) return { isError: true, content: [{ type: 'text', text: `claim failed (HTTP ${r.status}): ${r.body.error || 'unknown'}` }] };
  fs.mkdirSync(path.dirname(IDENTITY_FILE), { recursive: true });
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify({ private: priv.export({ type: 'pkcs8', format: 'pem' }), api_key: r.body.api_key }), { mode: 0o600 });
  return { content: [{ type: 'text', text: `Claimed ${r.body.points_granted} trial points for key ${r.body.fingerprint}. Key saved to ${IDENTITY_FILE}; verify_claim will use it.` }] };
}

export async function callTool(name, args) {
  if (name === 'claim_credits') return claimCredits();
  if (name === 'verify_claim') {
    const r = await api(currentKey() ? '/v1/verify' : '/v1/try', { method: 'POST', body: JSON.stringify(toRequest(args)) });
    if (!r.body.receipt) return { isError: true, content: [{ type: 'text', text: `no receipt (HTTP ${r.status}): ${r.body.error || 'unknown error'}` }] };
    const x = r.body.receipt, st = (x.observed && x.observed.source_time) || {};
    const text = [`${x.passed ? 'VERIFIED' : 'NOT VERIFIED'}: ${x.claim || x.check}`, `receipt: ${x.id}`, `checked at (our clock): ${x.at}`,
      st.date ? `source clock (Date header): ${st.date}` : null, st.last_modified ? `source Last-Modified: ${st.last_modified}` : null,
      `check page: ${BASE}${r.body.verify_url}`, '', JSON.stringify(x)].filter((l) => l !== null).join('\n');
    return { content: [{ type: 'text', text }] };
  }
  if (name === 'get_receipt') {
    if (!args || !/^rcpt_[a-f0-9]+$/.test(String(args.id))) return { isError: true, content: [{ type: 'text', text: 'id must look like rcpt_<hex>' }] };
    const r = await api('/v1/receipts/' + args.id);
    return { isError: r.status !== 200, content: [{ type: 'text', text: JSON.stringify(r.body) }] };
  }
  return { isError: true, content: [{ type: 'text', text: 'unknown tool ' + name }] };
}

export async function handle(msg) {
  const { id, method, params } = msg;
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined) return null; // notifications get no reply
  if (method === 'initialize') return ok({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'agent-receipts', version: '0.1.0' } });
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({ tools: TOOLS });
  if (method === 'tools/call') {
    try { return ok(await callTool(params && params.name, params && params.arguments)); }
    catch (e) { return ok({ isError: true, content: [{ type: 'text', text: String(e.message || e) }] }); }
  }
  return err(-32601, 'method not found');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { return process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); }
    const out = await handle(msg);
    if (out) process.stdout.write(JSON.stringify(out) + '\n');
  });
}
