import test from 'node:test';
import assert from 'node:assert/strict';
import { leafHash, merkleRoot, merkleProof, foldProof } from '../src/merkle.mjs';
import { leafHash as vLeaf, foldProof as vFold } from '../verifier/verify.mjs';

test('every leaf proves for tree sizes 1..17, and a wrong leaf does not', async () => {
  for (let n = 1; n <= 17; n++) {
    const leaves = await Promise.all(Array.from({ length: n }, (_, i) => leafHash('r' + i)));
    const root = await merkleRoot(leaves);
    for (let i = 0; i < n; i++) {
      const path = await merkleProof(leaves, i);
      assert.equal(await foldProof(leaves[i], path), root, `n=${n} i=${i}`);
      assert.equal(vFold(leaves[i], path), root, 'standalone verifier agrees');
      assert.notEqual(await foldProof(await leafHash('forged'), path), root);
    }
  }
});

test('leaf/node domain separation and verifier parity', async () => {
  assert.equal(await leafHash('x'), vLeaf('x'));
  const a = await leafHash('a'), b = await leafHash('b');
  assert.notEqual(await merkleRoot([a, b]), await leafHash(a + b));
});
