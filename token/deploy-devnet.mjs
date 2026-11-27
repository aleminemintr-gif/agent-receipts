// DEVNET ONLY. Creates the fixed-supply token on devnet, mints the whole supply to the treasury
// token account, then removes the mint authority. Devnet tokens have no value.
//
//   node deploy-devnet.mjs --plan  --treasury <PUBLIC_ADDRESS>                        (no network, prints the plan)
//   DEPLOYER_KEY_FILE=deployer.json node deploy-devnet.mjs --treasury <PUBLIC_ADDRESS>   (needs devnet SOL, about 0.01)
//
// The deployer key is a throwaway devnet keypair. The treasury is a PUBLIC address; no treasury key is needed.
import fs from 'node:fs';
import { buildPlan, assertDevnet, config } from './plan.mjs';

const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const plan = buildPlan({ treasury: arg('treasury') });
console.log(JSON.stringify(plan, null, 2));
if (process.argv.includes('--plan')) process.exit(0);

const { Connection, Keypair, PublicKey, clusterApiUrl } = await import('@solana/web3.js');
const { createMint, getOrCreateAssociatedTokenAccount, mintTo, setAuthority, AuthorityType } = await import('@solana/spl-token');
const conn = new Connection(process.env.RPC || clusterApiUrl('devnet'), 'confirmed');
assertDevnet(await conn.getGenesisHash());
const deployer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.DEPLOYER_KEY_FILE))));
if ((await conn.getBalance(deployer.publicKey)) < 10_000_000) { console.error('deployer needs about 0.01 devnet SOL'); process.exit(2); }

const mint = await createMint(conn, deployer, deployer.publicKey, null, config.decimals); // freeze authority: none
console.log('mint', mint.toBase58());
const ata = await getOrCreateAssociatedTokenAccount(conn, deployer, mint, new PublicKey(arg('treasury')));
await mintTo(conn, deployer, mint, ata.address, deployer, BigInt(plan.supplyBaseUnits));
await setAuthority(conn, deployer, mint, deployer, AuthorityType.MintTokens, null);
console.log('treasury token account', ata.address.toBase58());
console.log('now run: node verify-supply.mjs', mint.toBase58());
