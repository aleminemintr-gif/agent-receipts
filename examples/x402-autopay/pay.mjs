// An agent pays for one receipt on its own with x402 (no account, no human).
//   npm install            (in this folder)
//   SOLANA_KEYPAIR_FILE=wallet.json node pay.mjs https://agent-receipts.amin-experiments.workers.dev https://example.com "Example Domain"
// The wallet needs a little USDC of the network named in GET /v1/info (devnet today: test funds only). The service's fee payer covers gas.
import fs from 'node:fs';
import { x402Client, wrapFetchWithPayment } from '@x402/fetch';
import { ExactSvmScheme } from '@x402/svm/exact/client';
import { createKeyPairSignerFromBytes } from '@solana/kit';
const [base, url, text] = process.argv.slice(2);
const signer = await createKeyPairSignerFromBytes(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.SOLANA_KEYPAIR_FILE))));
const pay = wrapFetchWithPayment(fetch, new x402Client().register('solana:*', new ExactSvmScheme(signer)));
const res = await pay(base + '/v1/verify', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ check: 'http_contains', claim: 'page contains the text', params: { url, text } }) });
const body = await res.json();
console.log(res.status, body.receipt ? (body.receipt.passed ? 'VERIFIED ' : 'NOT VERIFIED ') + body.receipt.id : body.error);
console.log('settlement tx:', body.receipt && body.receipt.payment && body.receipt.payment.transaction);
