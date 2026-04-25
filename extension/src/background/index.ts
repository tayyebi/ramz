// Service worker for Ramz extension
import { storage } from '../shared/storage';

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

// Token refresh alarm
chrome.alarms.create('token-refresh', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'token-refresh') {
    const data = await storage.get(['refresh_token', 'token_expires_at']);
    if (data.refresh_token && data.token_expires_at) {
      const minutesLeft = (data.token_expires_at - Date.now()) / 60000;
      if (minutesLeft < 5 && minutesLeft > 0) {
        try {
          const resp = await fetch('http://localhost:8080/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: data.refresh_token }),
          });
          if (resp.ok) {
            const tokens = (await resp.json()) as {
              access_token: string;
              refresh_token: string;
              expires_in: number;
            };
            await storage.saveTokens(tokens);
          }
        } catch {
          // Backend might be unavailable
        }
      }
    }
  }
});
