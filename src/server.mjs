import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { Accounts, EARLY_LIMIT, EARLY_POINTS, FREE_PER_DAY } from './accounts.mjs';
import { generateKeyPair, loadKeyPair, signReceipt, verifyReceipt, keyId } from './receipt.mjs';
import { runCheck, CHECKS } from './checks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp({ dataDir = process.env.DATA_DIR || path.join(here, '..', 'data'), allowPrivate = false, earlyLimit } = {}) {
  const store = new Store(dataDir);
  const accounts = new Accounts(store, { earlyLimit });
  const keyFile = path.join(dataDir, 'signing.key');
  let keys;
  if (process.env.SIGNING_KEY_PEM) keys = loadKeyPair(process.env.SIGNING_KEY_PEM);
  else if (fs.existsSync(keyFile)) keys = loadKeyPair(fs.readFileSync(keyFile, 'utf8'));
  else {
    const kp = generateKeyPair();
    fs.writeFileSync(keyFile, kp.privatePem, { mode: 0o600 });
    keys = loadKeyPair(kp.privatePem);
  }

  // Crude per-IP limiter for account creation and checks.
  const hits = new Map();
  const limited = (ip, bucket, max, windowMs) => {
    const k = bucket + ip, now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    arr.push(now); hits.set(k, arr);
    return arr.length > max;
  };

  const send = (res, code, obj) => {
    const body = JSON.stringify(obj, null, 2);
    res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    res.end(body);
  };
  const readJson = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 20_000) { reject(new Error('body too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('invalid json')); } });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const ip = req.socket.remoteAddress || '?';
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' }); return res.end(); }

      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(here, '..', 'public', 'index.html')));
      }
      if (req.method === 'GET' && url.pathname === '/v1/info') {
        return send(res, 200, {
          service: 'agent-receipts', version: '0.1.0', key_id: keyId(keys.publicPem),
          checks: Object.keys(CHECKS), free_per_day: FREE_PER_DAY,
          early_program: { limit: EARLY_LIMIT, points_each: EARLY_POINTS, taken: accounts.count(), open: accounts.count() < accounts.earlyLimit,
            note: 'Points are non-transferable credits for receipts. Not a token.' },
        });
      }
      if (req.method === 'GET' && url.pathname === '/.well-known/receipt-key') {
        res.writeHead(200, { 'content-type': 'application/x-pem-file' });
        return res.end(keys.publicPem);
      }
      if (req.method === 'POST' && url.pathname === '/v1/accounts') {
        if (limited(ip, 'acct', 5, 3600_000)) return send(res, 429, { error: 'too many accounts from this address, try later' });
        const body = await readJson(req);
        return send(res, 201, accounts.create({ label: body.label }));
      }

      const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
      if (req.method === 'GET' && url.pathname === '/v1/me') {
        const a = accounts.get(bearer);
        if (!a) return send(res, 401, { error: 'invalid api key' });
        return send(res, 200, accounts.publicView(a));
      }
      if (req.method === 'POST' && url.pathname === '/v1/verify') {
        const a = accounts.get(bearer);
        if (!a) return send(res, 401, { error: 'invalid api key' });
        if (limited(ip, 'v', 60, 60_000)) return send(res, 429, { error: 'rate limit' });
        const body = await readJson(req);
        if (!CHECKS[body.check]) return send(res, 400, { error: 'unknown check', available: Object.keys(CHECKS) });
        const paid_with = accounts.charge(a);
        if (!paid_with) return send(res, 402, { error: 'no free receipts or points left today' });
        const result = await runCheck(body.check, body.params, { allowPrivate });
        const receipt = signReceipt(keys, {
          account: a.id,
          check: body.check,
          params: body.params || {},
          claim: String(body.claim || '').slice(0, 300),
          passed: result.passed,
          observed: result.observed,
          error: result.error,
          at: new Date().toISOString(),
          paid_with,
        }, store.lastId);
        store.addReceipt(receipt);
        return send(res, 200, { receipt, verify_url: `/v1/receipts/${receipt.id}` });
      }
      let m;
      if (req.method === 'GET' && (m = url.pathname.match(/^\/v1\/receipts\/(rcpt_[a-f0-9]+)$/))) {
        const r = store.receipts.get(m[1]);
        if (!r) return send(res, 404, { error: 'not found' });
        return send(res, 200, { receipt: r, signature_valid: verifyReceipt(r, keys.publicPem).valid });
      }
      if (req.method === 'POST' && url.pathname === '/v1/receipts/verify') {
        const body = await readJson(req);
        return send(res, 200, verifyReceipt(body.receipt || {}, keys.publicPem));
      }
      if (req.method === 'GET' && url.pathname === '/v1/recent') {
        const list = [...store.receipts.values()].slice(-10).reverse().map((r) => ({
          id: r.id, check: r.check, claim: r.claim, passed: r.passed, at: r.at,
        }));
        return send(res, 200, { receipts: list });
      }
      send(res, 404, { error: 'not found' });
    } catch (e) {
      send(res, 400, { error: String(e.message || e) });
    }
  });
  return { server, store, accounts, keys };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  const { server } = createApp({ allowPrivate: process.env.ALLOW_PRIVATE === "1" }); // dev only
  server.listen(port, () => console.log(`agent-receipts listening on :${port}`));
}
