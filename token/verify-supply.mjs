// Reads a mint from chain and checks it is a fixed-supply mint. Read-only, no key needed.
//   node verify-supply.mjs <MINT> [--cluster devnet|mainnet-beta] [--expected-whole 100000000]
// Works for any mint, so anyone can run it on ours (or on someone else's) before trusting it.
import { buildPlan, checkMintState, config } from './plan.mjs';
const mintAddr = process.argv[2];
const arg = (n) => { const i = process.argv.indexOf('--' + n); return i > 0 ? process.argv[i + 1] : null; };
const cluster = arg('cluster') || 'devnet';
const { Connection, PublicKey, clusterApiUrl } = await import('@solana/web3.js');
const { getMint } = await import('@solana/spl-token');
const m = await getMint(new Connection(clusterApiUrl(cluster), 'confirmed'), new PublicKey(mintAddr));
const state = { supply: m.supply.toString(), decimals: m.decimals, mintAuthority: m.mintAuthority && m.mintAuthority.toBase58(), freezeAuthority: m.freezeAuthority && m.freezeAuthority.toBase58() };
console.log(state);
const plan = buildPlan({ treasury: 'ARcYk3J3iBnJZMduVevMS7jsYh7puQtXH9WN8FtAjAbJ', supplyWhole: Number(arg('expected-whole') || config.totalSupplyWholeTokens) });
const res = checkMintState(state, plan);
console.log(res.ok ? 'FIXED SUPPLY CONFIRMED' : 'NOT a fixed-supply mint as planned:\n - ' + res.problems.join('\n - '));
process.exit(res.ok ? 0 : 1);
