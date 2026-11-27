import test from 'node:test';
import assert from 'node:assert/strict';
import { toBaseUnits, buildPlan, checkMintState, assertDevnet } from '../plan.mjs';
const T = 'ARcYk3J3iBnJZMduVevMS7jsYh7puQtXH9WN8FtAjAbJ';
test('base units exact', () => assert.equal(toBaseUnits(100000000), 100000000000000n));
test('rejects bad supply', () => { assert.throws(() => toBaseUnits(0)); assert.throws(() => toBaseUnits(1.5)); });
test('plan ends by removing mint authority', () => {
  const p = buildPlan({ treasury: T }); const last = p.steps.at(-1);
  assert.equal(last.do, 'set_mint_authority'); assert.equal(last.newAuthority, null);
  assert.equal(p.steps.find(s => s.do === 'create_mint').freezeAuthority, null);
});
test('plan rejects non-address treasury', () => assert.throws(() => buildPlan({ treasury: 'nope' })));
test('mint check flags live authorities and wrong supply', () => {
  const p = buildPlan({ treasury: T });
  assert.equal(checkMintState({ supply: p.supplyBaseUnits, decimals: 6, mintAuthority: null, freezeAuthority: null }, p).ok, true);
  assert.equal(checkMintState({ supply: p.supplyBaseUnits, decimals: 6, mintAuthority: 'x', freezeAuthority: null }, p).ok, false);
  assert.equal(checkMintState({ supply: '1', decimals: 6, mintAuthority: null, freezeAuthority: 'y' }, p).problems.length, 2);
});
test('refuses non-devnet', () => { assert.throws(() => assertDevnet('5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d')); assertDevnet('EtWTRABZaYq6iMfeYKouRu166VU2xqa1xxxx'); });
