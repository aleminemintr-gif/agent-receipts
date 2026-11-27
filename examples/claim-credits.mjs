// Agent side of the identity claim. Makes (or loads) an Ed25519 identity, signs the nonce,
// solves the proof of work, and claims the trial credits. Node 20+, no dependencies.
//   node examples/claim-credits.mjs https://agent-receipts.amin-experiments.workers.dev [identity.json]
import crypto from 'node:crypto';
import fs from 'node:fs';
const [base, file = 'agent-identity.json'] = process.argv.slice(2);
let kp;
if (fs.existsSync(file)) { const j = JSON.parse(fs.readFileSync(file)); kp = { privateKey: crypto.createPrivateKey(j.private), publicKey: crypto.createPublicKey(j.private) }; }
else { kp = crypto.generateKeyPairSync('ed25519'); fs.writeFileSync(file, JSON.stringify({ private: kp.privateKey.export({ type: 'pkcs8', format: 'pem' }) }), { mode: 0o600 }); }
const pub = kp.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32).toString('base64');
const ch = await fetch(base + '/v1/claim/challenge').then((r) => r.json());
const bits = (h) => { let c = 0; for (const x of h) { const v = parseInt(x, 16); if (v === 0) { c += 4; continue; } c += Math.clz32(v) - 28; break; } return c; };
let n = 0; while (bits(crypto.createHash('sha256').update(`${ch.nonce}:${pub}:${n}`).digest('hex')) < ch.pow_bits) n++;
const signature = crypto.sign(null, Buffer.from(ch.sign), kp.privateKey).toString('base64');
const res = await fetch(base + '/v1/claim', { method: 'POST', body: JSON.stringify({ challenge_id: ch.challenge_id, public_key: pub, signature, pow: String(n) }) });
console.log(res.status, await res.json());
