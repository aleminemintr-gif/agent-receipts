// Cloudflare Worker entry. Storage: D1. Secret: SIGNING_KEY_PKCS8_B64.
import { canonical, importPrivate, publicFromPrivate, publicPem, keyId, signReceipt, verifyReceipt, sha256 } from './receipt-web.mjs';
import { runCheck, CHECKS, METHODS } from './checks.mjs';
import * as x402 from './x402.mjs';
import * as tlog from './log.mjs';
import * as ident from './identity.mjs';

const EARLY_LIMIT = 10_000, EARLY_POINTS = 25, FREE_PER_DAY = 5;
const today = () => new Date().toISOString().slice(0, 10);
const json = (obj, status = 200) => new Response(JSON.stringify(obj, null, 2), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });

let keyCache;
async function keys(env) {
  if (!keyCache) {
    const privateKey = await importPrivate(env.SIGNING_KEY_PKCS8_B64);
    keyCache = { privateKey, publicKey: await publicFromPrivate(privateKey) };
  }
  return keyCache;
}

async function limited(env, ip, bucket, max, windowMs) {
  const k = bucket + ':' + ip, now = Date.now();
  await env.DB.prepare('DELETE FROM hits WHERE ts < ?').bind(now - 3600_000).run();
  await env.DB.prepare('INSERT INTO hits (k, ts) VALUES (?, ?)').bind(k, now).run();
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM hits WHERE k = ? AND ts > ?').bind(k, now - windowMs).first();
  return r.n > max;
}

const view = (a) => ({
  id: a.id, label: a.label, early_rank: a.early_rank, points: a.points,
  free_left_today: Math.max(0, FREE_PER_DAY - (a.day === today() ? a.used_today : 0)), total_receipts: a.total_receipts,
});

async function accountFor(env, req) {
  const raw = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!raw) return null;
  return env.DB.prepare('SELECT * FROM accounts WHERE key_hash = ?').bind(await sha256(raw)).first();
}


async function createAccount(env, label, points = 0, rank = null) {
  const raw = 'ar_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const a = { id: 'acct_' + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join(''), label: String(label || '').slice(0, 60),
    created: new Date().toISOString(), early_rank: rank, points, day: today(), used_today: 0, total_receipts: 0 };
  await env.DB.prepare('INSERT INTO accounts (key_hash,id,label,created,early_rank,points,day,used_today,total_receipts) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(await sha256(raw), a.id, a.label, a.created, a.early_rank, a.points, a.day, 0, 0).run();
  return { api_key: raw, account: view(a) };
}

async function charge(env, a) {
  const day = today();
  const free = await env.DB.prepare('UPDATE accounts SET day=?, used_today = CASE WHEN day=? THEN used_today+1 ELSE 1 END, total_receipts=total_receipts+1 WHERE key_hash=? AND ((day=? AND used_today<?) OR day<>?)')
    .bind(day, day, a.key_hash, day, FREE_PER_DAY, day).run();
  if (free.meta.changes) return 'free';
  const pt = await env.DB.prepare('UPDATE accounts SET points=points-1, total_receipts=total_receipts+1 WHERE key_hash=? AND points>0').bind(a.key_hash).run();
  if (!pt.meta.changes) return null;
  if (!(await ident.takePointAllowance(env, a.id))) { await refund(env, a.key_hash, 'point'); return null; } // per-key daily cap on spending points
  return 'point';
}
async function refund(env, keyHash, paidWith) {
  if (paidWith === 'free') await env.DB.prepare('UPDATE accounts SET used_today=MAX(0,used_today-1), total_receipts=total_receipts-1 WHERE key_hash=?').bind(keyHash).run();
  else if (paidWith === 'point') await env.DB.prepare('UPDATE accounts SET points=points+1, total_receipts=total_receipts-1 WHERE key_hash=?').bind(keyHash).run();
}
// Fingerprint = hash of the observation only (no timestamps), so equal world => equal fingerprint.
// Volatile fields (headers, excerpt, redirect count) stay in the receipt as evidence but are left out
// of the fingerprint: servers rewrite last-modified/date-like headers without the content changing.
const fingerprint = (observed, error) => {
  const { headers, redirects, body_excerpt, body_bytes, ...stable } = observed || {};
  return sha256(canonical({ observed: observed ? stable : null, error: error ? 'error' : null }));
};

