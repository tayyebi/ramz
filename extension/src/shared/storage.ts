export const DEFAULT_SERVER_URL = 'http://localhost:8080';

export interface StoredData {
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: number;
  server_url?: string;
}

export const storage = {
  get: (keys: string[]): Promise<StoredData> =>
    new Promise((resolve) =>
      chrome.storage.local.get(keys, (result) => resolve(result as StoredData))
    ),

  set: (data: Partial<StoredData>): Promise<void> =>
    new Promise((resolve) => chrome.storage.local.set(data, resolve)),

  clear: (): Promise<void> => new Promise((resolve) => chrome.storage.local.clear(resolve)),

  saveTokens: async (
    tokens: { access_token: string; refresh_token: string; expires_in: number },
    remember = true,
  ): Promise<void> => {
    await storage.set({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      // When remember=false the token expires immediately so next popup open
      // will require the master password again.
      token_expires_at: remember ? Date.now() + tokens.expires_in * 1000 : 0,
    });
  },
};
