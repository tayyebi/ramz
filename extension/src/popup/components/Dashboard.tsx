import React, { useState, useEffect, useCallback } from 'react';
import type { PasswordEntry } from '../../shared/types';
import { api } from '../../shared/api';
import EntryList from './EntryList';

interface Props {
  onSelectEntry: (id: string) => void;
  onNewEntry: () => void;
}

export default function Dashboard({ onSelectEntry, onNewEntry }: Props) {
  const [entries, setEntries] = useState<PasswordEntry[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadEntries = useCallback(async (q?: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listEntries(q);
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load entries');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEntries();
  }, [loadEntries]);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const q = e.target.value;
    setSearch(q);
    void loadEntries(q || undefined);
  };

  return (
    <div>
      <div className="search-bar">
        <input
          type="text"
          placeholder="Search entries..."
          value={search}
          onChange={handleSearch}
        />
        <button className="btn btn-primary btn-sm" onClick={onNewEntry}>
          + Add
        </button>
      </div>
      {loading && <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading...</p>}
      {error && <p className="error-msg">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <div className="empty-state">
          <div style={{ fontSize: 32 }}>🔒</div>
          <p>{search ? 'No entries found.' : 'No passwords saved yet. Add one!'}</p>
        </div>
      )}
      {!loading && entries.length > 0 && (
        <EntryList entries={entries} onSelect={onSelectEntry} />
      )}
    </div>
  );
}
