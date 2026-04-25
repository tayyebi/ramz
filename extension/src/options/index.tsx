import React from 'react';
import { createRoot } from 'react-dom/client';

function OptionsPage() {
  return (
    <div>
      <h1>🔐 Ramz Password Manager</h1>
      <p>Extension options and setup instructions.</p>

      <div className="section">
        <h2>Backend Configuration</h2>
        <p>
          This extension connects to a self-hosted backend at{' '}
          <code>http://localhost:8080</code>. Make sure your Ramz backend server is
          running before using the extension.
        </p>
      </div>

      <div className="section">
        <h2>Getting Started</h2>
        <p>
          1. Start the Ramz backend server on your machine (port 8080 by default).
          <br />
          2. Click the extension icon in your browser toolbar.
          <br />
          3. If this is your first time, create a master password to initialize the vault.
          <br />
          4. Use the popup to save, view, and auto-fill your passwords.
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
          communicates with <code>http://localhost:8080</code> and never sends data to
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
