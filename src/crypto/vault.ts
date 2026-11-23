import { EncryptedVaultData, AppState } from '../models/schema';

const PBKDF2_ITERATIONS = 310000;
const SALT_BYTE_LENGTH = 16;
const IV_BYTE_LENGTH = 12; // Standard for AES-GCM
const KEY_ALGORITHM = 'AES-GCM';
const HASH_ALGORITHM = 'SHA-256';

// Helper to convert Uint8Array to Hex string
function bufToHex(buf: Uint8Array): string {
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Helper to convert Hex string to Uint8Array
function hexToBuf(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// Helper to convert Uint8Array to Base64 string
function bufToBase64(buf: Uint8Array): string {
  let binary = '';
  const len = buf.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary);
}

// Helper to convert Base64 string to Uint8Array
function base64ToBuf(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Derives an AES-GCM 256-bit CryptoKey from a passphrase and salt using PBKDF2.
 */
export async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: PBKDF2_ITERATIONS,
      hash: HASH_ALGORITHM
    },
    keyMaterial,
    { name: KEY_ALGORITHM, length: 256 },
    true, // extractable for session caching if needed
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts arbitrary plaintext using AES-GCM-256 with a freshly generated random 16-byte salt and 12-byte IV.
 */
export async function encryptVault(plaintext: string, passphrase: string): Promise<EncryptedVaultData> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTE_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTE_LENGTH));
  const key = await deriveKeyFromPassphrase(passphrase, salt);

  const enc = new TextEncoder();
  const plaintextBytes = enc.encode(plaintext);

  const encryptedBuf = await crypto.subtle.encrypt(
    {
      name: KEY_ALGORITHM,
      iv: iv as any
    },
    key,
    plaintextBytes as any
  );

  return {
    version: 1,
    salt: bufToHex(salt),
    iv: bufToHex(iv),
    ciphertext: bufToBase64(new Uint8Array(encryptedBuf))
  };
}

/**
 * Decrypts vault ciphertext using AES-GCM-256. Throws error if passphrase or auth tag is invalid.
 */
export async function decryptVault(vaultData: EncryptedVaultData, passphrase: string): Promise<string> {
  const salt = hexToBuf(vaultData.salt);
  const iv = hexToBuf(vaultData.iv);
  const ciphertextBytes = base64ToBuf(vaultData.ciphertext);

  const key = await deriveKeyFromPassphrase(passphrase, salt);

  try {
    const decryptedBuf = await crypto.subtle.decrypt(
      {
        name: KEY_ALGORITHM,
        iv: iv as any
      },
      key,
      ciphertextBytes as any
    );

    const dec = new TextDecoder();
    return dec.decode(decryptedBuf);
  } catch (err) {
    throw new Error('Failed to decrypt vault: Incorrect passphrase or corrupted data');
  }
}

/**
 * Session Key Manager using chrome.storage.session.
 * Allows unlocking once per browser session without storing plaintext passphrase.
 */
export const SessionVault = {
  async cacheSessionKey(rawHexKey: string): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      try {
        await chrome.storage.session.set({ 'vault_session_key': rawHexKey });
      } catch (e) {
        console.warn('chrome.storage.session set error:', e);
      }
    }
  },

  async getCachedSessionKey(): Promise<string | null> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      try {
        const res = await chrome.storage.session.get('vault_session_key');
        return res['vault_session_key'] || null;
      } catch (e) {
        console.warn('chrome.storage.session get error:', e);
      }
    }
    return null;
  },

  async clearSession(): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.session) {
      try {
        await chrome.storage.session.remove('vault_session_key');
      } catch (e) {
        console.warn('chrome.storage.session clear error:', e);
      }
    }
  }
};
