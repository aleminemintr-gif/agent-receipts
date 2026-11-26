// Signed receipts: canonical JSON + Ed25519 + hash chain.
import crypto from 'node:crypto';

export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

export function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey,
    privateKey,
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

export function loadKeyPair(privatePem) {
  const privateKey = crypto.createPrivateKey(privatePem);
  const publicKey = crypto.createPublicKey(privateKey);
  return { privateKey, publicKey, publicPem: publicKey.export({ type: 'spki', format: 'pem' }) };
}

export const keyId = (publicPem) => sha256(publicPem).slice(0, 16);

/** Build and sign a receipt. `body` is the evidence; `prev` links the chain. */
export function signReceipt(keys, body, prev) {
  const unsigned = { v: 1, ...body, prev: prev || null, kid: keyId(keys.publicPem) };
  const id = 'rcpt_' + sha256(canonical(unsigned)).slice(0, 24);
  const payload = { ...unsigned, id };
  const sig = crypto.sign(null, Buffer.from(canonical(payload)), keys.privateKey).toString('base64');
  return { ...payload, sig };
}

/** Verify a receipt against a public key. Anyone can do this offline. */
export function verifyReceipt(receipt, publicPem) {
  try {
    const { sig, ...payload } = receipt;
    if (!sig) return { valid: false, reason: 'missing signature' };
    const { id, ...unsigned } = payload;
    if ('rcpt_' + sha256(canonical(unsigned)).slice(0, 24) !== id) {
      return { valid: false, reason: 'id does not match content' };
    }
    const ok = crypto.verify(
      null,
      Buffer.from(canonical(payload)),
      crypto.createPublicKey(publicPem),
      Buffer.from(sig, 'base64'),
    );
    return ok ? { valid: true } : { valid: false, reason: 'bad signature' };
  } catch (e) {
    return { valid: false, reason: 'malformed: ' + e.message };
  }
}
