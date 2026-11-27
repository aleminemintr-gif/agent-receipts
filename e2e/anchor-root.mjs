// Writes a day's Merkle root to Solana as an SPL Memo, then tells the service the tx signature.
// The service accepts it only if the chain shows the exact memo, so this script is not trusted.
//
//   ANCHOR_KEY_FILE=/path/to/keypair.json node anchor-root.mjs <service-url> <YYYY-MM-DD> [--dry-run]
//
// Cluster: devnet by default (ANCHOR_CLUSTER=mainnet-beta to change). The key only needs a few cents of SOL:
// one memo costs about 5000 lamports. Use a dedicated low-balance wallet, never the owner's main wallet.
import fs from 'node:fs';
import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction, sendAndConfirmTransaction, clusterApiUrl } from '@solana/web3.js';
const [base, day] = process.argv.slice(2);
const dry = process.argv.includes('--dry-run');
const root = await fetch(`${base}/v1/roots/${day}`).then((r) => r.json());
if (!root.root) { console.error('no sealed root for', day, root); process.exit(1); }
const memo = `agent-receipts:v1:${day}:${root.root}`;
console.log('memo:', memo, `(${Buffer.byteLength(memo)} bytes)`);
const conn = new Connection(clusterApiUrl(process.env.ANCHOR_CLUSTER || 'devnet'), 'confirmed');
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.ANCHOR_KEY_FILE))));
const ix = new TransactionInstruction({ keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: false }], programId: new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'), data: Buffer.from(memo) });
const tx = new Transaction().add(ix);
if (dry) { tx.feePayer = payer.publicKey; tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash; tx.sign(payer); console.log('dry run ok, signed tx bytes:', tx.serialize().length); process.exit(0); }
const sig = await sendAndConfirmTransaction(conn, tx, [payer]);
console.log('anchored:', sig);
console.log(await fetch(`${base}/v1/roots/${day}/anchor`, { method: 'POST', body: JSON.stringify({ signature: sig }) }).then((r) => r.json()));
