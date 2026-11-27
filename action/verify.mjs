// Used by the GitHub Action (and runnable by hand): verify one public claim, print the receipt, exit 1 if it fails.
// Env: AR_URL, AR_CONTAINS (optional), AR_CLAIM, AR_API_URL, AR_API_KEY (optional), AR_OUT (file to write the receipt JSON, optional)
import fs from 'node:fs';
const base = (process.env.AR_API_URL || 'https://agent-receipts.amin-experiments.workers.dev').replace(/\/$/, '');
const url = process.env.AR_URL, contains = process.env.AR_CONTAINS || '';
if (!url) { console.error('AR_URL is required'); process.exit(2); }
const key = process.env.AR_API_KEY || '';
const check = contains ? 'http_contains' : 'http_status';
const res = await fetch(base + (key ? '/v1/verify' : '/v1/try'), { method: 'POST',
  headers: { 'content-type': 'application/json', ...(key ? { authorization: 'Bearer ' + key } : {}) },
  body: JSON.stringify({ check, claim: (process.env.AR_CLAIM || '').slice(0, 300), params: contains ? { url, text: contains } : { url } }) });
const body = await res.json().catch(() => ({}));
if (!body.receipt) { console.error(`no receipt (HTTP ${res.status}): ${body.error || 'unknown'}`); process.exit(2); }
const r = body.receipt;
if (process.env.AR_OUT) fs.writeFileSync(process.env.AR_OUT, JSON.stringify(r, null, 2));
console.log(`${r.passed ? 'VERIFIED' : 'NOT VERIFIED'} ${r.id} at ${r.at}`);
console.log(`check it: ${base}${body.verify_url}`);
if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `receipt_id=${r.id}\npassed=${r.passed}\n`);
process.exit(r.passed ? 0 : 1);