async function runAndSign(env, k, accountId, { check, params, claim, paid_with, extra = {} }, allowPrivate) {
  const result = await runCheck(check, params, allowPrivate);
  const last = await env.DB.prepare('SELECT id FROM receipts ORDER BY seq DESC LIMIT 1').first();
  const receipt = await signReceipt(k, { account: accountId, check, params: params || {}, claim: String(claim || '').slice(0, 300),
    passed: result.passed, observed: result.observed, error: result.error, at: new Date().toISOString(), duration_ms: result.ms,
    method: { name: check, ...METHODS[check] }, fingerprint: await fingerprint(result.observed, result.error), paid_with, ...extra }, last && last.id);
  await env.DB.prepare('INSERT INTO receipts (id, body) VALUES (?, ?)').bind(receipt.id, JSON.stringify(receipt)).run();
  return receipt;
}

async function processDueWatches(env) {
  const k = await keys(env);
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 10 * 60_000).toISOString();
  // Pending and due, or stuck in 'running' for 10+ minutes (a crashed run): retry.
  const due = (await env.DB.prepare("SELECT * FROM watches WHERE (status='pending' AND due_at <= ?) OR (status='running' AND due_at <= ?) ORDER BY due_at LIMIT 10").bind(now, stale).all()).results;
  for (const w of due) {
    // Claim the row first so overlapping cron runs cannot double-process it.
    const claimed = await env.DB.prepare("UPDATE watches SET status='running', due_at=? WHERE id=? AND due_at=? AND status IN ('pending','running')").bind(now, w.id, w.due_at).run();
    if (!claimed.meta.changes) continue;
    const receipt = await runAndSign(env, k, w.account_id, { check: w.check_kind, params: JSON.parse(w.params), claim: w.claim, paid_with: 'prepaid',
      extra: { watch: w.id, baseline: w.baseline_receipt, baseline_fingerprint: w.baseline_fp, recheck_after_minutes: w.after_minutes } }, env.ALLOW_PRIVATE === '1');
    const drift = receipt.fingerprint !== w.baseline_fp;
    // Re-sign nothing: drift is derived from two signed fields, and also stored for lookup.
    await env.DB.prepare("UPDATE watches SET status='done', result_receipt=?, drift=?, done_at=? WHERE id=?").bind(receipt.id, drift ? 1 : 0, new Date().toISOString(), w.id).run();
  }
  return due.length;
}

