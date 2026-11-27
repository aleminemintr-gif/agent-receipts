// x402 (V2, HTTP transport) for Solana, scheme "exact". No private keys here:
// we only know the receiving PUBLIC address. Verification and settlement are done by a
// facilitator (default: the public devnet one), which also pays the network fee.
export const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
export const DEVNET_USDC = '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU';
export const PRICES_USD = { verify: '0.02', watch: '0.05', task: '0.01' };

const b64e = (o) => btoa(unescape(encodeURIComponent(JSON.stringify(o))));
const b64d = (s) => JSON.parse(decodeURIComponent(escape(atob(s))));

// Dollar string -> base units for a 6-decimals stablecoin, without floats.
export function toBaseUnits(usd, decimals = 6) {
  const [i, f = ''] = String(usd).split('.');
  return String(BigInt(i || '0') * 10n ** BigInt(decimals) + BigInt((f + '0'.repeat(decimals)).slice(0, decimals)));
}

export function config(env) {
  if (!env.PAY_TO) return null; // payments off
  return {
    payTo: env.PAY_TO,
    network: env.X402_NETWORK || DEVNET,
    asset: env.X402_ASSET || DEVNET_USDC,
    facilitator: (env.FACILITATOR_URL || 'https://x402.org/facilitator').replace(/\/$/, ''),
  };
}

let feePayerCache;
async function feePayer(cfg) {
  if (feePayerCache) return feePayerCache;
  const r = await (await fetch(cfg.facilitator + '/supported', { signal: AbortSignal.timeout(6000) })).json();
  const kind = (r.kinds || []).find((k) => k.x402Version === 2 && k.scheme === 'exact' && k.network === cfg.network);
  if (!kind || !kind.extra || !kind.extra.feePayer) throw new Error('facilitator does not support this network');
  feePayerCache = kind.extra.feePayer;
  return feePayerCache;
}

export async function requirements(cfg, kind, resourceUrl) {
  return {
    scheme: 'exact', network: cfg.network, amount: toBaseUnits(PRICES_USD[kind]), asset: cfg.asset, payTo: cfg.payTo,
    maxTimeoutSeconds: 60, extra: { feePayer: await feePayer(cfg) },
  };
}

// Bazaar discovery declaration (https://github.com/coinbase/x402/blob/main/specs/extensions/bazaar.md).
// Clients echo it to the facilitator, which can then catalog the endpoint. Output example is illustrative.
const obj = { type: 'object' };
export function bazaar(kind) {
  const watch = kind === 'watch';
  const body = watch ? { check: 'http_contains', claim: 'page stays up', params: { url: 'https://example.com', text: 'Example Domain' }, recheck_after_minutes: 60 }
    : { check: 'http_contains', claim: 'I published the page', params: { url: 'https://example.com', text: 'Example Domain' } };
  const example = watch ? { watch: { id: 'watch_...', status: 'pending' } } : { receipt: { id: 'rcpt_...', passed: true, check: 'http_contains', observed: { status: 200 }, sig: '...' } };
  return { bazaar: {
    info: { input: { type: 'http', method: 'POST', bodyType: 'json', body }, output: { type: 'json', example } },
    schema: { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object',
      properties: { input: { type: 'object', properties: { type: { type: 'string', const: 'http' }, method: { type: 'string', enum: ['POST', 'PUT', 'PATCH'] }, bodyType: { type: 'string', enum: ['json', 'form-data', 'text'] }, body: obj }, required: ['type', 'method', 'bodyType', 'body'], additionalProperties: false },
        output: { type: 'object', properties: { type: { type: 'string' }, example: {} }, required: ['type'] } }, required: ['input'] } } };
}

/** Build the 402 response. Body is JSON for humans; the header is canonical x402. */
export async function paymentRequired(cfg, kind, resourceUrl, error) {
  const req = await requirements(cfg, kind, resourceUrl);
  const pr = { x402Version: 2, error, resource: { url: resourceUrl, description: kind === 'watch' ? 'Persistence watch (baseline + recheck receipts)' : kind === 'task' ? 'Micro-task posting fee (flat commission)' : 'One signed verification receipt', mimeType: 'application/json' }, accepts: [req], extensions: bazaar(kind) };
  return new Response(JSON.stringify({ error, price_usd: PRICES_USD[kind], x402: pr }, null, 2), { status: 402, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'PAYMENT-REQUIRED,PAYMENT-RESPONSE', 'PAYMENT-REQUIRED': b64e(pr) } });
}

const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(25000) }).then((r) => r.json());

/** Verify then settle. Returns {ok, payer, transaction, network} or {ok:false, reason}. */
export async function settle(cfg, kind, resourceUrl, header) {
  let payload;
  try { payload = b64d(header); } catch { return { ok: false, reason: 'invalid PAYMENT-SIGNATURE header' }; }
  const want = await requirements(cfg, kind, resourceUrl);
  const got = payload.accepted || {};
  // We never trust the client's idea of the price: compare against OUR requirements.
  for (const f of ['scheme', 'network', 'amount', 'asset', 'payTo']) {
    if (String(got[f]) !== String(want[f])) return { ok: false, reason: `payment does not match requirement (${f})` };
  }
  const body = { x402Version: 2, paymentPayload: payload, paymentRequirements: want };
  const v = await post(cfg.facilitator + '/verify', body);
  if (!v.isValid) return { ok: false, reason: 'verify failed: ' + (v.invalidReason || 'unknown') };
  const s = await post(cfg.facilitator + '/settle', body);
  if (!s.success) return { ok: false, reason: 'settle failed: ' + (s.errorReason || 'unknown') };
  return { ok: true, payer: s.payer || v.payer, transaction: s.transaction, network: s.network || cfg.network, amount: want.amount, asset: want.asset, header: b64e(s) };
}
