import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// A tiny fake service so the client code is tested end to end without the network.
const seen = [];
const receipt = (passed) => ({ id: 'rcpt_abc123', claim: 'c', check: 'http_status', passed, at: '2026-11-28T00:00:00Z', observed: { source_time: { date: 'Sat, 28 Nov 2026 00:00:00 GMT', last_modified: null } } });
let okMode = true;
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    seen.push({ url: req.url, auth: req.headers.authorization || null, body: b ? JSON.parse(b) : null });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/try' || req.url === '/v1/verify') return res.end(JSON.stringify({ receipt: receipt(okMode), verify_url: '/v1/receipts/rcpt_abc123' }));
    if (req.url === '/v1/receipts/rcpt_abc123') return res.end(JSON.stringify({ valid: true }));
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;
test.after(() => srv.close());

test('mcp: initialize, list tools, call verify_claim over stdio', async () => {
  const p = spawn('node', ['mcp/server.mjs'], { env: { ...process.env, AGENT_RECEIPTS_URL: base, AGENT_RECEIPTS_KEY: '', AGENT_RECEIPTS_IDENTITY: path.join(os.tmpdir(), 'ar-id-' + process.pid + '.json') }, stdio: ['pipe', 'pipe', 'inherit'] });
  const lines = []; let buf = '';
  p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { lines.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
  const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
  const waitFor = async (id) => { for (let i = 0; i < 100; i++) { const m = lines.find((l) => l.id === id); if (m) return m; await new Promise((r) => setTimeout(r, 30)); } throw new Error('timeout ' + id); };
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal((await waitFor(1)).result.serverInfo.name, 'agent-receipts');
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual((await waitFor(2)).result.tools.map((t) => t.name), ['verify_claim', 'claim_credits', 'get_receipt']);
  send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'verify_claim', arguments: { url: 'https://example.com', contains: 'Example', claim: 'live' } } });
  const r = await waitFor(3);
  assert.match(r.result.content[0].text, /^VERIFIED/);
  assert.match(r.result.content[0].text, /source clock/);
  const call = seen.find((s) => s.url === '/v1/try');
  assert.equal(call.body.check, 'http_contains'); assert.equal(call.auth, null);
  send({ jsonrpc: '2.0', id: 4, method: 'nope' });
  assert.equal((await waitFor(4)).error.code, -32601);
  send({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_receipt', arguments: { id: '../etc' } } });
  assert.equal((await waitFor(5)).result.isError, true);
  p.kill();
});

test('action script: exit 0 on pass, 1 on fail, writes receipt and outputs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ar-'));
  const run = () => new Promise((res) => { const c = execFile('node', ['action/verify.mjs'], { env: { ...process.env, AR_URL: 'https://example.com', AR_API_URL: base, AR_API_KEY: 'k1', AR_OUT: path.join(dir, 'r.json'), GITHUB_OUTPUT: path.join(dir, 'out') }, encoding: 'utf8' }, (e, stdout, stderr) => res({ status: e ? e.code : 0, stdout, stderr })); });
  return (async () => {
    okMode = true; let r = await run();
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /VERIFIED rcpt_abc123/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'r.json'))).id, 'rcpt_abc123');
    assert.match(fs.readFileSync(path.join(dir, 'out'), 'utf8'), /passed=true/);
    assert.equal(seen.at(-1).auth, 'Bearer k1');
    okMode = false; r = await run(); assert.equal(r.status, 1); assert.match(r.stdout, /NOT VERIFIED/);
  })();
});
