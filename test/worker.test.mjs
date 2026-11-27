import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { generateKeyPairSync, createHash, sign as edSign } from 'node:crypto';
import worker from '../worker/index.mjs';
import * as tlog from '../worker/log.mjs';
import { importPrivate, publicFromPrivate } from '../worker/receipt-web.mjs';
import { verifyBundle } from '../verifier/verify.mjs';
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
const env = () => ({ CLAIM_BITS: '8', DB: fakeD1(), SIGNING_KEY_PKCS8_B64: privateKey.export({ type: 'pkcs8', format: 'der' }).toString('base64') });
const pem = publicKey.export({ type: 'spki', format: 'pem' });

// Agent side of the claim: sign the nonce, solve the proof of work.
async function claimIdentity(e, { key, ip = '9.9.9.9', kp = generateKeyPairSync('ed25519'), mutate } = {}) {
  const ch = (await call(e, '/v1/claim/challenge')).body;
  const pub = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  let n = 0; const bits = (h) => { let c = 0; for (const x of h) { const v = parseInt(x, 16); if (v === 0) { c += 4; continue; } c += Math.clz32(v) - 28; break; } return c; };
  while (bits(createHash('sha256').update(`${ch.nonce}:${pub}:${n}`).digest('hex')) < ch.pow_bits) n++;
  const signature = edSign(null, Buffer.from(ch.sign), kp.privateKey).toString('base64');
  let body = { challenge_id: ch.challenge_id, public_key: pub, signature, pow: String(n) };
  if (mutate) body = mutate(body);
  return worker.fetch(new Request('https://ar.test/v1/claim', { method: 'POST', body: JSON.stringify(body), headers: { ...(key ? { authorization: 'Bearer ' + key } : {}), 'cf-connecting-ip': ip } }), e).then(async (r) => ({ status: r.status, body: await r.json() }));
}

