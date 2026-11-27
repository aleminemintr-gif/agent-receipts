// Cloudflare Worker entry. Storage: D1. Secret: SIGNING_KEY_PKCS8_B64.
import { importPrivate, publicFromPrivate, publicPem, keyId, signReceipt, verifyReceipt, sha256 } from './receipt-web.mjs';
import { runCheck, CHECKS } from './checks.mjs';

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

export default {
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
        const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM accounts').first()).n;
        return json({ service: 'agent-receipts', version: '0.1.0', runtime: 'cloudflare-workers', key_id: await keyId(k.publicKey), checks: Object.keys(CHECKS), free_per_day: FREE_PER_DAY,
          early_program: { limit: earlyLimit, points_each: EARLY_POINTS, taken: n, open: n < earlyLimit, note: 'Points are non-transferable credits for receipts. Not a token.' } });
      }
      if (req.method === 'GET' && url.pathname === '/.well-known/receipt-key') {
        return new Response(await publicPem(k.publicKey), { headers: { 'content-type': 'application/x-pem-file' } });
      }
      if (req.method === 'POST' && url.pathname === '/v1/accounts') {
        if (await limited(env, ip, 'acct', 5, 3600_000)) return json({ error: 'too many accounts from this address, try later' }, 429);
        const body = await req.json().catch(() => ({}));
        const raw = 'ar_' + btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
        const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM accounts').first()).n;
        const early = n < earlyLimit;
        const a = { id: 'acct_' + [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(16).padStart(2, '0')).join(''), label: String(body.label || '').slice(0, 60),
          created: new Date().toISOString(), early_rank: early ? n + 1 : null, points: early ? EARLY_POINTS : 0, day: today(), used_today: 0, total_receipts: 0 };
        await env.DB.prepare('INSERT INTO accounts (key_hash,id,label,created,early_rank,points,day,used_today,total_receipts) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(await sha256(raw), a.id, a.label, a.created, a.early_rank, a.points, a.day, 0, 0).run();
        return json({ api_key: raw, account: view(a) }, 201);
      }
      if (req.method === 'GET' && url.pathname === '/v1/me') {
        const a = await accountFor(env, req);
        return a ? json(view(a)) : json({ error: 'invalid api key' }, 401);
      }
      if (req.method === 'POST' && url.pathname === '/v1/verify') {
        const a = await accountFor(env, req);
        if (!a) return json({ error: 'invalid api key' }, 401);
        if (await limited(env, ip, 'v', 60, 60_000)) return json({ error: 'rate limit' }, 429);
        const body = await req.json().catch(() => null);
        if (!body || !CHECKS[body.check]) return json({ error: 'unknown check', available: Object.keys(CHECKS) }, 400);
        // Charge atomically: one conditional UPDATE decides free vs point.
        let paid_with = null;
        const day = today();
        const free = await env.DB.prepare('UPDATE accounts SET day=?, used_today = CASE WHEN day=? THEN used_today+1 ELSE 1 END, total_receipts=total_receipts+1 WHERE key_hash=? AND ((day=? AND used_today<?) OR day<>?)')
          .bind(day, day, a.key_hash, day, FREE_PER_DAY, day).run();
        if (free.meta.changes) paid_with = 'free';
        else {
          const pt = await env.DB.prepare('UPDATE accounts SET points=points-1, total_receipts=total_receipts+1 WHERE key_hash=? AND points>0').bind(a.key_hash).run();
          if (pt.meta.changes) paid_with = 'point';
        }
        if (!paid_with) return json({ error: 'no free receipts or points left today' }, 402);
        const result = await runCheck(body.check, body.params, allowPrivate);
        const last = await env.DB.prepare('SELECT id FROM receipts ORDER BY seq DESC LIMIT 1').first();
        const receipt = await signReceipt(k, { account: a.id, check: body.check, params: body.params || {}, claim: String(body.claim || '').slice(0, 300),
          passed: result.passed, observed: result.observed, error: result.error, at: new Date().toISOString(), paid_with }, last && last.id);
        await env.DB.prepare('INSERT INTO receipts (id, body) VALUES (?, ?)').bind(receipt.id, JSON.stringify(receipt)).run();
        return json({ receipt, verify_url: `/v1/receipts/${receipt.id}` });
      }
      let m;
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
