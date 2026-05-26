import type { PasswordEntry, MfaEntry, PasskeyEntry, AuthTokens, TotpCode } from './types';
import { DEFAULT_SERVER_URL } from './storage';
import {
  cacheEntries,
  getCachedEntries,
  addPendingChange,
  applyCachedCreate,
  applyCachedUpdate,
  applyCachedDelete,
} from './offlineCache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getBaseUrl(): Promise<string> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['server_url'], (result) => {
      const raw = (result['server_url'] as string) || DEFAULT_SERVER_URL;
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

/** Returns true when the error is a network-level failure (server unreachable). */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /fetch|network/i.test((err as TypeError).message);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
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
// Public API (with offline fallback for password entries)
// ---------------------------------------------------------------------------

export const api = {
  // -- Auth / health (no offline fallback — require connectivity) -----------
  health: () =>
    request<{ status: string; vault_initialized: boolean; vault_unlocked: boolean }>('/health'),
  vaultStatus: () =>
    request<{ initialized: boolean; unlocked: boolean; entry_count?: number }>('/vault/status'),
  setup: (masterPassword: string) =>
    request<AuthTokens>('/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ master_password: masterPassword }),
    }),
  unlock: (masterPassword: string) =>
    request<AuthTokens>('/auth/unlock', {
      method: 'POST',
      body: JSON.stringify({ master_password: masterPassword }),
    }),
  lock: () => request<{ message: string }>('/auth/lock', { method: 'POST' }),
  refresh: (refreshToken: string) =>
    request<AuthTokens>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refresh_token: refreshToken }),
    }),

  // -- Password entries (offline-capable) -----------------------------------

  listEntries: async (search?: string): Promise<PasswordEntry[]> => {
    try {
      const entries = await request<{ entries: PasswordEntry[]; total: number }>(
        `/vault/entries${search ? `?search=${encodeURIComponent(search)}` : ''}`,
      ).then((r) => r.entries);
      // Cache on success (only full, unfiltered lists)
      if (!search) {
        await cacheEntries(entries);
      }
      return entries;
    } catch (err) {
      if (isNetworkError(err)) {
        // Serve from cache
        const cached = await getCachedEntries();
        if (search) {
          const q = search.toLowerCase();
          return cached.filter(
            (e) =>
              e.title.toLowerCase().includes(q) ||
              e.username.toLowerCase().includes(q) ||
              (e.url && e.url.toLowerCase().includes(q)),
          );
        }
        return cached;
      }
      throw err;
    }
  },

  getEntry: async (id: string): Promise<PasswordEntry> => {
    try {
      return await request<{ entry: PasswordEntry }>(`/vault/entries/${id}`).then((r) => r.entry);
    } catch (err) {
      if (isNetworkError(err)) {
        const cached = await getCachedEntries();
        const entry = cached.find((e) => e.id === id);
        if (entry) return entry;
      }
      throw err;
    }
  },

  createEntry: async (
    entry: Omit<PasswordEntry, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<PasswordEntry> => {
    try {
      const created = await request<{ entry: PasswordEntry }>('/vault/entries', {
        method: 'POST',
        body: JSON.stringify(entry),
      }).then((r) => r.entry);
      // Update cache
      const cached = await getCachedEntries();
      cached.push(created);
      await cacheEntries(cached);
      return created;
    } catch (err) {
      if (isNetworkError(err)) {
        const tempId = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await addPendingChange({ type: 'create', tempId, payload: entry, timestamp: Date.now() });
        await applyCachedCreate(tempId, entry);
        const now = new Date().toISOString();
        return { ...entry, id: tempId, created_at: now, updated_at: now } as PasswordEntry;
      }
      throw err;
    }
  },

  updateEntry: async (id: string, entry: Partial<PasswordEntry>): Promise<PasswordEntry> => {
    try {
      const updated = await request<{ entry: PasswordEntry }>(`/vault/entries/${id}`, {
        method: 'PUT',
        body: JSON.stringify(entry),
      }).then((r) => r.entry);
      // Update cache
      const cached = await getCachedEntries();
      const idx = cached.findIndex((e) => e.id === id);
      if (idx !== -1) {
        cached[idx] = updated;
        await cacheEntries(cached);
      }
      return updated;
    } catch (err) {
      if (isNetworkError(err)) {
        await addPendingChange({ type: 'update', id, payload: entry, timestamp: Date.now() });
        await applyCachedUpdate(id, entry);
        // Return the locally-patched version
        const cached = await getCachedEntries();
        const patched = cached.find((e) => e.id === id);
        if (patched) return patched;
      }
      throw err;
    }
  },

  deleteEntry: async (id: string): Promise<{ message: string }> => {
    try {
      const result = await request<{ message: string }>(`/vault/entries/${id}`, { method: 'DELETE' });
      // Update cache
      const cached = await getCachedEntries();
      await cacheEntries(cached.filter((e) => e.id !== id));
      return result;
    } catch (err) {
      if (isNetworkError(err)) {
        await addPendingChange({ type: 'delete', id, timestamp: Date.now() });
        await applyCachedDelete(id);
        return { message: 'Queued for deletion when back online' };
      }
      throw err;
    }
  },

  // -- MFA (no offline cache — TOTP codes require server) -------------------
  listMfa: () =>
    request<{ entries: MfaEntry[] }>('/vault/mfa').then((r) => r.entries),
  createMfa: (entry: Omit<MfaEntry, 'id' | 'created_at'> & { secret: string }) =>
    request<{ entry: MfaEntry }>('/vault/mfa', {
      method: 'POST',
      body: JSON.stringify(entry),
    }).then((r) => r.entry),
  deleteMfa: (id: string) =>
    request<{ message: string }>(`/vault/mfa/${id}`, { method: 'DELETE' }),
  getTotp: (id: string) => request<TotpCode>(`/vault/mfa/${id}/totp`),
  importMfaUri: (uri: string) =>
    request<{ entry: MfaEntry }>('/vault/mfa/import', {
      method: 'POST',
      body: JSON.stringify({ uri }),
    }).then((r) => r.entry),

  // -- Passkeys (no offline cache) ------------------------------------------
  listPasskeys: () =>
    request<{ entries: PasskeyEntry[] }>('/vault/passkeys').then((r) => r.entries),
  createPasskey: (entry: Omit<PasskeyEntry, 'id' | 'created_at' | 'last_used_at'> & { private_key: string }) =>
    request<{ entry: PasskeyEntry }>('/vault/passkeys', {
      method: 'POST',
      body: JSON.stringify(entry),
    }).then((r) => r.entry),
  getPasskey: (id: string) =>
    request<{ entry: PasskeyEntry }>(`/vault/passkeys/${id}`).then((r) => r.entry),
  deletePasskey: (id: string) =>
    request<{ message: string }>(`/vault/passkeys/${id}`, { method: 'DELETE' }),
  updatePasskeyUsage: (id: string) =>
    request<{ sign_count: number }>(`/vault/passkeys/${id}/use`, { method: 'POST' }),
  exportVault: () => request<unknown>('/vault/export'),
  importVault: (data: unknown) =>
    request<{ message: string; imported_count: number }>('/vault/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
