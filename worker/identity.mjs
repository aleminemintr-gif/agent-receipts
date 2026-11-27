// Agent identity claim: trial credits are bound to a public-key fingerprint.
// Flow: GET /v1/claim/challenge -> sign the nonce with your Ed25519 key and solve a small
// proof of work -> POST /v1/claim. One grant per key. Credits are a ledger number on the
// account; there is no transfer route.
//
// Honest limit: keys are free to make. This slows farming, it does not stop a Sybil attacker.
import { sha256 } from './receipt-web.mjs';

export const EARLY_LIMIT = 10_000, EARLY_POINTS = 25, CLAIMS_PER_IP_DAY = 3, CHALLENGE_TTL_MS = 5 * 60_000;
export const MSG = (nonce) => `agent-receipts-claim:v1:${nonce}`;
const today = () => new Date().toISOString().slice(0, 10);
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const rand = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Difficulty rises as identities are claimed, so a mass farm gets more expensive over time. */
export const difficulty = (env, taken) => (env.CLAIM_BITS ? Number(env.CLAIM_BITS) : 16 + Math.min(6, Math.floor(taken / 2000)));

export function leadingZeroBits(hexStr) {
  let n = 0;
  for (const ch of hexStr) { const v = parseInt(ch, 16); if (v === 0) { n += 4; continue; } n += Math.clz32(v) - 28; break; }
  return n;
}

export async function ipHash(ip) { return (await sha256('ip:' + ip + ':' + today())).slice(0, 24); }

export async function issueChallenge(env) {
  const taken = (await env.DB.prepare('SELECT COUNT(*) AS n FROM identities').first()).n;
  const c = { id: 'chal_' + rand(8), nonce: rand(16), bits: difficulty(env, taken), expires: Date.now() + CHALLENGE_TTL_MS };
  await env.DB.prepare('DELETE FROM challenges WHERE expires < ?').bind(Date.now()).run();
  await env.DB.prepare('INSERT INTO challenges (id, nonce, bits, expires, used) VALUES (?,?,?,?,0)').bind(c.id, c.nonce, c.bits, c.expires).run();
  return { challenge_id: c.id, nonce: c.nonce, pow_bits: c.bits, expires_in_seconds: CHALLENGE_TTL_MS / 1000,
    sign: MSG(c.nonce), pow: `find a counter so that sha256("<nonce>:<public_key_b64>:<counter>") has at least ${c.bits} leading zero bits` };
}

