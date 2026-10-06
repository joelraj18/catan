// End-to-end encryption for walkie-talkie clips. When two players cannot
// reach each other directly, their clips travel through the host and the
// public relays; each clip is sealed for its one listener with AES-GCM under
// a key the two of them agree with X25519, so neither the host nor a relay
// can hear a private channel. (Direct and TURN audio is already encrypted
// end to end by WebRTC itself.)
import { x25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

export const newVoiceKeys = () => {
  const secret = x25519.utils.randomSecretKey();
  return { secret, publicKey: bytesToHex(x25519.getPublicKey(secret)) };
};

// The AES key two players share: SHA-256 of their X25519 secret.
export const sharedKey = async (secret, theirPublicKey) => {
  const shared = x25519.getSharedSecret(secret, hexToBytes(theirPublicKey));
  const material = sha256(concatBytes(shared, utf8ToBytes('catan voice clip')));
  return crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt']);
};

export const seal = async (key, bytes) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return concatBytes(iv, body);
};

export const unseal = async (key, sealed) =>
  new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.slice(0, 12) }, key, sealed.slice(12)));

export const toBase64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
};

export const fromBase64 = (text) => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
