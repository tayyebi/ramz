import React, { useState, useEffect } from 'react';
import type { PasswordEntry } from '../../shared/types';
import { api } from '../../shared/api';
import { copyToClipboard, formatDate } from '../../shared/utils';

interface Props {
  entryId: string;
  onBack: () => void;
  onEdit: (id: string) => void;
}

export default function EntryDetail({ entryId, onBack, onEdit }: Props) {
  const [entry, setEntry] = useState<PasswordEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await api.getEntry(entryId);
        setEntry(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load entry');
      } finally {
        setLoading(false);
      }
    })();
  }, [entryId]);

  const handleDelete = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await api.deleteEntry(entryId);
      onBack();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete entry');
    }
  };

  const handleFill = () => {
    if (!entry) return;
    chrome.runtime.sendMessage({
      type: 'FILL_CREDENTIALS',
      data: { username: entry.username, password: entry.password },
    });
  };

  if (loading) return <p style={{ textAlign: 'center', color: '#64748b' }}>Loading...</p>;
  if (error) return <p className="error-msg">{error}</p>;
  if (!entry) return null;

  return (
    <div>
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>
          ← Back
        </button>
        <span style={{ flex: 1, fontWeight: 600 }}>{entry.title}</span>
        <button className="btn btn-secondary btn-sm" onClick={() => onEdit(entry.id)}>
          Edit
        </button>
      </div>

      <div className="detail-field">
        <label>Username</label>
        <div className="detail-field-value">
          <span style={{ fontFamily: 'inherit' }}>{entry.username}</span>
          <button className="btn-icon" title="Copy" onClick={() => copyToClipboard(entry.username)}>
            📋
          </button>
        </div>
      </div>

      <div className="detail-field">
        <label>Password</label>
        <div className="detail-field-value">
          <span>{showPassword ? entry.password : '••••••••••••'}</span>
          <button
            className="btn-icon"
            title={showPassword ? 'Hide' : 'Show'}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? '🙈' : '👁️'}
          </button>
          <button className="btn-icon" title="Copy" onClick={() => copyToClipboard(entry.password)}>
            📋
          </button>
        </div>
      </div>

      {entry.url && (
        <div className="detail-field">
          <label>URL</label>
          <div className="detail-field-value">
            <span style={{ fontFamily: 'inherit', fontSize: 12 }}>{entry.url}</span>
            <button className="btn-icon" title="Copy" onClick={() => copyToClipboard(entry.url!)}>
              📋
            </button>
          </div>
        </div>
      )}

      {entry.notes && (
        <div className="detail-field">
          <label>Notes</label>
          <div style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: 6, fontSize: 13 }}>
            {entry.notes}
          </div>
        </div>
      )}

      {entry.tags && entry.tags.length > 0 && (
        <div className="detail-field">
          <label>Tags</label>
          <div>{entry.tags.map((t) => <span key={t} className="tag">{t}</span>)}</div>
        </div>
      )}

      <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 12 }}>
        Updated {formatDate(entry.updated_at)}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary btn-sm" onClick={handleFill}>
          Auto-fill
        </button>
        <button
          className={`btn btn-sm ${confirmDelete ? 'btn-danger' : 'btn-secondary'}`}
          onClick={() => void handleDelete()}
        >
          {confirmDelete ? 'Confirm Delete' : 'Delete'}
        </button>
        {confirmDelete && (
          <button className="btn btn-secondary btn-sm" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