const runCron = async (e) => { let p; await worker.scheduled({}, e, { waitUntil: (x) => { p = x; } }); await p; };
const realFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = async (u, init) => {
    if (String(u) === 'https://site.test/') return new Response(globalThis.__page || 'hello deployed page', { status: 200, headers: { 'content-type': 'text/html', etag: 'abc', 'last-modified': globalThis.__lm || 'x', date: 'Fri, 27 Nov 2026 19:00:00 GMT' } });
    if (String(u) === 'https://rpc.test') {
      const t = globalThis.__tx;
      return Response.json({ result: t ? { blockTime: 1, meta: { err: null, preTokenBalances: [], postTokenBalances: [{ owner: t.owner, mint: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU', uiTokenAmount: { amount: String(t.amount) } }] } } : null });
    }
    if (String(u) === 'https://site.test/missing') return new Response('no', { status: 404 });
    if (String(u) === 'https://fac.test/supported') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1', extra: { feePayer: 'FeePayer1111111111111111111111111111111111' } }] });
    if (String(u) === 'https://fac.test/verify') { globalThis.__fac.push(['verify', JSON.parse(init.body)]); return Response.json(globalThis.__facOk === false ? { isValid: false, invalidReason: 'insufficient_funds' } : { isValid: true, payer: 'PayerWallet' }); }
    if (String(u) === 'https://fac.test/settle') { globalThis.__fac.push(['settle', JSON.parse(init.body)]); return Response.json({ success: true, payer: 'PayerWallet', transaction: 'TX' + (globalThis.__fac.length), network: 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1' }); }
    if (String(u) === 'https://rpc.test/') {
      const sig = JSON.parse(init.body).params[0];
      if (sig !== '5'.repeat(88)) return Response.json({ result: null });
      return Response.json({ result: { meta: { err: null }, blockTime: 1800000000, transaction: { message: { instructions: [{ program: 'spl-memo', programId: 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr', parsed: globalThis.__memo }] } } } });
    }
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
  const a = await claimIdentity(e);
  assert.equal(a.status, 201);
  assert.equal(a.body.points_granted, 25);
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
  const a = await claimIdentity(e);
  const b = await claimIdentity(e, { ip: '8.8.4.4' });
  assert.equal(a.body.points_granted, 25);
  assert.equal(b.body.points_granted, 0);
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

test('receipt pins fetch time and the source clock (Date, Last-Modified) inside the signed body', async () => {
  const e = env();
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  const r = (await call(e, '/v1/verify', { method: 'POST', key: body.api_key, body: { check: 'http_status', params: { url: 'https://site.test/' } } })).body.receipt;
  const st = r.observed.source_time;
  assert.equal(st.date, 'Fri, 27 Nov 2026 19:00:00 GMT');
  assert.ok(st.last_modified);
  assert.ok(!Number.isNaN(Date.parse(st.fetched_at)));
  assert.equal(typeof st.skew_seconds, 'number');
  assert.equal(r.observed.headers.date, st.date);
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

async function sealedEnv(n = 5) {
  const e = { ...env(), SOLANA_RPC: 'https://rpc.test/' };
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  const ids = [];
  for (let i = 0; i < n; i++) ids.push((await call(e, '/v1/verify', { method: 'POST', key: body.api_key, body: { check: 'http_status', claim: 'c' + i, params: { url: 'https://site.test/' } } })).body.receipt.id);
  const priv = await importPrivate(e.SIGNING_KEY_PKCS8_B64);
  const keys = { privateKey: priv, publicKey: await publicFromPrivate(priv) };
  const sealed = await tlog.closeDays(e, keys, Date.now() + 2 * 86400_000);
  return { e, ids, sealed };
}

test('log: day is sealed, public log shows commitments only, proof verifies offline', async () => {
  const { e, ids, sealed } = await sealedEnv(5);
  assert.equal(sealed.length, 1);
  const log = (await call(e, '/v1/log')).body;
  assert.equal(log.entries.length, 5);
  assert.equal(log.entries[1].prev, log.entries[0].id);
  assert.ok(!('params' in log.entries[0]) && !('claim' in log.entries[0]), 'no receipt contents in the public log');
  const roots = (await call(e, '/v1/roots')).body.roots;
  assert.equal(roots[0].tree_size, 5);
  for (const id of ids) {
    const b = (await call(e, '/v1/proof/' + id + '?include=receipt')).body;
    const checks = verifyBundle(b, null, pem);
    assert.deepEqual(checks.filter((c) => !c.ok), [], id);
  }
  // Tampering is caught by the standalone verifier.
  const b = (await call(e, '/v1/proof/' + ids[0] + '?include=receipt')).body;
  const forged = verifyBundle(b, { ...b.receipt, passed: !b.receipt.passed }, pem);
  assert.ok(forged.some((c) => !c.ok));
  const badRoot = verifyBundle({ ...b, root: { ...b.root, tree_size: 99 } }, null, pem);
  assert.ok(badRoot.some((c) => !c.ok && /root statement/.test(c.name)));
  const wrongKey = verifyBundle(b, null, generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }));
  assert.ok(wrongKey.some((c) => !c.ok));
});

test('log: unsealed day has no proof; roots chain across days', async () => {
  const e = env();
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  const r = (await call(e, '/v1/verify', { method: 'POST', key: body.api_key, body: { check: 'http_status', params: { url: 'https://site.test/' } } })).body.receipt;
  assert.equal((await call(e, '/v1/proof/' + r.id)).status, 404);
  // Second day: move the receipt back a day and add one for 'today'.
  e.DB._db.exec("UPDATE receipts SET body = json_set(body,'$.at','2026-01-01T10:00:00.000Z')");
  e.DB._db.exec("UPDATE leaves SET day='2026-01-01'");
  await call(e, '/v1/verify', { method: 'POST', key: body.api_key, body: { check: 'http_status', params: { url: 'https://site.test/' } } });
  const priv = await importPrivate(e.SIGNING_KEY_PKCS8_B64);
  const keys = { privateKey: priv, publicKey: await publicFromPrivate(priv) };
  await tlog.closeDays(e, keys, Date.now() + 2 * 86400_000);
  const roots = (await call(e, '/v1/roots')).body.roots;
  assert.equal(roots.length, 2);
  const [late, early] = roots;
  assert.equal(early.prev_root, null);
  assert.equal(late.prev_root, early.root);
});

test('anchor: accepted only when the chain shows the exact memo; first anchor is kept', async () => {
  const { e } = await sealedEnv(3);
  const root = (await call(e, '/v1/roots')).body.roots[0];
  const sig = '5'.repeat(88);
  globalThis.__memo = 'agent-receipts:v1:' + root.day + ':' + 'f'.repeat(64);
  assert.equal((await call(e, `/v1/roots/${root.day}/anchor`, { method: 'POST', body: { signature: 'short' } })).status, 400);
  const bad = await call(e, `/v1/roots/${root.day}/anchor`, { method: 'POST', body: { signature: sig } });
  assert.equal(bad.status, 422);
  globalThis.__memo = 'agent-receipts:v1:' + root.day + ':' + root.root;
  const ok = await call(e, `/v1/roots/${root.day}/anchor`, { method: 'POST', body: { signature: sig } });
  assert.equal(ok.status, 200);
  assert.equal((await call(e, `/v1/roots/${root.day}`)).body.anchor.tx, sig);
  assert.equal((await call(e, `/v1/roots/${root.day}/anchor`, { method: 'POST', body: { signature: '4'.repeat(88) } })).body.note.includes('first anchor'), true);
});

test('identity: claim binds credits to a key fingerprint; replay, reuse, weak PoW, bad signature all fail', async () => {
  const e = env();
  const kp = generateKeyPairSync('ed25519');
  const ok = await claimIdentity(e, { kp });
  assert.equal(ok.status, 201);
  assert.match(ok.body.fingerprint, /^agent_[a-f0-9]{16}$/);
  assert.equal((await call(e, '/v1/me', { key: ok.body.api_key })).body.identity, ok.body.fingerprint);
  // Same key again: no second grant, even from another address.
  assert.equal((await claimIdentity(e, { kp, ip: '7.7.7.7' })).status, 409);
  // Bad signature (signed by a different key).
  const other = generateKeyPairSync('ed25519');
  const forged = await claimIdentity(e, { mutate: (b) => ({ ...b, signature: edSign(null, Buffer.from('x'), other.privateKey).toString('base64') }), ip: '6.6.6.6' });
  assert.equal(forged.status, 400);
  // Weak proof of work.
  const weak = await claimIdentity(e, { mutate: (b) => ({ ...b, pow: 'nope' }), ip: '5.5.5.5' });
  assert.equal(weak.status, 400);
  assert.match(weak.body.error, /work/);
  // Challenge replay.
  const ch = (await call(e, '/v1/claim/challenge')).body;
  const used = e.DB._db.prepare('UPDATE challenges SET used = 1 WHERE id = ?').run(ch.challenge_id);
  assert.equal(Number(used.changes), 1);
  const replay = await worker.fetch(new Request('https://ar.test/v1/claim', { method: 'POST', body: JSON.stringify({ challenge_id: ch.challenge_id, public_key: 'x', signature: 'x', pow: '0' }), headers: { 'cf-connecting-ip': '4.4.4.4' } }), e);
  assert.equal(replay.status, 400);
});

test('identity: per-IP claim cap, link to an existing account, bare accounts get no points', async () => {
  const e = env();
  const bare = (await call(e, '/v1/accounts', { method: 'POST', body: {} })).body;
  assert.equal(bare.account.points, 0);
  const linked = await claimIdentity(e, { key: bare.api_key, ip: '3.3.3.3' });
  assert.equal(linked.status, 201);
  assert.equal(linked.body.account_id, bare.account.id);
  assert.equal((await call(e, '/v1/me', { key: bare.api_key })).body.points, 25);
  assert.equal((await claimIdentity(e, { key: bare.api_key, ip: '3.3.3.4' })).status, 409); // account already bound
  assert.equal((await claimIdentity(e, { ip: '3.3.3.3' })).status, 201);
  assert.equal((await claimIdentity(e, { ip: '3.3.3.3' })).status, 201);
  assert.equal((await claimIdentity(e, { ip: '3.3.3.3' })).status, 429); // 4th from one address today
});

test('limits: points are capped per key per day and credit receipts per address per day', async () => {
  const e = env();
  const a = await claimIdentity(e, { ip: '2.2.2.2' });
  e.DB._db.exec("UPDATE accounts SET points = 100, used_today = 5, day='" + new Date().toISOString().slice(0, 10) + "'");
  let last;
  for (let i = 0; i < 21; i++) last = await call(e, '/v1/verify', { method: 'POST', key: a.body.api_key, body: { check: 'http_status', params: { url: 'https://site.test/' } } });
  assert.equal(last.status, 402); // 20 points allowed today, the 21st is refused
  assert.equal((await call(e, '/v1/me', { key: a.body.api_key })).body.points, 80); // refused one was refunded
});

test('try: no key, signed receipt, limited checks, per-address cap', async () => {
  const e = env();
  const post = (b, ip = '7.7.7.7') => worker.fetch(new Request('https://ar.test/v1/try', { method: 'POST', body: JSON.stringify(b), headers: { 'cf-connecting-ip': ip } }), e);
  const ok = await post({ check: 'http_contains', claim: 'page says hello', params: { url: 'https://site.test/', text: 'hello' } });
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.receipt.passed, true);
  assert.equal(j.receipt.paid_with, 'free-try');
  assert.ok(j.receipt.sig);
  assert.equal((await post({ check: 'dns_record', params: {} })).status, 400);
  for (let i = 0; i < 3; i++) await post({ check: 'http_status', params: { url: 'https://site.test/' } });
  await post({ check: 'http_status', params: { url: 'https://site.test/' } });
  assert.equal((await post({ check: 'http_status', params: { url: 'https://site.test/' } })).status, 429);
  assert.equal((await post({ check: 'http_status', params: { url: 'https://site.test/' } }, '8.8.8.8')).status, 200);
});

test('discovery: openapi, llms.txt and agent card are served and consistent with the API', async () => {
  const e = env();
  const get = (p) => worker.fetch(new Request('https://ar.test' + p, { headers: { 'cf-connecting-ip': '3.3.3.3' } }), e);
  const spec = await (await get('/openapi.json')).json();
  assert.equal(spec.openapi, '3.1.0');
  for (const p of ['/v1/try', '/v1/verify', '/v1/claim', '/v1/claim/challenge', '/v1/accounts', '/v1/watches']) assert.ok(spec.paths[p], p);
  assert.equal(spec.servers[0].url, 'https://ar.test');
  const txt = await (await get('/llms.txt')).text();
  assert.match(txt, /x402/); assert.match(txt, /\/v1\/claim/); assert.match(txt, /public facts only/i);
  const card = await (await get('/.well-known/agent.json')).json();
  assert.equal(card.name, 'agent-receipts'); assert.ok(card.skills.length >= 3);
  assert.ok(card.authentication.some((a) => a.type === 'x402'));
});

test('remote mcp: initialize, list, verify_claim via try, get_receipt, bad requests', async () => {
  const e = env();
  const rpc = async (body, hdr = {}) => { const r = await worker.fetch(new Request('https://ar.test/mcp', { method: 'POST', body: JSON.stringify(body), headers: { 'cf-connecting-ip': '6.6.6.6', ...hdr } }), e); return { status: r.status, body: r.status === 202 ? null : await r.json() }; };
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).body.result.serverInfo.name, 'agent-receipts');
  assert.equal((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  assert.deepEqual((await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).body.result.tools.map((t) => t.name), ['verify_claim', 'list_open_tasks', 'get_badge', 'get_receipt']);
  const v = (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'verify_claim', arguments: { url: 'https://site.test/', contains: 'hello', claim: 'page live' } } })).body.result;
  assert.match(v.content[0].text, /^VERIFIED/);
  const id = v.content[0].text.match(/rcpt_[a-f0-9]+/)[0];
  const g = (await rpc({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_receipt', arguments: { id } } })).body.result;
  assert.equal(g.isError, false);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_receipt', arguments: { id: 'x' } } })).body.result.isError, true);
  assert.equal((await rpc({ jsonrpc: '2.0', id: 6, method: 'nope' })).body.error.code, -32601);
  assert.equal((await rpc({ nonsense: true })).body.error.code, -32600);
  const get = await worker.fetch(new Request('https://ar.test/mcp'), e);
  assert.equal(get.status, 405);
});

test('402 carries the bazaar discovery declaration in header and body', async () => {
  const e = payEnv();
  const r = await raw(e, '/v1/verify', { body: { check: 'http_status', params: { url: 'https://site.test/' } } });
  assert.equal(r.status, 402);
  const pr = JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64').toString());
  const bz = pr.extensions.bazaar;
  assert.equal(bz.info.input.method, 'POST'); assert.equal(bz.info.input.bodyType, 'json'); assert.equal(bz.info.input.body.check, 'http_contains');
  assert.equal(bz.info.output.type, 'json'); assert.equal(bz.schema.type, 'object');
  const w = await raw(e, '/v1/watches', { body: { check: 'http_status', params: { url: 'https://site.test/' }, recheck_after_minutes: 5 } });
  assert.equal(JSON.parse(Buffer.from(w.headers.get('payment-required'), 'base64').toString()).extensions.bazaar.info.input.body.recheck_after_minutes, 60);
});

test('recent: internal dogfood receipts are excluded from the public table', async () => {
  const e = env();
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  const v = (claim) => call(e, '/v1/verify', { method: 'POST', key: body.api_key, body: { check: 'http_status', claim, params: { url: 'https://site.test/' } } });
  await v('[internal-dogfood] hidden'); await v('visible claim');
  const claims = (await call(e, '/v1/recent')).body.receipts.map((r) => r.claim);
  assert.ok(claims.includes('visible claim')); assert.ok(!claims.some((c) => c.startsWith('[internal')));
});

test('recent: receipts before PUBLIC_TABLE_FROM are hidden from the public table', async () => {
  const e = { ...env(), PUBLIC_TABLE_FROM: '2999-01-01T00:00:00.000Z' };
  const { body } = await call(e, '/v1/accounts', { method: 'POST', body: {} });
  await call(e, '/v1/verify', { method: 'POST', key: body.api_key, body: { check: 'http_status', claim: 'old test', params: { url: 'https://site.test/' } } });
  assert.equal((await call(e, '/v1/recent')).body.receipts.length, 0);
});


// ---- badges and tasks ----
const PAYOUT = 'ARcYk3J3iBnJZMduVevMS7jsYh7puQtXH9WN8FtAjAbJ';
let ipn = 20;
async function agent(e, label) {
  const kp = generateKeyPairSync('ed25519');
  const r = await claimIdentity(e, { kp, ip: '10.0.0.' + ipn++, mutate: label ? (b) => ({ ...b, label }) : undefined });
  assert.equal(r.status, 201);
  return { kp, key: r.body.api_key };
}
const sign = (kp, msg) => edSign(null, Buffer.from(msg), kp.privateKey).toString('base64');
const verifyOne = async (e, key, claim = 'c') => (await call(e, '/v1/verify', { method: 'POST', key, body: { check: 'http_status', claim, params: { url: 'https://site.test/' } } })).body.receipt;

test('badges: bound to an agent key and a passed receipt, verifiable page, internal excluded from the gallery', async () => {
  const e = env();
  const A = await agent(e), I = await agent(e, 'internal-dogfood');
  const r = await verifyOne(e, A.key, 'I deployed it');
  const ok = await call(e, '/v1/badges', { method: 'POST', key: A.key, body: { receipt_id: r.id, signature: sign(A.kp, 'agent-receipts-badge:' + r.id) } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.receipt_signature_valid, true); assert.equal(ok.body.agent_signature_valid, true); assert.equal(ok.body.passed, true);
  const html = await (await worker.fetch(new Request('https://ar.test/badge/' + ok.body.id), e)).text();
  assert.match(html, /Receipt signature: <span class="ok">valid/); assert.match(html, /Not for sale/);
  assert.equal((await call(e, '/v1/badges', { method: 'POST', key: A.key, body: { receipt_id: r.id, signature: sign(A.kp, 'agent-receipts-badge:' + r.id) } })).status, 409);
  const r2 = await verifyOne(e, A.key);
  assert.equal((await call(e, '/v1/badges', { method: 'POST', key: A.key, body: { receipt_id: r2.id, signature: sign(A.kp, 'wrong') } })).status, 400);
  assert.equal((await call(e, '/v1/badges', { method: 'POST', key: I.key, body: { receipt_id: r2.id, signature: sign(I.kp, 'agent-receipts-badge:' + r2.id) } })).status, 403, 'not their receipt');
  const bare = (await call(e, '/v1/accounts', { method: 'POST', body: {} })).body.api_key;
  const rb = await verifyOne(e, bare);
  assert.equal((await call(e, '/v1/badges', { method: 'POST', key: bare, body: { receipt_id: rb.id, signature: 'x' } })).status, 403, 'no identity');
  const ri = await verifyOne(e, I.key);
  assert.equal((await call(e, '/v1/badges', { method: 'POST', key: I.key, body: { receipt_id: ri.id, signature: sign(I.kp, 'agent-receipts-badge:' + ri.id) } })).status, 201);
  assert.equal((await call(e, '/v1/badges')).body.badges.length, 1);
  assert.equal((await call(e, '/v1/badges?include_internal=1')).body.badges.length, 2);
  const st = (await call(e, '/v1/stats')).body;
  assert.equal(st.badges, 1); assert.equal(st.internal_excluded.badges, 1);
  const gal = await (await worker.fetch(new Request('https://ar.test/badges'), e)).text();
  assert.ok(gal.includes(ok.body.id)); assert.ok(!gal.includes('internal-dogfood'));
});

test('tasks: post, deliver against the poster check, settle with an on-chain transfer, limits hold', async () => {
  const e = { ...env(), SOLANA_RPC: 'https://rpc.test', PAY_TO: PAYOUT };
  const P = await agent(e), W = await agent(e), I = await agent(e, 'internal-dogfood');
  const mk = (extra = {}, key = P.key) => call(e, '/v1/tasks', { method: 'POST', key, body: { title: 'Publish a marker page', description: 'Host a page that contains the marker text.', delivery: { check: 'http_contains', params: { text: 'hello deployed' } }, reward_usd: 0.05, ...extra } });
  assert.equal((await call(e, '/v1/tasks', { method: 'POST', body: {} })).status, 401);
  assert.equal((await mk({ reward_usd: 5 })).status, 400);
  assert.equal((await mk({ delivery: { check: 'dns_record', params: {} } })).status, 400);
  const t1 = await mk(); assert.equal(t1.status, 201); assert.equal(t1.body.task.status, 'open');
  const id = t1.body.task.id;
  const dv = (key, body, tid = id) => call(e, `/v1/tasks/${tid}/deliver`, { method: 'POST', key, body });
  assert.equal((await dv(P.key, { url: 'https://site.test/', payout_address: PAYOUT })).status, 403, 'poster cannot deliver own task');
  assert.equal((await dv(W.key, { url: 'https://site.test/', payout_address: 'nope' })).status, 400);
  const t2 = await mk({ delivery: { check: 'http_contains', params: { text: 'never on that page' } } });
  const bad = await dv(W.key, { url: 'https://site.test/', payout_address: PAYOUT }, t2.body.task.id);
  assert.equal(bad.body.delivered, false); assert.equal(bad.body.task.status, 'open');
  const good = await dv(W.key, { url: 'https://site.test/', payout_address: PAYOUT });
  assert.equal(good.status, 200); assert.equal(good.body.delivered, true); assert.equal(good.body.task.status, 'delivered');
  assert.ok(good.body.receipt.sig); assert.equal((await dv(W.key, { url: 'https://site.test/', payout_address: PAYOUT })).status, 409);
  const TX = '5'.repeat(87);
  const settle = (key, tx = TX, tid = id) => call(e, `/v1/tasks/${tid}/settle`, { method: 'POST', key, body: { tx } });
  assert.equal((await settle(W.key)).status, 403, 'only the poster settles');
  globalThis.__tx = null; assert.equal((await settle(P.key)).status, 422);
  globalThis.__tx = { owner: PAYOUT, amount: 1000 }; assert.equal((await settle(P.key)).status, 422, 'too little arrived');
  globalThis.__tx = { owner: 'SomeoneElse1111111111111111111111111111111', amount: 50000 }; assert.equal((await settle(P.key)).status, 422, 'wrong recipient');
  globalThis.__tx = { owner: PAYOUT, amount: 50000 };
  const done = await settle(P.key); assert.equal(done.status, 200); assert.equal(done.body.task.status, 'settled'); assert.match(done.body.task.settle_explorer, /cluster=devnet/);
  // the same tx cannot settle a second task
  const t3 = await mk(); await dv(W.key, { url: 'https://site.test/', payout_address: PAYOUT }, t3.body.task.id);
  assert.equal((await settle(P.key, TX, t3.body.task.id)).status, 409);
  // open cap
  await mk(); const capped = await mk(); await mk(); const over = await mk();
  assert.ok([201, 429].includes(capped.status)); assert.equal(over.status, 429);
  // internal tagging stays out of public views
  const it = await mk({}, I.key); assert.equal(it.body.task.internal, true);
  const pub = (await call(e, '/v1/tasks?status=open')).body.tasks; assert.ok(!pub.some((x) => x.id === it.body.task.id));
  assert.ok((await call(e, '/v1/tasks?status=open&include_internal=1')).body.tasks.some((x) => x.id === it.body.task.id));
  const st = (await call(e, '/v1/stats')).body; assert.equal(st.tasks.settled, 1); assert.ok(st.internal_excluded.tasks >= 1);
  delete globalThis.__tx;
});

test('discovery lists badges and tasks', async () => {
  const e = env();
  const spec = await (await worker.fetch(new Request('https://ar.test/openapi.json'), e)).json();
  for (const p of ['/v1/badges', '/v1/tasks', '/v1/tasks/{id}/deliver', '/v1/tasks/{id}/settle', '/v1/stats']) assert.ok(spec.paths[p], p);
  const txt = await (await worker.fetch(new Request('https://ar.test/llms.txt'), e)).text();
  assert.match(txt, /\/v1\/badges/); assert.match(txt, /\/v1\/tasks/);
  const card = await (await worker.fetch(new Request('https://ar.test/.well-known/agent.json'), e)).json();
  assert.ok(card.skills.some((x) => x.id === 'earn_badge')); assert.ok(card.skills.some((x) => x.id === 'micro_tasks'));
});
