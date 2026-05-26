// Content script - auto-fill and auto-capture

// ---------------------------------------------------------------------------
// WebAuthn passkey message relay (page ↔ background)
// ---------------------------------------------------------------------------

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const data = event.data as { type?: string; id?: number; payload?: unknown };
  if (data.type === 'RAMZ_PASSKEY_CREATE' || data.type === 'RAMZ_PASSKEY_GET') {
    chrome.runtime.sendMessage(
      { type: data.type, id: data.id, payload: data.payload },
      (response: { result?: unknown; error?: string } | undefined) => {
        window.postMessage(
          {
            type: 'RAMZ_PASSKEY_RESPONSE',
            id: data.id,
            result: response?.result,
            error: response?.error,
          },
          '*',
        );
      },
    );
  }
});

// ---------------------------------------------------------------------------
// Login form detection and auto-fill
// ---------------------------------------------------------------------------
let isListening = false;

function findLoginForm(): {
  usernameField: HTMLInputElement | null;
  passwordField: HTMLInputElement | null;
} {
  const passwordField = document.querySelector<HTMLInputElement>('input[type="password"]');
  if (!passwordField) return { usernameField: null, passwordField: null };

  const form = passwordField.closest('form');
  const usernameField =
    form?.querySelector<HTMLInputElement>(
      'input[type="email"], input[type="text"][name*="user"], input[type="text"][name*="login"], input[type="text"][name*="email"], input[name*="user"], input[name*="login"], input[name*="email"]'
    ) || document.querySelector<HTMLInputElement>('input[type="email"]');

  return { usernameField: usernameField ?? null, passwordField };
}

function fillCredentials(username: string, password: string): void {
  const { usernameField, passwordField } = findLoginForm();
  if (usernameField) {
    usernameField.value = username;
    usernameField.dispatchEvent(new Event('input', { bubbles: true }));
    usernameField.dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (passwordField) {
    passwordField.value = password;
    passwordField.dispatchEvent(new Event('input', { bubbles: true }));
    passwordField.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// Listen for messages from background
chrome.runtime.onMessage.addListener((message: { type: string; data?: { username: string; password: string } }) => {
  if (message.type === 'FILL_FORM' && message.data) {
    fillCredentials(message.data.username, message.data.password);
  }
  if (message.type === 'SHOW_PICKER') {
    chrome.runtime.sendMessage({ type: 'OPEN_POPUP' });
  }
});

// Watch for form submissions to prompt save
function watchFormSubmissions(): void {
  if (isListening) return;
  isListening = true;

  document.addEventListener('submit', (e) => {
    const form = e.target as HTMLFormElement;
    const passwordField = form.querySelector<HTMLInputElement>('input[type="password"]');
    const usernameField = form.querySelector<HTMLInputElement>(
      'input[type="email"], input[type="text"][name*="user"], input[name*="email"]'
    );

    if (passwordField?.value && usernameField?.value) {
      chrome.runtime.sendMessage({
        type: 'CREDENTIALS_SUBMITTED',
        data: {
          username: usernameField.value,
          password: passwordField.value,
          url: window.location.href,
        },
      });
    }
  });
}

watchFormSubmissions();
