// Client-side encryption for models stored in a PUBLIC converter repository.
// File format "NXE1": 4-byte magic | 12-byte IV | AES-256-GCM ciphertext with 16-byte tag (WebCrypto layout).
// The 32-byte key lives on this device and as the repository secret NEXUS_KEY (for the GitHub runner).
import nacl from 'tweetnacl';
import { blake2b } from 'blakejs';

const MAGIC = [0x4e, 0x58, 0x45, 0x31]; // "NXE1"

export const toB64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
export const fromB64 = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

export function newKey() { return toB64(crypto.getRandomValues(new Uint8Array(32))); }
export function validKey(b64) { try { return fromB64(String(b64).trim()).length === 32; } catch { return false; } }

const aesKey = (b64, usage) => crypto.subtle.importKey('raw', fromB64(b64), { name: 'AES-GCM' }, false, [usage]);

export async function encryptBytes(bytes, keyB64) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64, 'encrypt'), bytes));
  const out = new Uint8Array(4 + 12 + ct.length);
  out.set(MAGIC, 0); out.set(iv, 4); out.set(ct, 16);
  return out;
}
export async function decryptBytes(bytes, keyB64) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 32 || MAGIC.some((m, i) => u8[i] !== m)) throw new Error('Not an encrypted NEXUS file.');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.subarray(4, 16) }, await aesKey(keyB64, 'decrypt'), u8.subarray(16)));
  } catch {
    throw new Error('Decryption failed — the encryption key on this device does not match the repository key (NEXUS_KEY).');
  }
}
export async function encryptBlob(blob, keyB64) { return new Blob([await encryptBytes(new Uint8Array(await blob.arrayBuffer()), keyB64)]); }
export async function decryptBlob(blob, keyB64, type = 'model/gltf-binary') { return new Blob([await decryptBytes(new Uint8Array(await blob.arrayBuffer()), keyB64)], { type }); }

/** libsodium crypto_box_seal (what GitHub requires for Actions secrets): epk || box(msg, blake2b(epk||pk), pk, esk). */
export function sealedBox(message, publicKey) {
  const eph = nacl.box.keyPair();
  const nonceIn = new Uint8Array(64);
  nonceIn.set(eph.publicKey, 0); nonceIn.set(publicKey, 32);
  const nonce = blake2b(nonceIn, undefined, 24);
  const boxed = nacl.box(message, nonce, publicKey, eph.secretKey);
  const out = new Uint8Array(32 + boxed.length);
  out.set(eph.publicKey, 0); out.set(boxed, 32);
  return out;
}
