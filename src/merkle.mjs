// RFC 6962-style Merkle tree (domain-separated: 0x00 leaf, 0x01 node), SHA-256.
// Uses WebCrypto only, so the same file runs in Node 20+ and in Workers.
const enc = new TextEncoder();
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (h) => Uint8Array.from(h.match(/../g) || [], (x) => parseInt(x, 16));
async function sha(bytes) { return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)); }
const cat = (...parts) => { const o = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; };

export async function leafHash(text) { return hex(await sha(cat(Uint8Array.of(0), enc.encode(text)))); }
export async function nodeHash(l, r) { return hex(await sha(cat(Uint8Array.of(1), unhex(l), unhex(r)))); }
const split = (n) => { let k = 1; while (k * 2 < n) k *= 2; return k; }; // largest power of two < n

export async function merkleRoot(leaves) {
  if (leaves.length === 0) return hex(await sha(new Uint8Array()));
  if (leaves.length === 1) return leaves[0];
  const k = split(leaves.length);
  return nodeHash(await merkleRoot(leaves.slice(0, k)), await merkleRoot(leaves.slice(k)));
}

/** Audit path for leaf `m`: siblings from the leaf up, each with the side it sits on. */
export async function merkleProof(leaves, m) {
  if (leaves.length <= 1) return [];
  const k = split(leaves.length);
  if (m < k) return [...(await merkleProof(leaves.slice(0, k), m)), { side: 'right', hash: await merkleRoot(leaves.slice(k)) }];
  return [...(await merkleProof(leaves.slice(k), m - k)), { side: 'left', hash: await merkleRoot(leaves.slice(0, k)) }];
}

export async function foldProof(leaf, path) {
  let acc = leaf;
  for (const s of path) acc = s.side === 'left' ? await nodeHash(s.hash, acc) : await nodeHash(acc, s.hash);
  return acc;
}
