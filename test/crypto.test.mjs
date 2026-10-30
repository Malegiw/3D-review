import test from 'node:test';
import assert from 'node:assert/strict';
import sodium from 'libsodium-wrappers';
import { newKey, encryptBytes, decryptBytes, sealedBox, toB64, fromB64 } from '../src/core/crypto.js';
import { encrypt as nodeEncrypt, decrypt as nodeDecrypt } from '../tools/nxe.mjs';

test('NXE1: browser (WebCrypto) ⇄ runner (node:crypto) round trips', async () => {
  const key = newKey();
  const k = Buffer.from(key, 'base64');
  const data = new Uint8Array(200000).map((_, i) => (i * 31) & 255);
  const enc = await encryptBytes(data, key);
  assert.deepEqual(new Uint8Array(nodeDecrypt(Buffer.from(enc), k)), data);
  const enc2 = nodeEncrypt(Buffer.from(data), k);
  assert.deepEqual(await decryptBytes(new Uint8Array(enc2), key), data);
  await assert.rejects(() => decryptBytes(enc, newKey()), /does not match/);
});

test('sealedBox matches libsodium crypto_box_seal (GitHub secrets)', async () => {
  await sodium.ready;
  const kp = sodium.crypto_box_keypair();
  const msg = new TextEncoder().encode(newKey());
  const sealed = sealedBox(msg, kp.publicKey);
  const opened = sodium.crypto_box_seal_open(sealed, kp.publicKey, kp.privateKey);
  assert.deepEqual(opened, msg);
  assert.equal(fromB64(toB64(sealed)).length, sealed.length);
});