/** Returns {status, body}. `existing` is the account row when the caller sent a valid API key. */
export async function claim(env, ip, b, existing, newAccount) {
  const earlyLimit = Number(env.EARLY_LIMIT || EARLY_LIMIT);
  if (!b || !b.challenge_id || !b.public_key || !b.signature || b.pow === undefined) return { status: 400, body: { error: 'need challenge_id, public_key (base64 raw Ed25519), signature, pow' } };
  const ch = await env.DB.prepare('SELECT * FROM challenges WHERE id = ?').bind(b.challenge_id).first();
  if (!ch || ch.used || ch.expires < Date.now()) return { status: 400, body: { error: 'challenge unknown, used or expired' } };
  let raw;
  try { raw = unb64(b.public_key); if (raw.length !== 32) throw new Error(); } catch { return { status: 400, body: { error: 'public_key must be 32 raw bytes, base64' } }; }
  // 1) proof of work
  const h = await sha256(`${ch.nonce}:${b.public_key}:${b.pow}`);
  if (leadingZeroBits(h) < ch.bits) return { status: 400, body: { error: 'proof of work too weak', required_bits: ch.bits } };
  // 2) the agent proves it holds the private key
  let ok = false;
  try {
    const key = await crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']);
    ok = await crypto.subtle.verify({ name: 'Ed25519' }, key, unb64(b.signature), new TextEncoder().encode(MSG(ch.nonce)));
  } catch { ok = false; }
  if (!ok) return { status: 400, body: { error: 'signature does not verify for this public key' } };
  // 3) burn the challenge atomically so it cannot be replayed
  const used = await env.DB.prepare('UPDATE challenges SET used = 1 WHERE id = ? AND used = 0').bind(ch.id).run();
  if (!used.meta.changes) return { status: 400, body: { error: 'challenge already used' } };
  const fp = 'agent_' + (await sha256(raw)).slice(0, 16);
  if (await env.DB.prepare('SELECT 1 AS x FROM identities WHERE fp = ?').bind(fp).first()) return { status: 409, body: { error: 'this key has already claimed its credits', fingerprint: fp } };
  // 4) per-IP daily cap (IP stored only as a daily hash)
  const ih = await ipHash(ip);
  const day = today();
  await env.DB.prepare('INSERT OR IGNORE INTO ip_daily (k, day, n) VALUES (?,?,0)').bind('claim:' + ih, day).run();
  const bump = await env.DB.prepare('UPDATE ip_daily SET n = n + 1 WHERE k = ? AND day = ? AND n < ?').bind('claim:' + ih, day, CLAIMS_PER_IP_DAY).run();
  if (!bump.meta.changes) return { status: 429, body: { error: `at most ${CLAIMS_PER_IP_DAY} identity claims per address per day` } };
  const taken = (await env.DB.prepare('SELECT COUNT(*) AS n FROM identities').first()).n;
  const rank = taken < earlyLimit ? taken + 1 : null;
  const points = rank ? EARLY_POINTS : 0;
  let accountId, apiKey = null;
  if (existing) {
    if (await env.DB.prepare('SELECT 1 AS x FROM identities WHERE account_id = ?').bind(existing.id).first()) return { status: 409, body: { error: 'this account already has an identity' } };
    await env.DB.prepare('UPDATE accounts SET points = points + ?, early_rank = COALESCE(early_rank, ?) WHERE key_hash = ?').bind(points, rank, existing.key_hash).run();
    accountId = existing.id;
  } else {
    const made = await newAccount(points, rank);
    accountId = made.account.id; apiKey = made.api_key;
  }
  const ins = await env.DB.prepare('INSERT OR IGNORE INTO identities (fp, account_id, pubkey, rank, points, ip_hash, created) VALUES (?,?,?,?,?,?,?)').bind(fp, accountId, b.public_key, rank, points, ih, new Date().toISOString()).run();
  if (!ins.meta.changes) return { status: 409, body: { error: 'this key has already claimed its credits', fingerprint: fp } };
  return { status: 201, body: { fingerprint: fp, account_id: accountId, ...(apiKey ? { api_key: apiKey, note: 'shown once' } : {}), points_granted: points, early_rank: rank,
    note: 'Points are non-transferable credits tied to this key fingerprint. They are not a token.' } };
}

/** Daily per-account cap on spending points, so one drained key cannot burn the pool at once. */
export const POINTS_PER_KEY_DAY = 20;
export async function takePointAllowance(env, accountId) {
  const day = today();
  await env.DB.prepare('INSERT OR IGNORE INTO ip_daily (k, day, n) VALUES (?,?,0)').bind('pt:' + accountId, day).run();
  const r = await env.DB.prepare('UPDATE ip_daily SET n = n + 1 WHERE k = ? AND day = ? AND n < ?').bind('pt:' + accountId, day, POINTS_PER_KEY_DAY).run();
  return !!r.meta.changes;
}
/** Daily per-address cap on credit-paid receipts (free + points). */
export const CREDIT_RECEIPTS_PER_IP_DAY = 150;
export async function takeIpAllowance(env, ip) {
  const ih = await ipHash(ip), day = today();
  await env.DB.prepare('INSERT OR IGNORE INTO ip_daily (k, day, n) VALUES (?,?,0)').bind('use:' + ih, day).run();
  const r = await env.DB.prepare('UPDATE ip_daily SET n = n + 1 WHERE k = ? AND day = ? AND n < ?').bind('use:' + ih, day, CREDIT_RECEIPTS_PER_IP_DAY).run();
  return !!r.meta.changes;
}
