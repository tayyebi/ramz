// Service worker for Ramz extension
import { storage } from '../shared/storage';
import { getPendingChanges, removePendingChange, cacheEntries } from '../shared/offlineCache';
import type { PasswordEntry, AuthTokens } from '../shared/types';

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
