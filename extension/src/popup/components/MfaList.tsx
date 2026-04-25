import React, { useState, useEffect, useCallback } from 'react';
import type { MfaEntry, TotpCode } from '../../shared/types';
import { api } from '../../shared/api';
import { copyToClipboard } from '../../shared/utils';

interface TotpState {
  code: string;
  expiresIn: number;
  period: number;
}

function TotpDisplay({ mfaId, period }: { mfaId: string; period: number }) {
  const [totp, setTotp] = useState<TotpState | null>(null);

  const fetchTotp = useCallback(async () => {
    try {
      const data: TotpCode = await api.getTotp(mfaId);
      setTotp({ code: data.code, expiresIn: data.expires_in, period });
    } catch {
      // ignore
    }
  }, [mfaId, period]);

  useEffect(() => {
    void fetchTotp();
    const interval = setInterval(() => void fetchTotp(), 1000);
    return () => clearInterval(interval);
  }, [fetchTotp]);

  if (!totp) return <span style={{ color: '#94a3b8' }}>Loading...</span>;

  const progress = (totp.expiresIn / totp.period) * 100;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="totp-code">{totp.code}</span>
        <button className="btn-icon" title="Copy" onClick={() => copyToClipboard(totp.code)}>
          📋
        </button>
      </div>
      <div className="totp-progress">
        <div className="totp-progress-bar" style={{ width: `${progress}%` }} />
      </div>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>{totp.expiresIn}s remaining</span>
    </div>
  );
}

export default function MfaList() {
  const [entries, setEntries] = useState<MfaEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [importUri, setImportUri] = useState('');
  const [importing, setImporting] = useState(false);

  const loadMfa = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.listMfa();
      setEntries(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MFA entries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadMfa();
  }, []);

  const handleImport = async (e: React.FormEvent) => {
    e.preventDefault();
    setImporting(true);
    try {
      await api.importMfaUri(importUri.trim());
      setImportUri('');
      setShowImport(false);
      await loadMfa();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import MFA');
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this MFA entry?')) return;
    try {
      await api.deleteMfa(id);
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
        <strong style={{ fontSize: 15 }}>MFA Codes</strong>
        <button className="btn btn-primary btn-sm" onClick={() => setShowImport((v) => !v)}>
          + Import URI
        </button>
      </div>

      {showImport && (
        <form onSubmit={(e) => void handleImport(e)} style={{ marginBottom: 12 }}>
          <div className="form-group">
            <label htmlFor="import-uri">OTP Auth URI</label>
            <input
              id="import-uri"
              type="text"
              value={importUri}
              onChange={(e) => setImportUri(e.target.value)}
              placeholder="otpauth://totp/..."
              required
            />
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={importing}>
              {importing ? 'Importing...' : 'Import'}
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setShowImport(false)}
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
          <div style={{ fontSize: 32 }}>🔑</div>
          <p>No MFA entries. Import an OTP URI to get started.</p>
        </div>
      )}

      {entries.map((entry) => (
        <div key={entry.id} className="mfa-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                {entry.issuer ?? entry.account_name}
              </div>
              {entry.issuer && (
                <div style={{ fontSize: 12, color: '#64748b' }}>{entry.account_name}</div>
              )}
            </div>
            <button className="btn-icon" onClick={() => void handleDelete(entry.id)}>
              🗑️
            </button>
          </div>
          <TotpDisplay mfaId={entry.id} period={entry.period} />
        </div>
      ))}
    </div>
  );
}
