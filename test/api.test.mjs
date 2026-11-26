import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/server.mjs';
import { sha256 } from '../src/receipt.mjs';

const listen = (srv) => new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ar-'));

async function setup(opts = {}) {
  const target = http.createServer((req, res) => {
    if (req.url === '/json') { res.setHeader('content-type', 'application/json'); return res.end('{"deploy":{"state":"live"}}'); }
    if (req.url === '/missing') { res.statusCode = 404; return res.end('no'); }
    res.end('hello deployed page');
  });
  const tport = await listen(target);
  const app = createApp({ dataDir: tmp(), allowPrivate: true, ...opts });
  const aport = await listen(app.server);
  const api = (p, o = {}) => fetch(`http://127.0.0.1:${aport}${p}`, o).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const post = (p, body, key) => api(p, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify(body) });
  const close = () => { target.close(); app.server.close(); };
  return { api, post, tbase: `http://127.0.0.1:${tport}`, close, app };
}

test('end to end: pass, fail, tamper', async () => {
  const s = await setup();
  const acct = await s.post('/v1/accounts', { label: 'bot-1' });
  assert.equal(acct.status, 201);
  const key = acct.body.api_key;
  assert.equal(acct.body.account.points, 25);

  const ok = await s.post('/v1/verify', { check: 'http_contains', claim: 'page is live', params: { url: s.tbase + '/', text: 'deployed' } }, key);
  assert.equal(ok.body.receipt.passed, true);
  assert.equal(ok.body.receipt.paid_with, 'free');

  const bad = await s.post('/v1/verify', { check: 'http_status', claim: 'page exists', params: { url: s.tbase + '/missing' } }, key);
  assert.equal(bad.body.receipt.passed, false);
  assert.equal(bad.body.receipt.prev, ok.body.receipt.id);

  const js = await s.post('/v1/verify', { check: 'json_field', params: { url: s.tbase + '/json', path: 'deploy.state', equals: 'live' } }, key);
  assert.equal(js.body.receipt.passed, true);

  const h = await s.post('/v1/verify', { check: 'content_hash', params: { url: s.tbase + '/', sha256: sha256('hello deployed page') } }, key);
  assert.equal(h.body.receipt.passed, true);

  const check = await s.post('/v1/receipts/verify', { receipt: ok.body.receipt });
  assert.equal(check.body.valid, true);
  const forged = await s.post('/v1/receipts/verify', { receipt: { ...ok.body.receipt, passed: false } });
  assert.equal(forged.body.valid, false);
  s.close();
});

test('free quota then points then 402; points cannot be transferred', async () => {
  const s = await setup();
  const { body } = await s.post('/v1/accounts', {});
  const key = body.api_key;
  let last;
  for (let i = 0; i < 5 + 25 + 1; i++) {
    last = await s.post('/v1/verify', { check: 'http_status', params: { url: s.tbase + '/' } }, key);
  }
  assert.equal(last.status, 402);
  const me = await s.api('/v1/me', { headers: { authorization: 'Bearer ' + key } });
  assert.equal(me.body.points, 0);
  const t = await s.post('/v1/transfer', { to: 'x', amount: 1 }, key);
  assert.equal(t.status, 404);
  s.close();
});

test('early program closes after the limit', async () => {
  const s = await setup({ earlyLimit: 2 });
  const a = await s.post('/v1/accounts', {});
  const b = await s.post('/v1/accounts', {});
  const c = await s.post('/v1/accounts', {});
  assert.equal(a.body.account.early_rank, 1);
  assert.equal(b.body.account.points, 25);
  assert.equal(c.body.account.points, 0);
  assert.equal(c.body.account.early_rank, null);
  s.close();
});

test('SSRF: private targets yield a failed receipt, not a fetch', async () => {
  const s = await setup({ allowPrivate: false });
  const { body } = await s.post('/v1/accounts', {});
  const r = await s.post('/v1/verify', { check: 'http_status', params: { url: 'http://127.0.0.1:1/' } }, body.api_key);
  assert.equal(r.body.receipt.passed, false);
  assert.match(r.body.receipt.error, /not public/);
  const meta = await s.post('/v1/verify', { check: 'http_status', params: { url: 'http://169.254.169.254/latest/meta-data/' } }, body.api_key);
  assert.match(meta.body.receipt.error, /not public/);
  s.close();
});

test('auth required', async () => {
  const s = await setup();
  const r = await s.post('/v1/verify', { check: 'http_status', params: {} });
  assert.equal(r.status, 401);
  s.close();
});
