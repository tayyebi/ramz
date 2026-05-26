// Service worker for Ramz extension
import { storage } from '../shared/storage';
import { getPendingChanges, removePendingChange, cacheEntries } from '../shared/offlineCache';
import type { PasswordEntry, AuthTokens, PasskeyEntry } from '../shared/types';
import {
  base64urlEncode,
  base64urlDecode,
  sha256,
  buildAttestationAuthData,
  buildAssertionAuthData,
  encodeCosePublicKey,
  buildAttestationObject,
  concat,
  generateCredentialId,
  zeroAaguid,
} from '../shared/webauthnUtils';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'ramz-fill',
    title: 'Fill with Ramz',
    contexts: ['editable'],
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'ramz-fill' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'SHOW_PICKER' });
  }
});

// Handle messages from popup/content scripts
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_STATUS') {
    storage.get(['access_token', 'token_expires_at']).then((data) => {
      sendResponse({
        hasToken: !!data.access_token,
        tokenValid: data.token_expires_at ? Date.now() < data.token_expires_at : false,
      });
    });
    return true;
  }
  if (message.type === 'LOGOUT') {
    storage.clear().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message.type === 'FILL_CREDENTIALS') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'FILL_FORM', data: message.data });
      }
    });
    sendResponse({ ok: true });
  }
  // -- Passkey: registration (navigator.credentials.create) -----------------
  if (message.type === 'RAMZ_PASSKEY_CREATE') {
    void handlePasskeyCreate(message.payload as PasskeyCreatePayload).then(
      (result) => sendResponse({ result }),
      (err) => sendResponse({ error: (err as Error).message }),
    );
    return true; // async
  }
  // -- Passkey: authentication (navigator.credentials.get) ------------------
  if (message.type === 'RAMZ_PASSKEY_GET') {
    void handlePasskeyGet(message.payload as PasskeyGetPayload).then(
      (result) => sendResponse({ result }),
      (err) => sendResponse({ error: (err as Error).message }),
    );
    return true; // async
  }
});

// ---------------------------------------------------------------------------
// Helpers for background sync
// ---------------------------------------------------------------------------

async function getBaseUrl(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['server_url'], (result) => {
      const raw = (result['server_url'] as string) || 'http://localhost:8080';
      const base = raw.replace(/\/$/, '');
      resolve(`${base}/api`);
    });
  });
}

async function getToken(): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['access_token'], (result) => {
      resolve((result['access_token'] as string) || null);
    });
  });
}

async function bgRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const [baseUrl, token] = await Promise.all([getBaseUrl(), getToken()]);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const resp = await fetch(`${baseUrl}${path}`, { ...options, headers });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: { code: 'UNKNOWN', message: resp.statusText } }));
    throw new Error((err as { error?: { message?: string } })?.error?.message || resp.statusText);
  }
  const text = await resp.text();
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ---------------------------------------------------------------------------
// Sync: push pending offline changes and refresh cache
// ---------------------------------------------------------------------------

async function syncPendingChanges(): Promise<void> {
  const queue = await getPendingChanges();
  if (queue.length === 0) return;

  // Check if server is reachable
  try {
    await bgRequest<unknown>('/health');
  } catch {
    return; // Still offline
  }

  // Process each pending change in order
  for (let i = 0; i < queue.length; /* no increment */) {
    const action = queue[i];
    try {
      if (action.type === 'create') {
        await bgRequest<{ entry: PasswordEntry }>('/vault/entries', {
          method: 'POST',
          body: JSON.stringify(action.payload),
        });
      } else if (action.type === 'update') {
        await bgRequest<{ entry: PasswordEntry }>(`/vault/entries/${action.id}`, {
          method: 'PUT',
          body: JSON.stringify(action.payload),
        });
      } else if (action.type === 'delete') {
        await bgRequest<{ message: string }>(`/vault/entries/${action.id}`, {
          method: 'DELETE',
        });
      }
      await removePendingChange(i);
      // Don't increment — the array shifted
    } catch {
      // If this one fails, skip it and try the next
      i++;
    }
  }

  // Refresh the cache with latest server state
  try {
    const data = await bgRequest<{ entries: PasswordEntry[]; total: number }>('/vault/entries');
    await cacheEntries(data.entries);
  } catch {
    // non-critical
  }
}

