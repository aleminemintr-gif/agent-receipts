import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync } from 'node:crypto';
import worker from '../worker/index.mjs';
import { verifyReceipt as verifyNode, sha256 as nodeSha } from '../src/receipt.mjs';

// Minimal D1 stand-in over node:sqlite.
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(fs.readFileSync(new URL('../worker/schema.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const st = db.prepare(sql);
      return {
        bind(...a) {
          return {
            run: async () => ({ meta: { changes: Number(st.run(...a).changes) } }),
            first: async () => st.get(...a) ?? null,
            all: async () => ({ results: st.all(...a) }),
          };
        },
        run: async () => ({ meta: { changes: Number(st.run().changes) } }),
        first: async () => st.get() ?? null,
        all: async () => ({ results: st.all() }),
      };
    },
  };
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const env = () => ({ DB: fakeD1(), SIGNING_KEY_PKCS8_B64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') });
const pem = publicKey.export({ type: 'spki', format: 'pem' });

const realFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = async (u) => {
    if (String(u) === 'https://site.test/') return new Response('hello deployed page', { status: 200 });
    if (String(u) === 'https://site.test/missing') return new Response('no', { status: 404 });
    return new Response('x', { status: 500 });
  };
});
test.after(() => { globalThis.fetch = realFetch; });

const call = (e, path, { method = 'GET', body, key } = {}) =>
  worker.fetch(new Request('https://ar.test' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: { ...(key ? { authorization: 'Bearer ' + key } : {}), 'cf-connecting-ip': '1.2.3.4' } }), e)
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

test('worker: account, pass, fail, chain, and Node verifies the Worker signature', async () => {
  const e = env();
  const a = await call(e, '/v1/accounts', { method: 'POST', body: { label: 'bot' } });
  assert.equal(a.status, 201);
  assert.equal(a.body.account.points, 25);
  const key = a.body.api_key;
  const ok = await call(e, '/v1/verify', { method: 'POST', key, body: { check: 'http_contains', claim: 'live', params: { url: 'https://site.test/', text: 'deployed' } } });
  assert.equal(ok.body.receipt.passed, true);
  const bad = await call(e, '/v1/verify', { method: 'POST', key, body: { check: 'http_status', params: { url: 'https://site.test/missing' } } });
  assert.equal(bad.body.receipt.passed, false);
  assert.equal(bad.body.receipt.prev, ok.body.receipt.id);
  // Cross-runtime: the Node verifier accepts the Worker's receipt.
  assert.equal(verifyNode(ok.body.receipt, pem).valid, true);
  const got = await call(e, '/v1/receipts/' + ok.body.receipt.id);
  assert.equal(got.body.signature_valid, true);
  const forged = await call(e, '/v1/receipts/verify', { method: 'POST', body: { receipt: { ...ok.body.receipt, passed: false } } });
  assert.equal(forged.body.valid, false);
  assert.equal(nodeSha('a').length, 64);
});

test('worker: quota, points, 402, no transfer route', async () => {
  const e = env();
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  let last;
  for (let i = 0; i < 31; i++) last = await call(e, '/v1/verify', { method: 'POST', key: body.api_key, body: { check: 'http_status', params: { url: 'https://site.test/' } } });
  assert.equal(last.status, 402);
  assert.equal((await call(e, '/v1/me', { key: body.api_key })).body.points, 0);
  assert.equal((await call(e, '/v1/transfer', { method: 'POST', key: body.api_key, body: {} })).status, 404);
});

test('worker: early program limit and SSRF guard', async () => {
  const e = { ...env(), EARLY_LIMIT: '1' };
  const a = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  const b = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  assert.equal(a.body.account.points, 25);
  assert.equal(b.body.account.points, 0);
  for (const u of ['http://127.0.0.1/', 'http://localhost/', 'http://169.254.169.254/', 'http://2130706433/']) {
    const r = await call(e, '/v1/verify', { method: 'POST', key: a.body.api_key, body: { check: 'http_status', params: { url: u } } });
    assert.match(r.body.receipt.error, /not public/, u);
  }
});
