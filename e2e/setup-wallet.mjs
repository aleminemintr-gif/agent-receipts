// DEVNET ONLY. Creates a throwaway test wallet (never used for real funds), asks the
// devnet faucet for SOL, and prepares token accounts so x402 can be tested end to end.
// The receiving address is the owner's PUBLIC key; we only create its token account.
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'node:fs';
const RECEIVER = new PublicKey(process.env.PAY_TO);
const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
const file = new URL('./.wallet.json', import.meta.url);
let kp;
if (fs.existsSync(file)) kp = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file))));
else { kp = Keypair.generate(); fs.writeFileSync(file, JSON.stringify([...kp.secretKey]), { mode: 0o600 }); }
console.log('test wallet', kp.publicKey.toBase58());
let bal = await conn.getBalance(kp.publicKey);
if (bal < 0.2 * LAMPORTS_PER_SOL) {
  try { const sig = await conn.requestAirdrop(kp.publicKey, 1 * LAMPORTS_PER_SOL); await conn.confirmTransaction(sig, 'confirmed'); } catch (e) { console.log('airdrop failed:', e.message.slice(0, 120)); }
  bal = await conn.getBalance(kp.publicKey);
}
console.log('sol', bal / LAMPORTS_PER_SOL);
if (bal < 0.05 * LAMPORTS_PER_SOL) process.exit(2);
const mint = await createMint(conn, kp, kp.publicKey, null, 6);
console.log('test mint', mint.toBase58());
const payerAta = await getOrCreateAssociatedTokenAccount(conn, kp, mint, kp.publicKey);
await mintTo(conn, kp, mint, payerAta.address, kp, 1_000_000); // 1.00 test token
const rcvAta = await getOrCreateAssociatedTokenAccount(conn, kp, mint, RECEIVER);
console.log('payer ata', payerAta.address.toBase58(), 'receiver ata', rcvAta.address.toBase58());
fs.writeFileSync(new URL('./.mint', import.meta.url), mint.toBase58());