// Decide how this call is paid. Returns {resp} to stop, or {paid_with, accountId, payment?}.
async function payFor(env, req, a, kind, cfg, count = 1) {
  const resourceUrl = new URL(req.url).origin + new URL(req.url).pathname;
  const header = req.headers.get('payment-signature');
  if (header && cfg) {
    const r = await x402.settle(cfg, kind, resourceUrl, header).catch((e) => ({ ok: false, reason: 'facilitator error: ' + e.message }));
    if (!r.ok) return { resp: await x402.paymentRequired(cfg, kind, resourceUrl, r.reason) };
    const dup = await env.DB.prepare('INSERT OR IGNORE INTO payments (tx, payer, network, asset, amount, kind, account_id, at) VALUES (?,?,?,?,?,?,?,?)')
      .bind(r.transaction, r.payer || '', r.network, r.asset, r.amount, kind, a ? a.id : 'anon', new Date().toISOString()).run();
    return { paid_with: 'x402', accountId: a ? a.id : 'anon', settleHeader: r.header,
      payment: { network: r.network, transaction: r.transaction, payer: r.payer, asset: r.asset, amount: r.amount, usd: x402.PRICES_USD[kind], replay: !dup.meta.changes } };
  }
  if (a) {
    if (!(await ident.takeIpAllowance(env, req.headers.get('cf-connecting-ip') || 'local'))) return { resp: json({ error: 'daily limit for credit-paid receipts from this address reached; pay with x402 or try tomorrow' }, 429) };
    const p1 = await charge(env, a);
    if (p1 && count === 2) {
      const p2 = await charge(env, a);
      if (!p2) { await refund(env, a.key_hash, p1); return cfg ? { resp: await x402.paymentRequired(cfg, kind, resourceUrl, 'no free receipts or points left; pay with x402') } : { resp: json({ error: 'a watch needs 2 receipts, only 1 left' }, 402) }; }
    }
    if (p1) return { paid_with: p1, accountId: a.id };
    return cfg ? { resp: await x402.paymentRequired(cfg, kind, resourceUrl, 'no free receipts or points left; pay with x402') } : { resp: json({ error: 'no free receipts or points left today' }, 402) };
  }
  if (cfg) return { resp: await x402.paymentRequired(cfg, kind, resourceUrl, 'PAYMENT-SIGNATURE header is required (or use an API key)') };
  return { resp: json({ error: 'invalid api key' }, 401) };
}
const withSettle = (resp, h) => { if (h) resp.headers.set('PAYMENT-RESPONSE', h); resp.headers.set('access-control-expose-headers', 'PAYMENT-RESPONSE'); return resp; };

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => { await processDueWatches(env); await tlog.closeDays(env, await keys(env)); })());
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    const ip = req.headers.get('cf-connecting-ip') || 'local';
    const allowPrivate = env.ALLOW_PRIVATE === '1';
    const earlyLimit = Number(env.EARLY_LIMIT || EARLY_LIMIT);
    try {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' } });
      if (req.method === 'GET' && env.ASSETS && (url.pathname === '/' || url.pathname === '/index.html')) return env.ASSETS.fetch(req);
      const k = await keys(env);

      if (req.method === 'GET' && url.pathname === '/v1/info') {
        const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM identities').first()).n;
        return json({ service: 'agent-receipts', version: '0.1.0', runtime: 'cloudflare-workers', key_id: await keyId(k.publicKey), checks: Object.keys(CHECKS), free_per_day: FREE_PER_DAY,
          payments: (() => { const c = x402.config(env); return c ? { protocol: 'x402 v2', network: c.network, asset: c.asset, pay_to: c.payTo, prices_usd: x402.PRICES_USD, note: 'Devnet unless network says mainnet. Pay with PAYMENT-SIGNATURE, no account needed.' } : { enabled: false }; })(),
          early_program: { limit: earlyLimit, points_each: EARLY_POINTS, taken: n, open: n < earlyLimit, note: 'Trial points are non-transferable credits bound to an agent key fingerprint (POST /v1/claim). Not a token. A key alone does not stop Sybil; limits only raise the cost.' } });
      }
      if (req.method === 'GET' && url.pathname === '/.well-known/receipt-key') {
        return new Response(await publicPem(k.publicKey), { headers: { 'content-type': 'application/x-pem-file' } });
      }
      if (req.method === 'POST' && url.pathname === '/v1/accounts') {
        if (await limited(env, ip, 'acct', 5, 3600_000)) return json({ error: 'too many accounts from this address, try later' }, 429);
        const body = await req.json().catch(() => ({}));
        // A bare account gets the free daily quota only. Trial points come from POST /v1/claim (identity-bound).
        return json({ ...(await createAccount(env, body.label)), next: 'GET /v1/claim/challenge to claim trial credits with an agent key' }, 201);
      }
      if (req.method === 'GET' && url.pathname === '/v1/claim/challenge') {
        if (await limited(env, ip, 'chal', 30, 60_000)) return json({ error: 'rate limit' }, 429);
        return json(await ident.issueChallenge(env));
      }
      if (req.method === 'POST' && url.pathname === '/v1/claim') {
        if (await limited(env, ip, 'claim', 10, 60_000)) return json({ error: 'rate limit' }, 429);
        const b = await req.json().catch(() => null);
        const existing = await accountFor(env, req);
        const r = await ident.claim({ ...env, EARLY_LIMIT: earlyLimit }, ip, b, existing, (points, rank) => createAccount(env, b.label, points, rank));
        return json(r.body, r.status);
      }
      if (req.method === 'GET' && url.pathname === '/v1/me') {
        const a = await accountFor(env, req);
        if (!a) return json({ error: 'invalid api key' }, 401);
        const idn = await env.DB.prepare('SELECT fp FROM identities WHERE account_id = ?').bind(a.id).first();
        return json({ ...view(a), identity: idn ? idn.fp : null });
      }
      if (req.method === 'POST' && url.pathname === '/v1/verify') {
        const a = await accountFor(env, req);
        if (await limited(env, ip, 'v', 60, 60_000)) return json({ error: 'rate limit' }, 429);
        const body = await req.json().catch(() => null);
        if (!body || !CHECKS[body.check]) return json({ error: 'unknown check', available: Object.keys(CHECKS) }, 400);
        const pay = await payFor(env, req, a, 'verify', x402.config(env));
        if (pay.resp) return pay.resp;
        const receipt = await runAndSign(env, k, pay.accountId, { check: body.check, params: body.params, claim: body.claim, paid_with: pay.paid_with, extra: pay.payment ? { payment: pay.payment } : {} }, allowPrivate);
        return withSettle(json({ receipt, verify_url: `/v1/receipts/${receipt.id}` }), pay.settleHeader);
      }
      let m;
      if (req.method === 'GET' && url.pathname === '/v1/log') return json(await tlog.logPage(env, Number(url.searchParams.get('after') || 0), Number(url.searchParams.get('limit') || 100)));
      if (req.method === 'GET' && url.pathname === '/v1/roots') {
        const rows = (await env.DB.prepare('SELECT day FROM roots ORDER BY day DESC LIMIT 60').all()).results;
        return json({ key_id: await keyId(k.publicKey), roots: await Promise.all(rows.map((r) => tlog.getRoot(env, r.day))) });
      }
      if (req.method === 'GET' && (m = url.pathname.match(/^\/v1\/roots\/(\d{4}-\d{2}-\d{2})$/))) {
        const r = await tlog.getRoot(env, m[1]);
        return r ? json(r) : json({ error: 'no sealed root for that day' }, 404);
      }
      if (req.method === 'POST' && (m = url.pathname.match(/^\/v1\/roots\/(\d{4}-\d{2}-\d{2})\/anchor$/))) {
        const b = await req.json().catch(() => ({}));
        if (await limited(env, ip, 'anchor', 10, 60_000)) return json({ error: 'rate limit' }, 429);
        const r = await tlog.recordAnchor(env, m[1], b.signature);
        return json(r, r.status);
      }
      if (req.method === 'GET' && (m = url.pathname.match(/^\/v1\/proof\/(rcpt_[a-f0-9]+)$/))) {
        const r = await tlog.proofFor(env, m[1]);
        if (r.status !== 200) return json({ error: r.error }, r.status);
        const b = { ...r.bundle }; if (url.searchParams.get('include') !== 'receipt') delete b.receipt;
        return json(b);
      }
      if (req.method === 'GET' && url.pathname === '/v1/methodology') return json({ methods: METHODS, note: 'Receipt fields: observed = raw evidence, fingerprint = sha256 of observed (no timestamps), at = UTC time of the check, duration_ms, method = the method entry used.' });
      if (req.method === 'POST' && url.pathname === '/v1/watches') {
        const a = await accountFor(env, req);
        if (await limited(env, ip, 'w', 20, 60_000)) return json({ error: 'rate limit' }, 429);
        const body = await req.json().catch(() => null);
        const mins = Number(body && body.recheck_after_minutes);
        if (!body || !CHECKS[body.check]) return json({ error: 'unknown check', available: Object.keys(CHECKS) }, 400);
        if (!Number.isInteger(mins) || mins < 5 || mins > 1440) return json({ error: 'recheck_after_minutes must be an integer from 5 to 1440' }, 400);
        const owner = a ? a.id : 'anon';
        const open = (await env.DB.prepare("SELECT COUNT(*) AS n FROM watches WHERE account_id=? AND status IN ('pending','running')").bind(owner).first()).n;
        if (open >= (a ? 20 : 500)) return json({ error: 'too many open watches' }, 429);
        // A watch is paid once up front: 2 receipts of credit, or one x402 payment at the watch price.
        const pay = await payFor(env, req, a, 'watch', x402.config(env), 2);
        if (pay.resp) return pay.resp;
        const baseline = await runAndSign(env, k, pay.accountId, { check: body.check, params: body.params, claim: body.claim, paid_with: pay.paid_with, extra: { watch_role: 'baseline', ...(pay.payment ? { payment: pay.payment } : {}) } }, allowPrivate);
        const id = 'watch_' + [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
        const dueAt = new Date(Date.now() + mins * 60_000).toISOString();
        await env.DB.prepare('INSERT INTO watches (id, account_id, check_kind, params, claim, after_minutes, due_at, baseline_receipt, baseline_fp, status, created) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
          .bind(id, owner, body.check, JSON.stringify(body.params || {}), String(body.claim || '').slice(0, 300), mins, dueAt, baseline.id, baseline.fingerprint, 'pending', new Date().toISOString()).run();
        return withSettle(json({ watch: id, status: 'pending', recheck_at: dueAt, baseline, status_url: `/v1/watches/${id}` }, 201), pay.settleHeader);
      }
      if (req.method === 'GET' && (m = url.pathname.match(/^\/v1\/watches\/(watch_[a-f0-9]+)$/))) {
        const a = await accountFor(env, req);
        const w = await env.DB.prepare('SELECT * FROM watches WHERE id=?').bind(m[1]).first();
        // Anonymous (x402-paid) watches are readable by whoever holds the unguessable id.
        if (!w || (w.account_id !== 'anon' && (!a || a.id !== w.account_id))) return json({ error: a || w ? 'not found' : 'not found' }, 404);
        const out = { watch: w.id, status: w.status, check: w.check_kind, claim: w.claim, recheck_at: w.due_at, baseline_receipt: w.baseline_receipt };
        if (w.status === 'done') {
          const row = await env.DB.prepare('SELECT body FROM receipts WHERE id=?').bind(w.result_receipt).first();
          Object.assign(out, { drift: !!w.drift, verdict: w.drift ? 'CHANGED since the claim' : 'unchanged since the claim', recheck_receipt: JSON.parse(row.body) });
        }
        return json(out);
      }
      if (req.method === 'GET' && (m = url.pathname.match(/^\/v1\/receipts\/(rcpt_[a-f0-9]+)$/))) {
        const row = await env.DB.prepare('SELECT body FROM receipts WHERE id = ?').bind(m[1]).first();
        if (!row) return json({ error: 'not found' }, 404);
        const r = JSON.parse(row.body);
        return json({ receipt: r, signature_valid: (await verifyReceipt(r, k.publicKey)).valid });
      }
      if (req.method === 'POST' && url.pathname === '/v1/receipts/verify') {
        const body = await req.json().catch(() => ({}));
        return json(await verifyReceipt(body.receipt || {}, k.publicKey));
      }
      if (req.method === 'GET' && url.pathname === '/v1/recent') {
        const rows = (await env.DB.prepare('SELECT body FROM receipts ORDER BY seq DESC LIMIT 10').all()).results;
        return json({ receipts: rows.map((x) => JSON.parse(x.body)).map((r) => ({ id: r.id, check: r.check, claim: r.claim, passed: r.passed, at: r.at })) });
      }
      if (req.method === 'GET' && env.ASSETS && !url.pathname.startsWith('/v1/')) return env.ASSETS.fetch(req);
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 400);
    }
  },
};
