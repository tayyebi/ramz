import React, { useState, useEffect } from 'react';
import type { PasskeyEntry } from '../../shared/types';
import { api } from '../../shared/api';

export default function PasskeyList() {
  const [entries, setEntries] = useState<PasskeyEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    rp_id: '',
    rp_name: '',
    user_name: '',
    user_display_name: '',
    user_id: '',
    credential_id: '',
    private_key: '',
    aaguid: '',
  });

  const loadPasskeys = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listPasskeys();
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load passkeys');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPasskeys();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.createPasskey({
        rp_id: form.rp_id.trim(),
        rp_name: form.rp_name.trim(),
        user_name: form.user_name.trim(),
        user_display_name: form.user_display_name.trim(),
        user_id: form.user_id.trim(),
        credential_id: form.credential_id.trim(),
        private_key: form.private_key.trim(),
        sign_count: 0,
        aaguid: form.aaguid.trim() || undefined,
      });
      setForm({
        rp_id: '',
        rp_name: '',
        user_name: '',
        user_display_name: '',
        user_id: '',
        credential_id: '',
        private_key: '',
        aaguid: '',
      });
      setShowAdd(false);
      await loadPasskeys();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add passkey');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this passkey entry?')) return;
    try {
      await api.deletePasskey(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete passkey');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <strong style={{ fontSize: 15 }}>Passkeys</strong>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAdd((v) => !v)}>
          + Add Passkey
        </button>
      </div>

      {showAdd && (
        <form onSubmit={(e) => void handleAdd(e)} style={{ marginBottom: 12 }}>
          <div className="form-group">
            <label htmlFor="pk-rp-id">Relying Party ID</label>
            <input
              id="pk-rp-id"
              type="text"
              value={form.rp_id}
              onChange={(e) => setForm((f) => ({ ...f, rp_id: e.target.value }))}
              placeholder="example.com"
              required
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="pk-rp-name">Relying Party Name</label>
            <input
              id="pk-rp-name"
              type="text"
              value={form.rp_name}
              onChange={(e) => setForm((f) => ({ ...f, rp_name: e.target.value }))}
              placeholder="Example Service"
              required
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="pk-user-name">Username</label>
            <input
              id="pk-user-name"
              type="text"
              value={form.user_name}
              onChange={(e) => setForm((f) => ({ ...f, user_name: e.target.value }))}
              placeholder="user@example.com"
              required
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="pk-user-display-name">Display Name</label>
            <input
              id="pk-user-display-name"
              type="text"
              value={form.user_display_name}
              onChange={(e) => setForm((f) => ({ ...f, user_display_name: e.target.value }))}
              placeholder="Jane Doe"
              required
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="pk-user-id">User ID (base64)</label>
            <input
              id="pk-user-id"
              type="text"
              value={form.user_id}
              onChange={(e) => setForm((f) => ({ ...f, user_id: e.target.value }))}
              placeholder="Base64-encoded user handle"
              required
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="pk-credential-id">Credential ID (base64)</label>
            <input
              id="pk-credential-id"
              type="text"
              value={form.credential_id}
              onChange={(e) => setForm((f) => ({ ...f, credential_id: e.target.value }))}
              placeholder="Base64-encoded credential ID"
              required
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="pk-private-key">Private Key (base64)</label>
            <input
              id="pk-private-key"
              type="password"
              value={form.private_key}
              onChange={(e) => setForm((f) => ({ ...f, private_key: e.target.value }))}
              placeholder="Base64-encoded private key"
              required
              disabled={saving}
            />
          </div>
          <div className="form-group">
            <label htmlFor="pk-aaguid">AAGUID (optional)</label>
            <input
              id="pk-aaguid"
              type="text"
              value={form.aaguid}
              onChange={(e) => setForm((f) => ({ ...f, aaguid: e.target.value }))}
              placeholder="Authenticator AAGUID"
              disabled={saving}
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowAdd(false)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {loading && <p style={{ textAlign: 'center', color: '#64748b', fontSize: 13 }}>Loading...</p>}
      {error && <p className="error-msg">{error}</p>}

      {!loading && entries.length === 0 && (
        <div className="empty-state">
          <div style={{ fontSize: 32 }}>🗝️</div>
          <p>No passkeys stored. Add a passkey to get started.</p>
        </div>
      )}

      {entries.map((entry) => (
        <div key={entry.id} className="mfa-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{entry.rp_name}</div>
              <div style={{ fontSize: 12, color: '#64748b' }}>{entry.rp_id}</div>
              <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>
                {entry.user_display_name} ({entry.user_name})
              </div>
              {entry.last_used_at && (
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
                  Last used: {new Date(entry.last_used_at).toLocaleDateString()}
                </div>
              )}
            </div>
            <button className="btn-icon" onClick={() => void handleDelete(entry.id)}>
              🗑️
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
