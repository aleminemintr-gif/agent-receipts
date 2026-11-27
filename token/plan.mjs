// Pure planning code: no network, no keys. Everything deploy-devnet.mjs does is described here first,
// so it can be read, tested and checked before any transaction exists.
import fs from 'node:fs';

export const config = JSON.parse(fs.readFileSync(new URL('./config.json', import.meta.url), 'utf8'));
export const DEVNET_GENESIS_PREFIX = config.devnetGenesisHash;

/** Whole tokens -> base units, exact integer math. */
export function toBaseUnits(whole, decimals = config.decimals) {
  if (!Number.isInteger(whole) || whole <= 0) throw new Error('supply must be a positive whole number');
  return BigInt(whole) * 10n ** BigInt(decimals);
}

/** The ordered steps. The order is the point: mint everything once, then give up the right to mint more. */
export function buildPlan({ treasury, supplyWhole = config.totalSupplyWholeTokens } = {}) {
  if (!treasury || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(treasury)) throw new Error('treasury must be a public Solana address');
  const supply = toBaseUnits(supplyWhole);
  return {
    cluster: 'devnet',
    supplyBaseUnits: supply.toString(),
    steps: [
      { n: 1, do: 'create_mint', decimals: config.decimals, mintAuthority: 'deployer', freezeAuthority: null },
      { n: 2, do: 'create_treasury_token_account', owner: treasury },
      { n: 3, do: 'mint_to', to: 'treasury_token_account', amount: supply.toString() },
      { n: 4, do: 'set_mint_authority', newAuthority: null, note: 'irreversible: supply is fixed from here on' },
    ],
    afterwards: ['verify-supply.mjs must show: supply == plan, mintAuthority null, freezeAuthority null'],
  };
}

/** What an on-chain mint must look like to count as "fixed supply". */
export function checkMintState(m, plan) {
  const problems = [];
  if (m.mintAuthority !== null) problems.push('mint authority is still set: supply can be increased');
  if (m.freezeAuthority !== null) problems.push('freeze authority is set: accounts can be frozen');
  if (String(m.supply) !== plan.supplyBaseUnits) problems.push(`supply ${m.supply} differs from plan ${plan.supplyBaseUnits}`);
  if (m.decimals !== config.decimals) problems.push('decimals differ from config');
  return { ok: problems.length === 0, problems };
}

/** Refuse anything that is not devnet. Mainnet is a manual step done by the owner, never by these scripts. */
export function assertDevnet(genesisHash) {
  if (!String(genesisHash).startsWith(DEVNET_GENESIS_PREFIX)) throw new Error('refusing: this RPC is not devnet. These scripts never touch mainnet.');
}
