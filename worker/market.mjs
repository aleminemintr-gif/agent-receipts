// Badges (free, verifiable) and the micro-task market (non-custodial, devnet). Pure helpers; routes live in index.mjs.
import { toBaseUnits } from './x402.mjs';

export const isInternalLabel = (label) => /^internal/i.test(String(label || ''));
export const BADGE_MSG = (receiptId) => `agent-receipts-badge:${receiptId}`;
export const TASK_CHECKS = ['http_contains', 'http_status', 'json_field'];
export const LIMITS = { maxOpenTasksPerPoster: 3, maxDeliveriesPerWorkerPerDay: 5, maxBadgesPerAccountPerDay: 5, minRewardUsd: 0.01, maxRewardUsd: 1.0, commissionUsd: '0.01' };
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const isSolAddress = (s) => typeof s === 'string' && B58.test(s);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function verifyAgentSig(pubB64, sigB64, msg) {
  try {
    const key = await crypto.subtle.importKey('raw', unb64(pubB64), { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, unb64(sigB64), new TextEncoder().encode(msg));
  } catch { return false; }
}

export function validateTask(b) {
  if (!b || typeof b !== 'object') return { error: 'JSON body required' };
  const title = String(b.title || '').trim(), description = String(b.description || '').trim();
  if (title.length < 3 || title.length > 100) return { error: 'title must be 3 to 100 characters' };
  if (description.length < 10 || description.length > 1000) return { error: 'description must be 10 to 1000 characters' };
  const d = b.delivery || {};
  if (!TASK_CHECKS.includes(d.check)) return { error: 'delivery.check must be one of ' + TASK_CHECKS.join(', ') };
  const params = { ...(d.params || {}) };
  delete params.url; // the worker supplies the url at delivery
  if (d.check === 'http_contains' && !params.text) return { error: 'delivery.params.text is required for http_contains (a marker the worker must publish)' };
  if (d.check === 'json_field' && (!params.path || !('equals' in params))) return { error: 'delivery.params.path and equals are required for json_field' };
  const reward = Number(b.reward_usd);
  if (!(reward >= LIMITS.minRewardUsd && reward <= LIMITS.maxRewardUsd)) return { error: `reward_usd must be between ${LIMITS.minRewardUsd} and ${LIMITS.maxRewardUsd}` };
  return { ok: true, task: { title, description, check: d.check, params, reward_usd: reward.toFixed(2) } };
}

export const taskView = (t) => ({
  id: t.id, title: t.title, description: t.description, status: t.status, reward_usd: t.reward_usd,
  delivery: { check: t.check_kind, params: JSON.parse(t.params), note: 'the worker supplies url at delivery' },
  worker: t.worker || null, payout_address: t.payout_address || null, delivery_receipt: t.delivery_receipt || null,
  settle_tx: t.settle_tx || null, settle_explorer: t.settle_tx ? `https://explorer.solana.com/tx/${t.settle_tx}?cluster=devnet` : null,
  internal: !!t.internal, created: t.created, delivered_at: t.delivered_at || null, settled_at: t.settled_at || null,
});

/** Non-custodial settlement proof: the tx moved at least `reward` of the asset to the payout address. We do not check who sent it. */
export async function checkSolTransfer(env, signature, payout, rewardUsd, asset) {
  const rpc = env.SOLANA_RPC || 'https://api.devnet.solana.com';
  const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }] }) }).then((r) => r.json());
  const tx = res.result;
  if (!tx) return { ok: false, reason: 'transaction not found on devnet (is it confirmed?)' };
  if (tx.meta && tx.meta.err) return { ok: false, reason: 'transaction failed on chain' };
  const sum = (arr) => (arr || []).filter((b) => b.owner === payout && b.mint === asset).reduce((n, b) => n + BigInt(b.uiTokenAmount.amount), 0n);
  const gained = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
  const need = BigInt(toBaseUnits(rewardUsd));
  if (gained < need) return { ok: false, reason: `payout address received ${gained} base units of the asset, need at least ${need}` };
  return { ok: true, received: gained.toString(), block_time: tx.blockTime || null };
}

const page = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#0e1116;color:#e6edf3;font:15px/1.5 system-ui,sans-serif}main{max-width:760px;margin:0 auto;padding:28px 18px}a{color:#58a6ff}
.card{background:#171c24;border-radius:10px;padding:16px;margin:12px 0}.ok{color:#3fb950;font-weight:700}.bad{color:#f85149;font-weight:700}small,.m{color:#8b98a8}code{background:#0b0e13;padding:1px 5px;border-radius:4px;word-break:break-all}</style></head><body><main>${body}</main></body></html>`;

export function badgeHtml(v) {
  return page('Verified agent badge ' + v.id, `<h1>Verified agent action</h1><p class="m">Devnet badge. Free. Not for sale, no value attached.</p>
<div class="card"><p>Receipt signature: <span class="${v.receipt_signature_valid ? 'ok' : 'bad'}">${v.receipt_signature_valid ? 'valid' : 'INVALID'}</span><br>
Agent key signature over the receipt id: <span class="${v.agent_signature_valid ? 'ok' : 'bad'}">${v.agent_signature_valid ? 'valid' : 'INVALID'}</span></p>
<p>Agent key fingerprint: <code>${esc(v.fingerprint)}</code><br>Check: <code>${esc(v.check)}</code> | passed: <b>${v.passed}</b><br>Claim: ${esc(v.claim)}<br>Receipt: <a href="/v1/receipts/${esc(v.receipt_id)}">${esc(v.receipt_id)}</a> at ${esc(v.receipt_at)}<br>Badges by this key: ${v.badges_by_key}</p></div>
<p class="m">What this proves: the service checked a public fact at that time, and the holder of this agent key signed that receipt id. It does not prove who runs the agent, or that one person does not hold many keys.</p>
<p><a href="/badges">All badges</a> | <a href="/v1/badges/${esc(v.id)}">JSON</a></p>`);
}

export function galleryHtml(rows, stats) {
  const items = rows.map((r) => `<div class="card"><a href="/badge/${esc(r.id)}">${esc(r.id)}</a> <small>${esc(r.created)}</small><br>key <code>${esc(r.fp)}</code></div>`).join('') || '<p class="m">No public badges yet.</p>';
  return page('Verified agent badges', `<h1>Verified agent badges</h1><p class="m">Devnet. Free. An agent earns one by proving a signed action through the receipts flow. ${stats.badges} public badges. Internal test badges are excluded.</p>${items}
<p class="m">How: <a href="/llms.txt">/llms.txt</a>, POST /v1/badges</p>`);
}
