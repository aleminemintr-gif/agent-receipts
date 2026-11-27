// Worker checks. Workers cannot reach private networks anyway, but we also
// refuse IP literals in private ranges and obvious internal names.
import { sha256 } from './receipt-web.mjs';

const MAX_BODY = 1_000_000;
const TIMEOUT_MS = 8000;

export function hostAllowed(hostname, allowPrivate = false) {
  if (allowPrivate) return true;
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false;
  if (h.startsWith('[') || h.includes(':')) return false; // no IPv6 literals
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224) return false;
  }
  if (/^\d+$/.test(h) || /^0x/i.test(h)) return false; // decimal/hex IP tricks
  return true;
}

async function readCapped(res) {
  const reader = res.body ? res.body.getReader() : null;
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY) { await reader.cancel(); break; }
    chunks.push(value);
  }
  const out = new Uint8Array(Math.min(size, MAX_BODY)); let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

async function fetchFollow(urlStr, allowPrivate) {
  let cur = urlStr;
  for (let i = 0; i < 4; i++) {
    let url;
    try { url = new URL(cur); } catch { throw new Error('invalid url'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('only http(s) allowed');
    if (!hostAllowed(url.hostname, allowPrivate)) throw new Error('target address is not public');
    const res = await fetch(cur, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'user-agent': 'agent-receipts/0.1 (+independent verifier)' } });
    if ([301, 302, 303, 307, 308].includes(res.status) && res.headers.get('location')) {
      cur = new URL(res.headers.get('location'), cur).toString();
      continue;
    }
    const hdr = {};
    for (const h of ['content-type', 'content-length', 'etag', 'last-modified', 'cache-control', 'server']) if (res.headers.get(h)) hdr[h] = res.headers.get(h);
    return { status: res.status, body: await readCapped(res), finalUrl: cur, headers: hdr, hops: i };
  }
  throw new Error('too many redirects');
}
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const text = (b) => new TextDecoder().decode(b);
// Raw evidence block shared by every HTTP check: enough to reproduce and audit.
const raw = (r) => ({ status: r.status, final_url: r.finalUrl, redirects: r.hops, headers: r.headers, body_bytes: r.body.length, body_excerpt: text(r.body.slice(0, 300)) });

export const METHODS = {
  http_status: { version: 1, summary: 'One GET from a Cloudflare Worker (public internet, no cookies). Redirects followed manually, max 4, each hop re-checked against the private-address guard. Passes when the final status equals expect_status (default 200).', reproduce: 'curl -sL -o /dev/null -w "%{http_code}" URL' },
  http_contains: { version: 1, summary: 'Same GET. Body read up to 1,000,000 bytes, decoded as UTF-8. Passes when status < 400 and the body contains the exact, case-sensitive text. body_sha256 is over the decoded string.', reproduce: 'curl -sL URL | grep -F "TEXT"' },
  json_field: { version: 1, summary: 'Same GET. Body parsed as JSON, value read by dot path (a.b.c), compared with equals by JSON equality. A missing path or invalid JSON fails.', reproduce: 'curl -sL URL | jq .a.b.c' },
  content_hash: { version: 1, summary: 'Same GET. SHA-256 over the raw bytes (capped at 1,000,000). Passes when it equals the given sha256 and status < 400.', reproduce: 'curl -sL URL | sha256sum' },
  dns_record: { version: 1, summary: 'DNS-over-HTTPS query to cloudflare-dns.com for name and type. Passes when any returned record contains the given string. Resolver caches can lag the authoritative server.', reproduce: 'dig +short TYPE NAME @1.1.1.1' },
};

export const CHECKS = {
  async http_status({ url, expect_status = 200 }, ap) {
    const r = await fetchFollow(url, ap);
    return { passed: r.status === Number(expect_status), observed: raw(r) };
  },
  async http_contains({ url, text: needle }, ap) {
    if (!needle) throw new Error('text required');
    const r = await fetchFollow(url, ap); const body = text(r.body);
    return { passed: r.status < 400 && body.includes(needle), observed: { ...raw(r), body_sha256: await sha256(body), found: body.includes(needle) } };
  },
  async json_field({ url, path, equals }, ap) {
    const r = await fetchFollow(url, ap); let value;
    try { value = getPath(JSON.parse(text(r.body)), path); } catch { value = undefined; }
    return { passed: value !== undefined && JSON.stringify(value) === JSON.stringify(equals), observed: { ...raw(r), value } };
  },
  async content_hash({ url, sha256: want }, ap) {
    const r = await fetchFollow(url, ap); const got = await sha256(r.body);
    return { passed: r.status < 400 && got === String(want).toLowerCase(), observed: { ...raw(r), sha256: got } };
  },
  // DNS over HTTPS (Workers have no resolver API).
  async dns_record({ name, type = 'A', contains }) {
    if (!/^[a-zA-Z0-9.-]{1,253}$/.test(name) || !/^[A-Z]{1,10}$/.test(type)) throw new Error('bad name or type');
    const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    const j = await res.json();
    const records = (j.Answer || []).map((a) => String(a.data));
    return { passed: records.some((r) => r.includes(contains)), observed: { query: { name, type }, resolver: 'cloudflare-dns.com', records: records.sort() } };
  },
};

export async function runCheck(kind, params, allowPrivate = false) {
  const started = Date.now();
  try {
    const out = await CHECKS[kind](params || {}, allowPrivate);
    return { ...out, error: null, ms: Date.now() - started };
  } catch (e) {
    return { passed: false, observed: null, error: String(e.message || e), ms: Date.now() - started };
  }
}
