// The checks. Each one observes the outside world itself; it never trusts
// the agent's claim. Output is plain evidence plus a boolean `passed`.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns/promises';
import { sha256 } from './receipt.mjs';
import { assertPublicHost } from './ssrf.mjs';

const MAX_BODY = 1_000_000;
const TIMEOUT_MS = 8000;

function fetchOnce(urlStr, { allowPrivate }) {
  return new Promise(async (resolve, reject) => {
    let url;
    try { url = new URL(urlStr); } catch { return reject(new Error('invalid url')); }
    if (!['http:', 'https:'].includes(url.protocol)) return reject(new Error('only http(s) allowed'));
    let ip;
    try { ip = await assertPublicHost(url.hostname, { allowPrivate }); } catch (e) { return reject(e); }
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        host: ip, // pinned: closes the DNS-rebinding gap
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        method: 'GET',
        servername: url.hostname,
        headers: { Host: url.host, 'User-Agent': 'agent-receipts/0.1 (+independent verifier)' },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size <= MAX_BODY) chunks.push(c);
          else req.destroy();
        });
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end();
  });
}

async function fetchFollow(url, opts) {
  let cur = url;
  for (let i = 0; i < 4; i++) {
    const r = await fetchOnce(cur, opts);
    if ([301, 302, 303, 307, 308].includes(r.status) && r.headers.location) {
      cur = new URL(r.headers.location, cur).toString();
      continue;
    }
    return { ...r, finalUrl: cur };
  }
  throw new Error('too many redirects');
}

function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export const CHECKS = {
  // "Is the page I deployed actually up?"
  async http_status({ url, expect_status = 200 }, opts) {
    const r = await fetchFollow(url, opts);
    return { passed: r.status === Number(expect_status), observed: { status: r.status, final_url: r.finalUrl } };
  },
  // "Does the published page contain what I wrote?"
  async http_contains({ url, text }, opts) {
    if (!text) throw new Error('text required');
    const r = await fetchFollow(url, opts);
    const body = r.body.toString('utf8');
    return { passed: r.status < 400 && body.includes(text), observed: { status: r.status, body_sha256: sha256(body), found: body.includes(text) } };
  },
  // "Does the API return the value I said I set?"
  async json_field({ url, path, equals }, opts) {
    const r = await fetchFollow(url, opts);
    let value;
    try { value = getPath(JSON.parse(r.body.toString('utf8')), path); } catch { value = undefined; }
    return { passed: value !== undefined && JSON.stringify(value) === JSON.stringify(equals), observed: { status: r.status, value } };
  },
  // "Is the file I uploaded byte-identical?"
  async content_hash({ url, sha256: want }, opts) {
    const r = await fetchFollow(url, opts);
    const got = sha256(r.body);
    return { passed: r.status < 400 && got === String(want).toLowerCase(), observed: { status: r.status, sha256: got } };
  },
  // "Did the DNS change propagate?"
  async dns_record({ name, type = 'A', contains }) {
    const recs = await dns.resolve(name, type);
    const flat = recs.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)));
    return { passed: flat.some((r) => r.includes(contains)), observed: { records: flat } };
  },
};

export async function runCheck(kind, params, opts = {}) {
  const fn = CHECKS[kind];
  if (!fn) throw new Error('unknown check kind: ' + kind);
  const started = Date.now();
  try {
    const out = await fn(params || {}, opts);
    return { ...out, error: null, ms: Date.now() - started };
  } catch (e) {
    // A check that could not run is not a pass.
    return { passed: false, observed: null, error: String(e.message || e), ms: Date.now() - started };
  }
}
