#!/usr/bin/env node
// Standalone receipt verifier. One file, no dependencies, Node 20+. Works offline.
//
//   node verify.mjs --bundle proof.json --key receipt-key.pem [--receipt receipt.json] [--check-anchor]
//
// proof.json comes from GET /v1/proof/<receipt id>?include=receipt (the receipt may also be passed separately).
// The public key comes from GET /.well-known/receipt-key. It checks, with no trust in the server:
//   1. the receipt id matches its content and its Ed25519 signature is valid
//   2. the receipt hashes into the Merkle leaf, and the audit path folds to the published root
//   3. the daily root statement is signed by the same key
//   4. (optional, online) the root was written to Solana as a memo
import crypto from 'node:crypto';
import fs from 'node:fs';

// --- canonical JSON: keys sorted, undefined dropped. Must match the service exactly.
export function canonical(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
}
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const hex = (b) => b.toString('hex');
export const leafHash = (text) => hex(sha(Buffer.concat([Buffer.from([0]), Buffer.from(text)])));
const nodeHash = (l, r) => hex(sha(Buffer.concat([Buffer.from([1]), Buffer.from(l, 'hex'), Buffer.from(r, 'hex')])));
export const foldProof = (leaf, path) => path.reduce((acc, s) => (s.side === 'left' ? nodeHash(s.hash, acc) : nodeHash(acc, s.hash)), leaf);
const sigOk = (obj, sigB64, pem) => crypto.verify(null, Buffer.from(canonical(obj)), crypto.createPublicKey(pem), Buffer.from(sigB64, 'base64'));
const memoText = (day, root) => `agent-receipts:v1:${day}:${root}`;

export function verifyBundle(bundle, receipt, pem) {
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  const r = receipt || bundle.receipt;
  if (!r) { add('receipt present', false, 'pass --receipt or fetch the bundle with ?include=receipt'); return checks; }
  const { sig, ...payload } = r; const { id, ...unsigned } = payload;
  add('receipt id matches content', 'rcpt_' + hex(sha(Buffer.from(canonical(unsigned)))).slice(0, 24) === id, id);
  let s1 = false; try { s1 = sigOk(payload, sig, pem); } catch {}
  add('receipt signature valid (Ed25519)', s1);
  add('bundle is for this receipt', bundle.receipt_id === id);
  const leaf = leafHash(canonical(r));
  add('receipt hashes to the Merkle leaf', leaf === bundle.leaf);
  const root = foldProof(leaf, bundle.path || []);
  add('audit path folds to the published root', root === bundle.root.root, root.slice(0, 16) + '...');
  const { sig: rsig, ...stmt } = bundle.root;
  let s2 = false; try { s2 = sigOk(stmt, rsig, pem); } catch {}
  add('daily root statement signed by the same key', s2, `day ${stmt.day}, ${stmt.tree_size} receipts`);
  add('receipt belongs to that day', String(r.at).slice(0, 10) === stmt.day);
  return checks;
}

export async function checkAnchor(bundle, rpc = 'https://api.devnet.solana.com') {
  const a = bundle.root.anchor;
  if (!a) return { name: 'anchored on Solana', ok: false, detail: 'this root has no anchor yet' };
  const res = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [a.tx, { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0 }] }) }).then((r) => r.json());
  const ixs = (res.result && res.result.transaction.message.instructions) || [];
  const ok = ixs.some((i) => i.program === 'spl-memo' && i.parsed === memoText(bundle.root.day, bundle.root.root));
  return { name: 'root memo found on Solana', ok, detail: a.tx };
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
  if (!arg('bundle') || !arg('key')) { console.error('usage: node verify.mjs --bundle proof.json --key receipt-key.pem [--receipt receipt.json] [--check-anchor]'); process.exit(2); }
  const bundle = JSON.parse(fs.readFileSync(arg('bundle'), 'utf8'));
  const receipt = arg('receipt') ? JSON.parse(fs.readFileSync(arg('receipt'), 'utf8')) : null;
  const checks = verifyBundle(bundle, receipt, fs.readFileSync(arg('key'), 'utf8'));
  if (process.argv.includes('--check-anchor')) checks.push(await checkAnchor(bundle, arg('rpc') || undefined));
  for (const c of checks) console.log((c.ok ? 'PASS ' : 'FAIL ') + c.name + (c.detail ? '  (' + c.detail + ')' : ''));
  const bad = checks.filter((c) => !c.ok).length;
  console.log(bad ? `\n${bad} check(s) failed` : '\nAll checks passed');
  process.exit(bad ? 1 : 0);
}
