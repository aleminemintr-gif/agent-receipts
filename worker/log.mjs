// Public transparency log: hash-chained receipts (already) + one signed Merkle root per UTC day,
// optionally anchored on Solana as a memo. The log publishes commitments, never receipt contents.
import { canonical, keyId, signStatement } from './receipt-web.mjs';
import { leafHash, merkleRoot, merkleProof } from '../src/merkle.mjs';

export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const memoText = (day, root) => `agent-receipts:v1:${day}:${root}`;
export const leafOf = (receiptJson) => leafHash(canonical(typeof receiptJson === 'string' ? JSON.parse(receiptJson) : receiptJson));

async function backfillLeaves(env) {
  await env.DB.prepare("INSERT OR IGNORE INTO leaves (seq, id, day) SELECT seq, id, substr(json_extract(body,'$.at'),1,10) FROM receipts").run();
}
async function dayRows(env, day) {
  return (await env.DB.prepare('SELECT r.seq AS seq, r.id AS id, r.body AS body FROM receipts r JOIN leaves l ON l.seq = r.seq WHERE l.day = ? ORDER BY r.seq').bind(day).all()).results;
}

/** Seal every finished UTC day that has receipts and no root yet. Sealing waits 10 min past midnight. */
export async function closeDays(env, keys, nowMs = Date.now()) {
  await backfillLeaves(env);
  const sealed = [];
  const cutoff = new Date(nowMs - 10 * 60_000).toISOString().slice(0, 10); // days strictly before this are closed
  const days = (await env.DB.prepare('SELECT DISTINCT day FROM leaves WHERE day < ? AND day NOT IN (SELECT day FROM roots) ORDER BY day LIMIT 7').bind(cutoff).all()).results;
  for (const { day } of days) {
    const rows = await dayRows(env, day);
    if (!rows.length) continue;
    const leaves = await Promise.all(rows.map((r) => leafOf(r.body)));
    const prev = await env.DB.prepare('SELECT statement FROM roots ORDER BY day DESC LIMIT 1').first();
    const st = await signStatement(keys, { v: 1, type: 'daily-root', day, tree_size: rows.length, root: await merkleRoot(leaves),
      first_seq: rows[0].seq, last_seq: rows[rows.length - 1].seq, prev_root: prev ? JSON.parse(prev.statement).root : null,
      kid: await keyId(keys.publicKey), sealed_at: new Date(nowMs).toISOString() });
    await env.DB.prepare('INSERT OR IGNORE INTO roots (day, statement) VALUES (?, ?)').bind(day, JSON.stringify(st)).run();
    sealed.push(day);
  }
  return sealed;
}

export async function getRoot(env, day) {
  const r = await env.DB.prepare('SELECT * FROM roots WHERE day = ?').bind(day).first();
  return r ? { ...JSON.parse(r.statement), anchor: r.anchor_tx ? { tx: r.anchor_tx, cluster: r.anchor_cluster, at: r.anchor_at, memo: memoText(day, JSON.parse(r.statement).root) } : null } : null;
}

/** Inclusion proof bundle for one receipt id. Null if its day is not sealed yet. */
export async function proofFor(env, id) {
  await backfillLeaves(env);
  const row = await env.DB.prepare('SELECT l.day AS day, l.seq AS seq FROM leaves l WHERE l.id = ?').bind(id).first();
  if (!row) return { error: 'not found', status: 404 };
  const st = await getRoot(env, row.day);
  if (!st) return { error: `day ${row.day} is not sealed yet (roots are published about 10 minutes after 00:00 UTC)`, status: 404 };
  const rows = await dayRows(env, row.day);
  const idx = rows.findIndex((r) => r.id === id);
  const leaves = await Promise.all(rows.map((r) => leafOf(r.body)));
  if (rows.length !== st.tree_size) return { error: 'day changed after sealing; refusing to prove', status: 409 };
  return { status: 200, bundle: { v: 1, receipt_id: id, day: row.day, leaf_index: idx, leaf: leaves[idx], path: await merkleProof(leaves, idx), root: st, receipt: JSON.parse(rows[idx].body) } };
}

/** Public log page: commitments only. */
export async function logPage(env, after = 0, limit = 100) {
  await backfillLeaves(env);
  const rows = (await env.DB.prepare('SELECT seq, id, body FROM receipts WHERE seq > ? ORDER BY seq LIMIT ?').bind(after, Math.min(limit, 200)).all()).results;
  const entries = [];
  for (const r of rows) { const b = JSON.parse(r.body); entries.push({ seq: r.seq, id: r.id, prev: b.prev, at: b.at, leaf: await leafOf(b) }); }
  return { entries, next_after: rows.length ? rows[rows.length - 1].seq : after };
}

/** Anyone may submit a Solana tx signature; we accept it only if the chain itself shows our memo. */
export async function recordAnchor(env, day, signature) {
  const st = await getRoot(env, day);
  if (!st) return { status: 404, error: 'no sealed root for that day' };
  if (st.anchor) return { status: 200, anchor: st.anchor, note: 'already anchored; first anchor is kept' };
  if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(signature || '')) return { status: 400, error: 'invalid signature format' };
  const rpc = env.SOLANA_RPC || 'https://api.devnet.solana.com';
  const cluster = env.ANCHOR_CLUSTER || 'devnet';
  const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] }) }).then((r) => r.json());
  const tx = res.result;
  if (!tx) return { status: 422, error: 'transaction not found on ' + cluster };
  if (tx.meta && tx.meta.err) return { status: 422, error: 'transaction failed on chain' };
  const want = memoText(day, st.root);
  const ixs = (tx.transaction && tx.transaction.message && tx.transaction.message.instructions) || [];
  const ok = ixs.some((ix) => (ix.programId === MEMO_PROGRAM || ix.program === 'spl-memo') && ix.parsed === want);
  if (!ok) return { status: 422, error: 'memo in that transaction does not match the root', expected_memo: want };
  const at = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : new Date().toISOString();
  await env.DB.prepare('UPDATE roots SET anchor_tx=?, anchor_cluster=?, anchor_at=? WHERE day=? AND anchor_tx IS NULL').bind(signature, cluster, at, day).run();
  return { status: 200, anchor: { tx: signature, cluster, at, memo: want } };
}