// ---------------------------------------------------------------------------
// Alarms
// ---------------------------------------------------------------------------

chrome.alarms.create('token-refresh', { periodInMinutes: 1 });
chrome.alarms.create('offline-sync', { periodInMinutes: 2 });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'token-refresh') {
    const data = await storage.get(['refresh_token', 'token_expires_at']);
    if (data.refresh_token && data.token_expires_at) {
      const minutesLeft = (data.token_expires_at - Date.now()) / 60000;
      if (minutesLeft < 5 && minutesLeft > 0) {
        try {
          const baseUrl = await getBaseUrl();
          const resp = await fetch(`${baseUrl}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: data.refresh_token }),
          });
          if (resp.ok) {
            const tokens = (await resp.json()) as AuthTokens;
            await storage.saveTokens(tokens);
          }
        } catch {
          // Backend might be unavailable
        }
      }
    }
  }

  if (alarm.name === 'offline-sync') {
    await syncPendingChanges();
  }
});

// ---------------------------------------------------------------------------
// Passkey (WebAuthn) handlers
// ---------------------------------------------------------------------------

interface PasskeyCreatePayload {
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  challenge: string; // base64url
  pubKeyCredParams: Array<{ type: string; alg: number }>;
  excludeCredentials: Array<{ id: string; type: string }>;
  authenticatorSelection?: AuthenticatorSelectionCriteria;
  attestation?: string;
}

interface PasskeyGetPayload {
  rpId: string;
  challenge: string; // base64url
  allowCredentials: Array<{ id: string; type: string }>;
  userVerification?: string;
}

/**
 * Handle navigator.credentials.create() — generate a new passkey and store it.
 */
async function handlePasskeyCreate(payload: PasskeyCreatePayload) {
  // Only support ES256 (alg: -7)
  const supported = payload.pubKeyCredParams.some((p) => p.alg === -7);
  if (!supported) throw new Error('Only ES256 (alg -7) is supported');

  // Generate ECDSA P-256 key pair
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true, // extractable
    ['sign', 'verify'],
  );

  // Export private key as PKCS8 (base64 for storage)
  const privateKeyPkcs8 = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const privateKeyB64 = base64urlEncode(privateKeyPkcs8);

  // Export public key as raw (65 bytes: 0x04 || x || y)
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));
  const x = publicKeyRaw.slice(1, 33);
  const y = publicKeyRaw.slice(33, 65);

  // Generate credential ID
  const credentialId = generateCredentialId();
  const credentialIdB64 = base64urlEncode(credentialId);

  // Build COSE public key
  const cosePublicKey = encodeCosePublicKey(x, y);

  // Build authenticator data
  const aaguid = zeroAaguid();
  const authData = await buildAttestationAuthData(
    payload.rp.id,
    0, // initial sign count
    aaguid,
    credentialId,
    cosePublicKey,
  );

  // Build attestation object
  const attestationObject = buildAttestationObject(authData);

  // Build clientDataJSON
  const clientData = {
    type: 'webauthn.create',
    challenge: payload.challenge,
    origin: payload.rp.id.startsWith('localhost')
      ? `http://${payload.rp.id}`
      : `https://${payload.rp.id}`,
    crossOrigin: false,
  };
  const clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData));

  // Store the credential in the vault via API
  try {
    await bgRequest<{ entry: PasskeyEntry }>('/vault/passkeys', {
      method: 'POST',
      body: JSON.stringify({
        rp_id: payload.rp.id,
        rp_name: payload.rp.name,
        user_id: payload.user.id,
        user_name: payload.user.name,
        user_display_name: payload.user.displayName,
        credential_id: credentialIdB64,
        private_key: privateKeyB64,
        sign_count: 0,
        aaguid: base64urlEncode(aaguid),
      }),
    });
  } catch (e) {
    throw new Error(`Failed to store passkey: ${(e as Error).message}`);
  }

  // Export public key as SPKI for the response
  const publicKeySPKI = new Uint8Array(
    await crypto.subtle.exportKey('spki', keyPair.publicKey),
  );

  return {
    credentialId: credentialIdB64,
    attestationObject: base64urlEncode(attestationObject),
    clientDataJSON: base64urlEncode(clientDataJSON),
    publicKey: base64urlEncode(publicKeySPKI),
    publicKeyAlgorithm: -7,
    transports: ['internal'],
  };
}

/**
 * Handle navigator.credentials.get() — find a matching passkey and sign.
 */
async function handlePasskeyGet(payload: PasskeyGetPayload) {
  // List all passkeys
  const data = await bgRequest<{ entries: PasskeyEntry[] }>('/vault/passkeys');
  const passkeys = data.entries;

  // Filter by RP ID
  let candidates = passkeys.filter((pk) => pk.rp_id === payload.rpId);

  // If allowCredentials is specified, further filter
  if (payload.allowCredentials.length > 0) {
    const allowedIds = new Set(payload.allowCredentials.map((c) => c.id));
    candidates = candidates.filter((pk) => allowedIds.has(pk.credential_id));
  }

  if (candidates.length === 0) {
    throw new Error('No matching passkey found');
  }

  // Use the first matching passkey (could prompt user if multiple)
  const selected = candidates[0];

  // Fetch the full passkey with private key
  const fullData = await bgRequest<{
    entry: PasskeyEntry & { private_key: string };
  }>(`/vault/passkeys/${selected.id}`);
  const fullEntry = fullData.entry;

  // Import private key
  const privateKeyBytes = base64urlDecode(fullEntry.private_key);
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    privateKeyBytes.buffer.slice(privateKeyBytes.byteOffset, privateKeyBytes.byteOffset + privateKeyBytes.byteLength) as ArrayBuffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );

  // Build authenticator data
  const newSignCount = selected.sign_count + 1;
  const authData = await buildAssertionAuthData(payload.rpId, newSignCount);

  // Build clientDataJSON
  const clientData = {
    type: 'webauthn.get',
    challenge: payload.challenge,
    origin: payload.rpId.startsWith('localhost')
      ? `http://${payload.rpId}`
      : `https://${payload.rpId}`,
    crossOrigin: false,
  };
  const clientDataJSON = new TextEncoder().encode(JSON.stringify(clientData));

  // Sign: authData || SHA-256(clientDataJSON)
  const clientDataHash = new Uint8Array(await sha256(clientDataJSON));
  const signedData = concat(authData, clientDataHash);
  const signedDataBuf = signedData.buffer.slice(signedData.byteOffset, signedData.byteOffset + signedData.byteLength) as ArrayBuffer;
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      privateKey,
      signedDataBuf,
    ),
  );

  // Convert from raw IEEE P1363 (r || s, 64 bytes) to DER-encoded ASN.1 signature
  const derSignature = p1363ToDer(signature);

  // Update usage in the vault
  try {
    await bgRequest<{ sign_count: number }>(`/vault/passkeys/${selected.id}/use`, {
      method: 'POST',
    });
  } catch {
    // Non-critical — don't fail the authentication
  }

  return {
    credentialId: selected.credential_id,
    authenticatorData: base64urlEncode(authData),
    clientDataJSON: base64urlEncode(clientDataJSON),
    signature: base64urlEncode(derSignature),
    userHandle: selected.user_id,
  };
}

