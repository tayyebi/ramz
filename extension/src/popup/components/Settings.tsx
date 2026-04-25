import React, { useState, useEffect } from 'react';
import { api } from '../../shared/api';
import { storage } from '../../shared/storage';

interface Props {
  onLogout: () => void;
}

export default function Settings({ onLogout }: Props) {
  const [vaultInfo, setVaultInfo] = useState<{
    initialized: boolean;
    unlocked: boolean;
    entry_count?: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');

  useEffect(() => {
    void api.vaultStatus().then(setVaultInfo).catch(() => null);
  }, []);

  const handleExport = async () => {
    setExporting(true);
    setExportMsg('');
    try {
      const data = await api.exportVault();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ramz-vault-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg('Vault exported successfully.');
    } catch (err) {
      setExportMsg(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Settings</h2>

      <div className="detail-field">
        <label>Backend URL</label>
        <div className="detail-field-value">
          <span style={{ fontFamily: 'inherit', fontSize: 13 }}>http://localhost:8080</span>
        </div>
      </div>

      {vaultInfo && (
        <div className="detail-field">
          <label>Vault Status</label>
          <div className="detail-field-value">
            <span style={{ fontFamily: 'inherit', fontSize: 13 }}>
              {vaultInfo.unlocked ? '🔓 Unlocked' : '🔒 Locked'} ·{' '}
              {vaultInfo.entry_count ?? 0} entries
            </span>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 16 }}>
        <button
          className="btn btn-secondary"
          onClick={() => void handleExport()}
          disabled={exporting}
        >
          {exporting ? 'Exporting...' : '⬇️ Export Vault'}
        </button>
        {exportMsg && (
          <p style={{ fontSize: 12, color: '#64748b' }}>{exportMsg}</p>
        )}
        <button
          className="btn btn-danger"
          onClick={() => void (async () => {
            try { await api.lock(); } catch { /* ignore */ }
            await storage.clear();
            onLogout();
          })()}
        >
          🔒 Lock &amp; Sign Out
        </button>
      </div>
    </div>
  );
}
