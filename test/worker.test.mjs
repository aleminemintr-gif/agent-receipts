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
    _db: db,
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

const runCron = async (e) => { let p; await worker.scheduled({}, e, { waitUntil: (x) => { p = x; } }); await p; };
const realFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = async (u, init) => {
    if (String(u) === 'https://site.test/') return new Response(globalThis.__page || 'hello deployed page', { status: 200, headers: { 'content-type': 'text/html', etag: 'abc', 'last-modified': globalThis.__lm || 'x' } });
    if (String(u) === 'https://site.test/missing') return new Response('no', { status: 404 });
    if (String(u) === 'https://fac.test/supported') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', extra: { feePayer: 'FeePayer1111111111111111111111111111111111' } }] });
    if (String(u) === 'https://fac.test/verify') { globalThis.__fac.push(['verify', JSON.parse(init.body)]); return Response.json(globalThis.__facOk === false ? { isValid: false, invalidReason: 'insufficient_funds' } : { isValid: true, payer: 'PayerWallet' }); }
    if (String(u) === 'https://fac.test/settle') { globalThis.__fac.push(['settle', JSON.parse(init.body)]); return Response.json({ success: true, payer: 'PayerWallet', transaction: 'TX' + (globalThis.__fac.length), network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' }); }
    if (String(u) === 'https://other.workers.dev/') return new Response('error code: 1042\n', { status: 404 });
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

test('receipt carries raw observation, method, timing and fingerprint', async () => {
  const e = env();
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  const r = (await call(e, '/v1/verify', { method: 'POST', key: body.api_key, body: { check: 'http_contains', params: { url: 'https://site.test/', text: 'deployed' } } })).body.receipt;
  assert.equal(r.observed.headers.etag, 'abc');
  assert.equal(r.observed.body_excerpt, 'hello deployed page');
  assert.equal(r.observed.body_bytes, 19);
  assert.equal(r.method.name, 'http_contains');
  assert.match(r.method.reproduce, /curl/);
  assert.equal(typeof r.duration_ms, 'number');
  assert.equal(r.fingerprint.length, 64);
  const m = await call(e, '/v1/methodology');
  assert.ok(m.body.methods.dns_record);
});

test('watch: baseline now, recheck after N minutes, drift detected', async () => {
  const e = env();
  globalThis.__page = 'version one';
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  const key = body.api_key;
  const bad = await call(e, '/v1/watches', { method: 'POST', key, body: { check: 'http_contains', params: { url: 'https://site.test/', text: 'version' }, recheck_after_minutes: 1 } });
  assert.equal(bad.status, 400);
  const w = await call(e, '/v1/watches', { method: 'POST', key, body: { check: 'http_contains', claim: 'page says version', params: { url: 'https://site.test/', text: 'version' }, recheck_after_minutes: 30 } });
  assert.equal(w.status, 201);
  assert.equal(w.body.baseline.watch_role, 'baseline');
  const id = w.body.watch;
  // Costs two receipts up front.
  assert.equal((await call(e, '/v1/me', { key })).body.free_left_today, 3);
  // Not due yet: cron does nothing.
  await runCron(e);
  assert.equal((await call(e, '/v1/watches/' + id, { key })).body.status, 'pending');
  // Time passes and the page changes (still contains the text, so pass/fail alone would miss it).
  e.DB._db.exec("UPDATE watches SET due_at='2000-01-01T00:00:00.000Z'");
  globalThis.__page = 'version two';
  await runCron(e);
  const done = (await call(e, '/v1/watches/' + id, { key })).body;
  assert.equal(done.status, 'done');
  assert.equal(done.drift, true);
  assert.equal(done.recheck_receipt.passed, true);
  assert.equal(done.recheck_receipt.baseline, w.body.baseline.id);
  assert.equal(verifyNode(done.recheck_receipt, pem).valid, true);
  // Unchanged page: no drift.
  const w2 = await call(e, '/v1/watches', { method: 'POST', key, body: { check: 'http_status', params: { url: 'https://site.test/' }, recheck_after_minutes: 5 } });
  e.DB._db.exec("UPDATE watches SET due_at='2000-01-01T00:00:00.000Z' WHERE status='pending'");
  await runCron(e);
  assert.equal((await call(e, '/v1/watches/' + w2.body.watch, { key })).body.drift, false);
  // Another account cannot read it.
  const other = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  assert.equal((await call(e, '/v1/watches/' + id, { key: other.body.api_key })).status, 404);
  delete globalThis.__page;
});

test('fingerprint ignores volatile headers but still catches content change', async () => {
  const e = env();
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  const run = async (hdr, page) => { globalThis.__page = page; globalThis.__lm = hdr;
    return (await call(e, '/v1/verify', { method: 'POST', key: body.api_key, body: { check: 'http_contains', params: { url: 'https://site.test/', text: 'v' } } })).body.receipt.fingerprint; };
  const a = await run('one', 'v1'); const b = await run('two', 'v1'); const c = await run('two', 'v2');
  assert.equal(a, b);
  assert.notEqual(b, c);
  delete globalThis.__page; delete globalThis.__lm;
});

test('watch: needs two receipts, refunds the first if the second is missing', async () => {
  const e = env();
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  e.DB._db.exec("UPDATE accounts SET points=0, used_today=4, day='" + new Date().toISOString().slice(0, 10) + "'");
  const r = await call(e, '/v1/watches', { method: 'POST', key: body.api_key, body: { check: 'http_status', params: { url: 'https://site.test/' }, recheck_after_minutes: 5 } });
  assert.equal(r.status, 402);
  assert.equal((await call(e, '/v1/me', { key: body.api_key })).body.free_left_today, 1);
});

test('workers.dev target gives an explicit error, not a fake 404 verdict', async () => {
  const e = env();
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  const r = (await call(e, '/v1/verify', { method: 'POST', key: body.api_key, body: { check: 'http_status', params: { url: 'https://other.workers.dev/' } } })).body.receipt;
  assert.equal(r.passed, false);
  assert.match(r.error, /1042/);
});

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64');
const payEnv = () => ({ ...env(), PAY_TO: 'ARcYk3J3iBnJZMduVevMS7jsYh7puQtXH9WN8FtAjAbJ', FACILITATOR_URL: 'https://fac.test' });
const raw = (e, path, { method = 'POST', body, key, pay } = {}) => worker.fetch(new Request('https://ar.test' + path, { method, body: JSON.stringify(body), headers: { ...(key ? { authorization: 'Bearer ' + key } : {}), ...(pay ? { 'payment-signature': pay } : {}), 'cf-connecting-ip': '5.6.7.8' } }), e);
const vbody = { check: 'http_status', claim: 'up', params: { url: 'https://site.test/' } };
const goodPay = (amount) => b64({ x402Version: 2, accepted: { scheme: 'exact', network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', amount, asset: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', payTo: 'ARcYk3J3iBnJZMduVevMS7jsYh7puQtXH9WN8FtAjAbJ' }, payload: { transaction: 'abc' } });

test('x402: anonymous call gets a V2 402 with our price and public address only', async () => {
  const e = payEnv(); globalThis.__fac = [];
  const r = await raw(e, '/v1/verify', { body: vbody });
  assert.equal(r.status, 402);
  const pr = JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64').toString());
  assert.equal(pr.x402Version, 2);
  assert.equal(pr.accepts[0].amount, '20000');
  assert.equal(pr.accepts[0].payTo, 'ARcYk3J3iBnJZMduVevMS7jsYh7puQtXH9WN8FtAjAbJ');
  assert.equal(pr.accepts[0].extra.feePayer, 'FeePayer1111111111111111111111111111111111');
});

test('x402: paid call verifies, settles, then returns a receipt that records the payment', async () => {
  const e = payEnv(); globalThis.__fac = []; globalThis.__facOk = true;
  const r = await raw(e, '/v1/verify', { body: vbody, pay: goodPay('20000') });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.receipt.paid_with, 'x402');
  assert.equal(j.receipt.payment.usd, '0.02');
  assert.ok(j.receipt.payment.transaction.startsWith('TX'));
  assert.deepEqual(globalThis.__fac.map((x) => x[0]), ['verify', 'settle']);
  assert.ok(r.headers.get('payment-response'));
  assert.equal(verifyNode(j.receipt, pem).valid, true);
});

test('x402: wrong amount is rejected before the facilitator is called; failed verify never settles', async () => {
  const e = payEnv(); globalThis.__fac = [];
  const cheap = await raw(e, '/v1/verify', { body: vbody, pay: goodPay('1') });
  assert.equal(cheap.status, 402);
  assert.equal(globalThis.__fac.length, 0);
  globalThis.__facOk = false;
  const bad = await raw(e, '/v1/verify', { body: vbody, pay: goodPay('20000') });
  assert.equal(bad.status, 402);
  assert.deepEqual(globalThis.__fac.map((x) => x[0]), ['verify']);
  globalThis.__facOk = true;
});

test('x402: watch costs 0.05, anonymous watch is readable by its id', async () => {
  const e = payEnv(); globalThis.__fac = []; globalThis.__facOk = true;
  const wb = { check: 'http_status', params: { url: 'https://site.test/' }, recheck_after_minutes: 5 };
  assert.equal((await raw(e, '/v1/watches', { body: wb })).status, 402);
  assert.equal((await raw(e, '/v1/watches', { body: wb, pay: goodPay('20000') })).status, 402);
  const ok = await raw(e, '/v1/watches', { body: wb, pay: goodPay('50000') });
  assert.equal(ok.status, 201);
  const j = await ok.json();
  assert.equal(j.baseline.payment.usd, '0.05');
  const st = await raw(e, '/v1/watches/' + j.watch, { method: 'GET' });
  assert.equal((await st.json()).status, 'pending');
});

test('x402: account with credit still uses free quota first; out of credit gets 402 with x402 offer', async () => {
  const e = payEnv();
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  const first = await raw(e, '/v1/verify', { body: vbody, key: body.api_key });
  assert.equal((await first.json()).receipt.paid_with, 'free');
  e.DB._db.exec("UPDATE accounts SET points=0, used_today=5, day='" + new Date().toISOString().slice(0, 10) + "'");
  const none = await raw(e, '/v1/verify', { body: vbody, key: body.api_key });
  assert.equal(none.status, 402);
  assert.ok(none.headers.get('payment-required'));
});
