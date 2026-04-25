export interface StoredData {
  access_token?: string;
  refresh_token?: string;
  token_expires_at?: number;
}

export const storage = {
  get: (keys: string[]): Promise<StoredData> =>
    new Promise((resolve) =>
      chrome.storage.local.get(keys, (result) => resolve(result as StoredData))
    ),

  set: (data: Partial<StoredData>): Promise<void> =>
    new Promise((resolve) => chrome.storage.local.set(data, resolve)),

  clear: (): Promise<void> => new Promise((resolve) => chrome.storage.local.clear(resolve)),

  saveTokens: async (tokens: {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }): Promise<void> => {
    await storage.set({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: Date.now() + tokens.expires_in * 1000,
    });
  },
};
