import React from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_SERVER_URL } from '../shared/storage';

function OptionsPage() {
  return (
    <div>
      <h1>🔐 Ramz Password Manager</h1>
      <p>Extension options and setup instructions.</p>

      <div className="section">
        <h2>Backend Configuration</h2>
        <p>
          This extension connects to a self-hosted Ramz backend. The default address is{' '}
          <code>{DEFAULT_SERVER_URL}</code>, but you can change it from the{' '}
          <strong>Settings</strong> tab inside the extension popup to point to any host
          and port where your Ramz server is running.
        </p>
      </div>

      <div className="section">
        <h2>Getting Started</h2>
        <p>
          1. Start the Ramz backend server (port 8080 by default).
          <br />
          2. Click the extension icon in your browser toolbar.
          <br />
          3. If the server runs on a different address or port, open the{' '}
          <strong>Settings</strong> tab and update the Backend URL before logging in.
          <br />
          4. If this is your first time, create a master password to initialize the vault.
          <br />
          5. Use the popup to save, view, and auto-fill your passwords.
        </p>
      </div>

      <div className="section">
        <h2>Auto-fill</h2>
        <p>
          The extension automatically detects login forms. You can also right-click on
          any text field and select <strong>Fill with Ramz</strong> to fill credentials.
        </p>
      </div>

      <div className="section">
        <h2>MFA / TOTP</h2>
        <p>
          Import TOTP secrets using <code>otpauth://</code> URIs from the MFA tab in the
          popup. Live countdown codes are displayed and can be copied with one click.
        </p>
      </div>

      <div className="section">
        <h2>Security</h2>
        <p>
          All data is stored and encrypted on your local backend. The extension only
          communicates with the backend URL you configure and never sends data to
          external servers.
        </p>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<OptionsPage />);
}
