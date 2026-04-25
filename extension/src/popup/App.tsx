import React, { useState, useEffect } from 'react';
import type { AppView } from '../shared/types';
import Login from './components/Login';
import Dashboard from './components/Dashboard';
import EntryDetail from './components/EntryDetail';
import EntryForm from './components/EntryForm';
import MfaList from './components/MfaList';
import Settings from './components/Settings';
import PasswordGenerator from './components/PasswordGenerator';
import { storage } from '../shared/storage';
import { api } from '../shared/api';

export default function App() {
  const [view, setView] = useState<AppView>('login');
  const [isLoading, setIsLoading] = useState(true);
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [isNewEntry, setIsNewEntry] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await storage.get(['access_token', 'token_expires_at']);
        if (data.access_token && data.token_expires_at && Date.now() < data.token_expires_at) {
          const status = await api.vaultStatus().catch(() => null);
          if (status?.unlocked) {
            setView('dashboard');
          } else {
            setView('login');
          }
        } else {
          setView('login');
        }
      } catch {
        setView('login');
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
