// WebCrypto version of src/receipt.mjs for Cloudflare Workers.
// Produces byte-identical receipts: same canonical JSON, same id rule, same Ed25519 signature.
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
export const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', typeof s === 'string' ? enc.encode(s) : s));
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export async function importPrivate(pkcs8B64) {
  return crypto.subtle.importKey('pkcs8', unb64(pkcs8B64), { name: 'Ed25519' }, true, ['sign']);
}
export async function publicFromPrivate(privateKey) {
  const jwk = await crypto.subtle.exportKey('jwk', privateKey);
  const pub = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x }, { name: 'Ed25519' }, true, ['verify']);
  return pub;
}
export async function publicPem(pub) {
  const spki = await crypto.subtle.exportKey('spki', pub);
  const lines = b64(spki).match(/.{1,64}/g).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----\n`;
}
export async function keyId(pub) { return (await sha256(await publicPem(pub))).slice(0, 16); }

export async function signReceipt({ privateKey, publicKey }, body, prev) {
  const unsigned = { v: 1, ...body, prev: prev || null, kid: await keyId(publicKey) };
  const id = 'rcpt_' + (await sha256(canonical(unsigned))).slice(0, 24);
  const payload = { ...unsigned, id };
  const sig = b64(await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, enc.encode(canonical(payload))));
  return { ...payload, sig };
}

export async function verifyReceipt(receipt, publicKey) {
  try {
    const { sig, ...payload } = receipt;
    if (!sig) return { valid: false, reason: 'missing signature' };
    const { id, ...unsigned } = payload;
    if ('rcpt_' + (await sha256(canonical(unsigned))).slice(0, 24) !== id) return { valid: false, reason: 'id does not match content' };
    const ok = await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, unb64(sig), enc.encode(canonical(payload)));
    return ok ? { valid: true } : { valid: false, reason: 'bad signature' };
  } catch (e) {
    return { valid: false, reason: 'malformed: ' + e.message };
  }
}