/**
 * Convert an IEEE P1363 signature (r || s, 64 bytes for P-256) to DER-encoded
 * ASN.1 format as expected by WebAuthn verifiers.
 */
function p1363ToDer(sig: Uint8Array): Uint8Array {
  const r = sig.slice(0, 32);
  const s = sig.slice(32, 64);

  function encodeInt(value: Uint8Array): Uint8Array {
    // Strip leading zeros, but keep at least one byte
    let start = 0;
    while (start < value.length - 1 && value[start] === 0) start++;
    const trimmed = value.slice(start);
    // If the high bit is set, prepend a zero byte
    const needsPad = trimmed[0] & 0x80;
    const len = trimmed.length + (needsPad ? 1 : 0);
    const result = new Uint8Array(2 + len);
    result[0] = 0x02; // INTEGER tag
    result[1] = len;
    if (needsPad) {
      result[2] = 0;
      result.set(trimmed, 3);
    } else {
      result.set(trimmed, 2);
    }
    return result;
  }

  const rDer = encodeInt(r);
  const sDer = encodeInt(s);
  const seqLen = rDer.length + sDer.length;
  const der = new Uint8Array(2 + seqLen);
  der[0] = 0x30; // SEQUENCE tag
  der[1] = seqLen;
  der.set(rDer, 2);
  der.set(sDer, 2 + rDer.length);
  return der;
}
