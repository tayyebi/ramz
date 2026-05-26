/**
 * WebAuthn interception script — injected into the page's MAIN world.
 *
 * Overrides navigator.credentials.create() and navigator.credentials.get()
 * to let Ramz act as a virtual passkey authenticator. Communication with the
 * extension's isolated-world content script happens via window.postMessage.
 */

(function () {
  if ((window as unknown as Record<string, boolean>).__ramzWebAuthnInjected) return;
  (window as unknown as Record<string, boolean>).__ramzWebAuthnInjected = true;

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function bufferToBase64url(buffer: ArrayBuffer | Uint8Array): string {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64urlToBuffer(str: string): ArrayBuffer {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  let messageId = 0;
  const pendingRequests = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();

  // Listen for responses from the content script
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as { type?: string; id?: number; result?: unknown; error?: string };
    if (data.type === 'RAMZ_PASSKEY_RESPONSE') {
      const pending = pendingRequests.get(data.id!);
      if (!pending) return;
      pendingRequests.delete(data.id!);
      if (data.error) {
        pending.reject(new DOMException(data.error, 'NotAllowedError'));
      } else {
        pending.resolve(data.result);
      }
    }
  });

  function sendAndWait(type: string, payload: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = ++messageId;
      pendingRequests.set(id, { resolve, reject });
      window.postMessage({ type, id, payload }, '*');
      // Timeout after 2 minutes (user interaction may be needed)
      setTimeout(() => {
        if (pendingRequests.has(id)) {
          pendingRequests.delete(id);
          reject(new DOMException('Request timed out', 'NotAllowedError'));
        }
      }, 120_000);
    });
  }

  // -----------------------------------------------------------------------
  // Override navigator.credentials.create
  // -----------------------------------------------------------------------

  const originalCreate = navigator.credentials.create.bind(navigator.credentials);

  navigator.credentials.create = async function (
    options?: CredentialCreationOptions,
  ): Promise<Credential | null> {
    if (!options?.publicKey) {
      return originalCreate(options);
    }

    const pk = options.publicKey;

    try {
      const result = (await sendAndWait('RAMZ_PASSKEY_CREATE', {
        rp: { id: pk.rp.id ?? window.location.hostname, name: pk.rp.name },
        user: {
          id: bufferToBase64url(pk.user.id as ArrayBuffer),
          name: pk.user.name,
          displayName: pk.user.displayName,
        },
        challenge: bufferToBase64url(pk.challenge as ArrayBuffer),
        pubKeyCredParams: pk.pubKeyCredParams,
        excludeCredentials: (pk.excludeCredentials ?? []).map((c) => ({
          id: bufferToBase64url(c.id as ArrayBuffer),
          type: c.type,
        })),
        authenticatorSelection: pk.authenticatorSelection,
        attestation: pk.attestation ?? 'none',
      })) as {
        credentialId: string;
        attestationObject: string;
        clientDataJSON: string;
        publicKey: string;
        publicKeyAlgorithm: number;
        transports: string[];
      };

      // Build a PublicKeyCredential-like object
      const credentialIdBuf = base64urlToBuffer(result.credentialId);
      const attestationObjectBuf = base64urlToBuffer(result.attestationObject);
      const clientDataJSONBuf = base64urlToBuffer(result.clientDataJSON);
      const publicKeyBuf = base64urlToBuffer(result.publicKey);

      const response = {
        attestationObject: attestationObjectBuf,
        clientDataJSON: clientDataJSONBuf,
        getAuthenticatorData: () => {
          // Extract authData from attestation object — skip CBOR map overhead
          // For simplicity, return the attestationObject (consumers usually parse it)
          return attestationObjectBuf;
        },
        getPublicKey: () => publicKeyBuf,
        getPublicKeyAlgorithm: () => result.publicKeyAlgorithm,
        getTransports: () => result.transports,
      };

      const credential = {
        id: result.credentialId,
        rawId: credentialIdBuf,
        response,
        type: 'public-key' as const,
        authenticatorAttachment: 'platform' as AuthenticatorAttachment,
        getClientExtensionResults: () => ({}),
      };

      return credential as unknown as PublicKeyCredential;
    } catch {
      // Fall through to the platform authenticator
      return originalCreate(options);
    }
  };

  // -----------------------------------------------------------------------
  // Override navigator.credentials.get
  // -----------------------------------------------------------------------

  const originalGet = navigator.credentials.get.bind(navigator.credentials);

  navigator.credentials.get = async function (
    options?: CredentialRequestOptions,
  ): Promise<Credential | null> {
    if (!options?.publicKey) {
      return originalGet(options);
    }

    const pk = options.publicKey;
    const rpId = pk.rpId ?? window.location.hostname;

    try {
      const result = (await sendAndWait('RAMZ_PASSKEY_GET', {
        rpId,
        challenge: bufferToBase64url(pk.challenge as ArrayBuffer),
        allowCredentials: (pk.allowCredentials ?? []).map((c) => ({
          id: bufferToBase64url(c.id as ArrayBuffer),
          type: c.type,
        })),
        userVerification: pk.userVerification ?? 'preferred',
      })) as {
        credentialId: string;
        authenticatorData: string;
        clientDataJSON: string;
        signature: string;
        userHandle: string;
      };

      const credentialIdBuf = base64urlToBuffer(result.credentialId);
      const authenticatorDataBuf = base64urlToBuffer(result.authenticatorData);
      const clientDataJSONBuf = base64urlToBuffer(result.clientDataJSON);
      const signatureBuf = base64urlToBuffer(result.signature);
      const userHandleBuf = result.userHandle ? base64urlToBuffer(result.userHandle) : null;

      const response = {
        authenticatorData: authenticatorDataBuf,
        clientDataJSON: clientDataJSONBuf,
        signature: signatureBuf,
        userHandle: userHandleBuf,
      };

      const credential = {
        id: result.credentialId,
        rawId: credentialIdBuf,
        response,
        type: 'public-key' as const,
        authenticatorAttachment: 'platform' as AuthenticatorAttachment,
        getClientExtensionResults: () => ({}),
      };

      return credential as unknown as PublicKeyCredential;
    } catch {
      // Fall through to the platform authenticator
      return originalGet(options);
    }
  };
})();
