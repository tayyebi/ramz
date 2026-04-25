import React, { useState, useEffect } from 'react';
import { api } from '../../shared/api';
import { storage, DEFAULT_SERVER_URL } from '../../shared/storage';

type LoginState = 'checking' | 'setup' | 'unlock';

interface Props {
  onSuccess: () => void;
}

export default function Login({ onSuccess }: Props) {
  const [state, setState] = useState<LoginState>('checking');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [serverUrlSaved, setServerUrlSaved] = useState(false);

  useEffect(() => {
    void storage.get(['server_url']).then((data) => {
      setServerUrl(data.server_url || DEFAULT_SERVER_URL);
    });
    void (async () => {
      try {
        const status = await api.vaultStatus();
        setState(status.initialized ? 'unlock' : 'setup');
      } catch {
        // If backend unreachable, show unlock form as fallback
        setState('unlock');
      }
    })();
  }, []);

  const handleSaveServerUrl = async () => {
    const trimmed = serverUrl.trim();
    await storage.set({ server_url: trimmed || undefined });
    setServerUrl(trimmed || DEFAULT_SERVER_URL);
    setServerUrlSaved(true);
    setTimeout(() => setServerUrlSaved(false), 2000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (state === 'setup' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    try {
      const tokens =
        state === 'setup' ? await api.setup(password) : await api.unlock(password);
      await storage.saveTokens(tokens);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  if (state === 'checking') {
    return (
      <div className="login-form">
        <p>Connecting to vault...</p>
      </div>
    );
  }

  return (
    <div className="login-form">
      <h2>{state === 'setup' ? '🔐 Setup Vault' : '🔓 Unlock Vault'}</h2>
      <p>
        {state === 'setup'
          ? 'Create a master password to initialize your vault.'
          : 'Enter your master password to unlock the vault.'}
      </p>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="form-group">
          <label htmlFor="server-url">Backend URL</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              id="server-url"
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder={DEFAULT_SERVER_URL}
              disabled={loading}
            />
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleSaveServerUrl()}
              disabled={loading}
              style={{ whiteSpace: 'nowrap' }}
            >
              {serverUrlSaved ? '✓' : 'Save'}
            </button>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="master-password">Master Password</label>
          <input
            id="master-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter master password"
            autoFocus
            disabled={loading}
          />
        </div>
        {state === 'setup' && (
          <div className="form-group">
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              id="confirm-password"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm master password"
              disabled={loading}
            />
          </div>
        )}
        {error && <p className="error-msg">{error}</p>}
        <button
          type="submit"
          className="btn btn-primary"
          style={{ width: '100%', marginTop: 8 }}
          disabled={loading}
        >
          {loading ? 'Please wait...' : state === 'setup' ? 'Create Vault' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
