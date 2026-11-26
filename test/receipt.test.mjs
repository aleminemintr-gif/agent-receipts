import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, signReceipt, verifyReceipt } from '../src/receipt.mjs';
import { isPrivateIp } from '../src/ssrf.mjs';

test('receipt verifies and tampering is detected', () => {
  const k = generateKeyPair();
  const r = signReceipt(k, { check: 'http_status', passed: true, at: 'x' }, null);
  assert.equal(verifyReceipt(r, k.publicPem).valid, true);
  assert.equal(verifyReceipt({ ...r, passed: false }, k.publicPem).valid, false);
  const other = generateKeyPair();
  assert.equal(verifyReceipt(r, other.publicPem).valid, false);
});

test('chain links previous id', () => {
  const k = generateKeyPair();
  const a = signReceipt(k, { n: 1 }, null);
  const b = signReceipt(k, { n: 2 }, a.id);
  assert.equal(b.prev, a.id);
});

test('private ranges are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.9', '169.254.169.254', '172.20.0.1', '::1', '::ffff:10.0.0.1']) assert.equal(isPrivateIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1']) assert.equal(isPrivateIp(ip), false, ip);
});
