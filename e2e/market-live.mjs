// INTERNAL live test of badges + micro-task market on devnet. Accounts are labelled internal-dogfood (hidden from public views).
//   node e2e/market-live.mjs <base-url>
import crypto from 'node:crypto';
import fs from 'node:fs';
import { Connection, Keypair, PublicKey, clusterApiUrl } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, transfer } from '@solana/spl-token';
const base = process.argv[2];
const J = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
const post = (p, key, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) }, body: JSON.stringify(body) }).then(J);
const bits = (h) => { let c = 0; for (const x of h) { const v = parseInt(x, 16); if (v === 0) { c += 4; continue; } c += Math.clz32(v) - 28; break; } return c; };
async function agent() {
  const kp = crypto.generateKeyPairSync('ed25519');
  const pub = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
  const ch = await fetch(base + '/v1/claim/challenge').then(J).then((r) => r.body);
  let n = 0; while (bits(crypto.createHash('sha256').update(`${ch.nonce}:${pub}:${n}`).digest('hex')) < ch.pow_bits) n++;
  const r = await post('/v1/claim', null, { challenge_id: ch.challenge_id, public_key: pub, signature: crypto.sign(null, Buffer.from(ch.sign), kp.privateKey).toString('base64'), pow: String(n), label: 'internal-dogfood-market' });
  if (r.status !== 201) throw new Error('claim failed ' + r.status + ' ' + JSON.stringify(r.body));
  return { kp, key: r.body.api_key };
}
const out = [];
const step = (name, ok, detail) => { out.push({ name, ok, detail }); };
const P = await agent(), W = await agent();
// badge for W
const rc = (await post('/v1/verify', W.key, { check: 'http_contains', claim: '[internal-dogfood] W badge', params: { url: 'https://example.com', text: 'Example Domain' } })).body.receipt;
const badge = await post('/v1/badges', W.key, { receipt_id: rc.id, signature: crypto.sign(null, Buffer.from('agent-receipts-badge:' + rc.id), W.kp.privateKey).toString('base64') });
step('badge issued', badge.status === 201 && badge.body.receipt_signature_valid && badge.body.agent_signature_valid, badge.body.id || JSON.stringify(badge.body));
const pubBadges = await fetch(base + '/v1/badges').then(J);
step('internal badge hidden from public gallery', !JSON.stringify(pubBadges.body).includes(badge.body.id), '');
// task
const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(new URL('./.wallet.json', import.meta.url)))));
const payoutKp = Keypair.generate();
const task = await post('/v1/tasks', P.key, { title: '[internal-dogfood] host a marker', description: 'Internal test task: any page containing the marker.', delivery: { check: 'http_contains', params: { text: 'Example Domain' } }, reward_usd: 0.05 });
step('task posted', task.status === 201, task.body.task ? task.body.task.id : JSON.stringify(task.body));
const tid = task.body.task.id;
const del = await post(`/v1/tasks/${tid}/deliver`, W.key, { url: 'https://example.com', payout_address: payoutKp.publicKey.toBase58() });
step('delivery proven by signed receipt', del.body.delivered === true, del.body.receipt && del.body.receipt.id);
const conn = new Connection(clusterApiUrl('devnet'), 'confirmed');
const mint = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
const from = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, wallet.publicKey);
const to = await getOrCreateAssociatedTokenAccount(conn, wallet, mint, payoutKp.publicKey);
const sig = await transfer(conn, wallet, from.address, to.address, wallet, 50000n);
await conn.confirmTransaction(sig, 'confirmed');
let st; for (let i = 0; i < 5; i++) { st = await post(`/v1/tasks/${tid}/settle`, P.key, { tx: sig }); if (st.status === 200) break; await new Promise((r) => setTimeout(r, 2000)); }
step('settled with on-chain payout', st.status === 200 && st.body.task.status === 'settled', sig);
const stats = await fetch(base + '/v1/stats').then(J);
console.log(JSON.stringify({ at: new Date().toISOString(), steps: out, settle_tx: sig, explorer: `https://explorer.solana.com/tx/${sig}?cluster=devnet`, stats: stats.body }, null, 1));
