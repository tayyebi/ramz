import React, { useState, useEffect } from 'react';
import type { AppView } from '../shared/types';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import EntryDetail from './components/EntryDetail';
import EntryForm from './components/EntryForm';
import MfaList from './components/MfaList';
import PasskeyList from './components/PasskeyList';
import Settings from './components/Settings';
import PasswordGenerator from './components/PasswordGenerator';
import { storage } from '../shared/storage';
import type { StoredData } from '../shared/storage';
import { api } from '../shared/api';
import { useConnectionStatus } from '../shared/connectionStatus';
import { getPendingChanges } from '../shared/offlineCache';

export default function App() {
  const [view, setView] = useState<AppView>('login');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [isNewEntry, setIsNewEntry] = useState(false);
  const { online } = useConnectionStatus();
  const [pendingCount, setPendingCount] = useState(0);

  // Track pending changes count
  useEffect(() => {
    const refresh = () => void getPendingChanges().then((q) => setPendingCount(q.length));
    refresh();
    const interval = setInterval(refresh, 5_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const data = await storage.get(['access_token', 'token_expires_at']);
        if (data.access_token && data.token_expires_at && Date.now() < data.token_expires_at) {
          const status = await api.vaultStatus().catch(() => null);
          if (status?.unlocked) {
            setView('dashboard');
          } else {
            // If offline but we have a valid token, go to dashboard with cached data
            if (!status) {
              setView('dashboard');
            } else {
              setView('login');
            }
          }
        } else {
          setView('login');
        }
      } catch {
        // If offline but we have cached tokens, allow dashboard access
        const fallback = await storage.get(['access_token', 'token_expires_at']).catch((): StoredData => ({}));
        if (fallback.access_token && fallback.token_expires_at && Date.now() < fallback.token_expires_at) {
          setView('dashboard');
        } else {
          setView('login');
        }
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const handleLoginSuccess = () => setView('dashboard');

  const handleLogout = async () => {
    try {
      await api.lock();
    } catch {
      // ignore
    }
    await storage.clear();
    setView('login');
  };

  const handleSelectEntry = (id: string) => {
    setSelectedEntryId(id);
    setView('entry-detail');
  };

  const handleNewEntry = () => {
    setIsNewEntry(true);
    setEditingEntryId(null);
    setView('entry-form');
  };

  const handleEditEntry = (id: string) => {
    setEditingEntryId(id);
    setIsNewEntry(false);
    setView('entry-form');
  };

  const handleBack = () => setView('dashboard');

  if (isLoading) {
    return (
      <div
        className="app"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 200 }}
      >
        Loading...
      </div>
    );
  }

  if (view === 'login') {
    return (
      <div className="app">
        <Login onSuccess={handleLoginSuccess} />
      </div>
    );
  }

  return (
    <div className="app">
      {!online && (
        <div className="offline-banner">
          ⚡ Offline mode{pendingCount > 0 ? ` · ${pendingCount} pending change${pendingCount > 1 ? 's' : ''}` : ''}
        </div>
      )}
      <div className="header">
        <h1>🔐 Ramz</h1>
        <div className="header-actions">
          <button onClick={() => setView('generator')}>Generate</button>
          <button onClick={() => void handleLogout()}>Lock</button>
        </div>
      </div>
      <div className="content">
        {view === 'dashboard' && (
          <Dashboard onSelectEntry={handleSelectEntry} onNewEntry={handleNewEntry} />
        )}
        {view === 'entry-detail' && selectedEntryId && (
          <EntryDetail
            entryId={selectedEntryId}
            onBack={handleBack}
            onEdit={handleEditEntry}
          />
        )}
        {view === 'entry-form' && (
          <EntryForm
            entryId={editingEntryId}
            isNew={isNewEntry}
            onBack={handleBack}
            onSaved={handleBack}
          />
        )}
        {view === 'mfa' && <MfaList />}
        {view === 'passkeys' && <PasskeyList />}
        {view === 'settings' && <Settings onLogout={handleLogout} />}
        {view === 'generator' && <PasswordGenerator onBack={handleBack} />}
      </div>
      <nav className="nav-bottom">
        <button
          className={`nav-btn ${view === 'dashboard' ? 'active' : ''}`}
          onClick={() => setView('dashboard')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          Vault
        </button>
        <button
          className={`nav-btn ${view === 'mfa' ? 'active' : ''}`}
          onClick={() => setView('mfa')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 3" />
          </svg>
          MFA
        </button>
        <button
          className={`nav-btn ${view === 'passkeys' ? 'active' : ''}`}
          onClick={() => setView('passkeys')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
          </svg>
          Passkeys
        </button>
        <button
          className={`nav-btn ${view === 'settings' ? 'active' : ''}`}
          onClick={() => setView('settings')}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          Settings
        </button>
      </nav>
    </div>
  );
}
