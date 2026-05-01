import type { PasswordEntry, MfaEntry, AuthTokens, TotpCode } from './types';
import { DEFAULT_SERVER_URL } from './storage';

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

export const api = {
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
  listEntries: (search?: string) =>
    request<{ entries: PasswordEntry[]; total: number }>(
      `/vault/entries${search ? `?search=${encodeURIComponent(search)}` : ''}`
    ).then((r) => r.entries),
  getEntry: (id: string) =>
    request<{ entry: PasswordEntry }>(`/vault/entries/${id}`).then((r) => r.entry),
  createEntry: (entry: Omit<PasswordEntry, 'id' | 'created_at' | 'updated_at'>) =>
    request<{ entry: PasswordEntry }>('/vault/entries', {
      method: 'POST',
      body: JSON.stringify(entry),
    }).then((r) => r.entry),
  updateEntry: (id: string, entry: Partial<PasswordEntry>) =>
    request<{ entry: PasswordEntry }>(`/vault/entries/${id}`, {
      method: 'PUT',
      body: JSON.stringify(entry),
    }).then((r) => r.entry),
  deleteEntry: (id: string) =>
    request<{ message: string }>(`/vault/entries/${id}`, { method: 'DELETE' }),
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
  exportVault: () => request<unknown>('/vault/export'),
  importVault: (data: unknown) =>
    request<{ message: string; imported_count: number }>('/vault/import', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
