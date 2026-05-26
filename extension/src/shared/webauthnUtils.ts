/**
 * Minimal WebAuthn utility functions for building authenticator responses.
 *
 * Includes:
 * - A tiny CBOR encoder (only the subset needed for WebAuthn attestation/assertion)
 * - Authenticator-data construction helpers
 * - Base64url encode/decode
 */

// ---------------------------------------------------------------------------
// Base64-url helpers
// ---------------------------------------------------------------------------

export function base64urlEncode(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ---------------------------------------------------------------------------
// Minimal CBOR encoder (supports map, byte-string, text-string, uint, neg-int)
// ---------------------------------------------------------------------------

function cborEncodeUint(majorType: number, value: number): Uint8Array {
  const major = majorType << 5;
  if (value < 24) return new Uint8Array([major | value]);
  if (value < 0x100) return new Uint8Array([major | 24, value]);
  if (value < 0x10000) return new Uint8Array([major | 25, value >> 8, value & 0xff]);
  return new Uint8Array([
    major | 26,
    (value >> 24) & 0xff,
    (value >> 16) & 0xff,
    (value >> 8) & 0xff,
    value & 0xff,
  ]);
}

function cborEncodeBytes(data: Uint8Array): Uint8Array {
  const head = cborEncodeUint(2, data.length);
  const out = new Uint8Array(head.length + data.length);
  out.set(head);
  out.set(data, head.length);
  return out;
}

function cborEncodeText(text: string): Uint8Array {
  const encoded = new TextEncoder().encode(text);
  const head = cborEncodeUint(3, encoded.length);
  const out = new Uint8Array(head.length + encoded.length);
  out.set(head);
  out.set(encoded, head.length);
  return out;
}

// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface CborMap { [key: string]: CborValue; }
type CborValue = string | number | Uint8Array | CborMap;

function cborEncodeValue(value: CborValue): Uint8Array {
  if (typeof value === 'string') return cborEncodeText(value);
  if (typeof value === 'number') {
    if (value >= 0) return cborEncodeUint(0, value);
    // Negative integer: CBOR major type 1, encoded as -1 - value
    return cborEncodeUint(1, -1 - value);
  }
  if (value instanceof Uint8Array) return cborEncodeBytes(value);
  // Map
  return cborEncodeMap(value);
}

function cborEncodeMap(map: Record<string | number, CborValue>): Uint8Array {
  const keys = Object.keys(map);
  const head = cborEncodeUint(5, keys.length);
  const parts: Uint8Array[] = [head];
  for (const k of keys) {
    const numKey = Number(k);
    if (!isNaN(numKey) && String(numKey) === k) {
      parts.push(cborEncodeValue(numKey));
    } else {
      parts.push(cborEncodeText(k));
    }
    parts.push(cborEncodeValue(map[k]));
  }
  const totalLen = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function cborEncode(value: CborValue): Uint8Array {
  return cborEncodeValue(value);
}

// ---------------------------------------------------------------------------
// WebAuthn data construction
// ---------------------------------------------------------------------------

/** SHA-256 hash using Web Crypto API. */
export async function sha256(data: Uint8Array | ArrayBuffer): Promise<ArrayBuffer> {
  const buf: ArrayBuffer = data instanceof Uint8Array
    ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    : data;
  return crypto.subtle.digest('SHA-256', buf);
}

/** Write a 32-bit big-endian unsigned integer into the array at offset. */
function writeUint32BE(arr: Uint8Array, value: number, offset: number): void {
  arr[offset] = (value >> 24) & 0xff;
  arr[offset + 1] = (value >> 16) & 0xff;
  arr[offset + 2] = (value >> 8) & 0xff;
  arr[offset + 3] = value & 0xff;
}

/** Write a 16-bit big-endian unsigned integer into the array at offset. */
function writeUint16BE(arr: Uint8Array, value: number, offset: number): void {
  arr[offset] = (value >> 8) & 0xff;
  arr[offset + 1] = value & 0xff;
}

/**
 * Build authenticator data for an attestation (registration) response.
 *
 * Flags: UP (0x01) | UV (0x04) | AT (0x40) = 0x45
 */
export async function buildAttestationAuthData(
  rpId: string,
  signCount: number,
  aaguid: Uint8Array, // 16 bytes
  credentialId: Uint8Array,
  cosePublicKey: Uint8Array,
): Promise<Uint8Array> {
  const rpIdHash = new Uint8Array(await sha256(new TextEncoder().encode(rpId)));
  const flags = 0x45; // UP | UV | AT
  const credIdLen = credentialId.length;

  const authDataLen = 32 + 1 + 4 + 16 + 2 + credIdLen + cosePublicKey.length;
  const authData = new Uint8Array(authDataLen);

  let offset = 0;
  authData.set(rpIdHash, offset);
  offset += 32;
  authData[offset++] = flags;
  writeUint32BE(authData, signCount, offset);
  offset += 4;
  authData.set(aaguid, offset);
  offset += 16;
  writeUint16BE(authData, credIdLen, offset);
  offset += 2;
  authData.set(credentialId, offset);
  offset += credIdLen;
  authData.set(cosePublicKey, offset);

  return authData;
}

/**
 * Build authenticator data for an assertion (authentication) response.
 *
 * Flags: UP (0x01) | UV (0x04) = 0x05
 */
export async function buildAssertionAuthData(
  rpId: string,
  signCount: number,
): Promise<Uint8Array> {
  const rpIdHash = new Uint8Array(await sha256(new TextEncoder().encode(rpId)));
  const flags = 0x05; // UP | UV
  const authData = new Uint8Array(32 + 1 + 4);
  authData.set(rpIdHash, 0);
  authData[32] = flags;
  writeUint32BE(authData, signCount, 33);
  return authData;
}

/**
 * Encode an EC P-256 public key (raw x, y coordinates) as a COSE key (CBOR).
 *
 * COSE key map:
 *   1 (kty) → 2 (EC2)
 *   3 (alg) → -7 (ES256)
 *  -1 (crv) → 1 (P-256)
 *  -2 (x)   → <32 bytes>
 *  -3 (y)   → <32 bytes>
 */
export function encodeCosePublicKey(x: Uint8Array, y: Uint8Array): Uint8Array {
  return cborEncode({
    '1': 2,
    '3': -7,
    '-1': 1,
    '-2': x,
    '-3': y,
  });
}

/**
 * Build a "none" attestation object (CBOR).
 *
 * {fmt: "none", attStmt: {}, authData: <bytes>}
 */
export function buildAttestationObject(authData: Uint8Array): Uint8Array {
  return cborEncode({
    fmt: 'none',
    attStmt: {} as Record<string, CborValue>,
    authData,
  });
}

/**
 * Concatenate two Uint8Arrays.
 */
export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const result = new Uint8Array(a.length + b.length);
  result.set(a);
  result.set(b, a.length);
  return result;
}

/**
 * Generate a random credential ID (32 bytes).
 */
export function generateCredentialId(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Generate a zero AAGUID (for software authenticators).
 */
export function zeroAaguid(): Uint8Array {
  return new Uint8Array(16);
}
