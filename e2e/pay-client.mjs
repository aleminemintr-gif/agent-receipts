// Pays for one receipt with x402 on Solana devnet using the test wallet in .wallet.json.
// Usage: node pay-client.mjs https://agent-receipts.amin-experiments.workers.dev
import fs from 'node:fs';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { createKeyPairSignerFromBytes } from '@solana/kit';
const base = process.argv[2];
const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(new URL('./.wallet.json', import.meta.url)))));
const client = new x402Client().register('solana:*', new ExactSvmScheme(signer));
const pay = wrapFetchWithPayment(fetch, client);
const res = await pay(base + '/v1/verify', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ check: 'http_contains', claim: 'example.com is published', params: { url: 'https://example.com/', text: 'Example Domain' } }) });
console.log(res.status, res.headers.get('payment-response') ? 'settled' : 'no settlement header');
console.log(JSON.stringify(await res.json(), null, 2));
