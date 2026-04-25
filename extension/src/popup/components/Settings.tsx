import React, { useRef, useState, useEffect } from 'react';
import { api } from '../../shared/api';
import { storage, DEFAULT_SERVER_URL } from '../../shared/storage';
import {
  detectFormat,
  parseImport,
  type ImportFormat,
} from '../../shared/importParser';

interface Props {
  onLogout: () => void;
}

const FORMAT_LABELS: Record<ImportFormat, string> = {
  chrome: 'Google Chrome (CSV)',
  firefox: 'Mozilla Firefox (CSV)',
  bitwarden: 'Bitwarden (JSON)',
  passbolt: 'Passbolt (CSV)',
};

export default function Settings({ onLogout }: Props) {
  const [vaultInfo, setVaultInfo] = useState<{
    initialized: boolean;
    unlocked: boolean;
    entry_count?: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [serverUrlSaved, setServerUrlSaved] = useState(false);

  // Import state
  const [showImport, setShowImport] = useState(false);
  const [importFormat, setImportFormat] = useState<ImportFormat>('chrome');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void api.vaultStatus().then(setVaultInfo).catch(() => null);
    void storage.get(['server_url']).then((data) => {
      setServerUrl(data.server_url || DEFAULT_SERVER_URL);
    });
  }, []);

  const handleSaveServerUrl = async () => {
    const trimmed = serverUrl.trim();
    await storage.set({ server_url: trimmed || undefined });
    setServerUrl(trimmed || DEFAULT_SERVER_URL);
    setServerUrlSaved(true);
    setTimeout(() => setServerUrlSaved(false), 2000);
  };

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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setImportFile(file);
    setImportResult('');
    if (file) {
      void file.text().then((text) => {
        setImportFormat(detectFormat(file.name, text));
      });
    }
  };

  const handleImport = async () => {
    if (!importFile) return;
    setImporting(true);
    setImportResult('');
    try {
      const text = await importFile.text();
      const entries = parseImport(importFormat, text);
      if (entries.length === 0) {
        setImportResult('No importable entries found in the file.');
        return;
      }
      let imported = 0;
      let failed = 0;
      const CHUNK = 5;
      for (let i = 0; i < entries.length; i += CHUNK) {
        const results = await Promise.allSettled(
          entries.slice(i, i + CHUNK).map((entry) =>
            api.createEntry({
              title: entry.title,
              username: entry.username,
              password: entry.password,
              url: entry.url,
              notes: entry.notes,
            }),
          ),
        );
        for (const r of results) {
          if (r.status === 'fulfilled') imported++;
          else failed++;
        }
      }
      setImportResult(
        `Imported ${imported} entr${imported === 1 ? 'y' : 'ies'}` +
          (failed > 0 ? `, ${failed} failed.` : '.'),
      );
      // Reset file input
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Settings</h2>

      <div className="detail-field">
        <label>Backend URL</label>
        <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
          <input
            type="text"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder={DEFAULT_SERVER_URL}
            style={{
              flex: 1,
              fontSize: 13,
              padding: '4px 8px',
              border: '1px solid #cbd5e1',
              borderRadius: 4,
              fontFamily: 'inherit',
            }}
          />
          <button
            className="btn btn-secondary"
            onClick={() => void handleSaveServerUrl()}
            style={{ whiteSpace: 'nowrap' }}
          >
            {serverUrlSaved ? '✓ Saved' : 'Save'}
          </button>
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
        {exportMsg && <p style={{ fontSize: 12, color: '#64748b' }}>{exportMsg}</p>}

        {/* ── Import ── */}
        <button
          className="btn btn-secondary"
          onClick={() => {
            setShowImport((v) => !v);
            setImportResult('');
          }}
        >
          ⬆️ Import Passwords
        </button>

        {showImport && (
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 12,
              background: '#f8fafc',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="import-format" style={{ fontSize: 12 }}>
                Source
              </label>
              <select
                id="import-format"
                value={importFormat}
                onChange={(e) => setImportFormat(e.target.value as ImportFormat)}
                style={{
                  width: '100%',
                  padding: '6px 8px',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  fontSize: 13,
                  marginTop: 4,
                }}
              >
                {(Object.keys(FORMAT_LABELS) as ImportFormat[]).map((f) => (
                  <option key={f} value={f}>
                    {FORMAT_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="import-file" style={{ fontSize: 12 }}>
                File (.csv or .json)
              </label>
              <input
                id="import-file"
                ref={fileInputRef}
                type="file"
                accept=".csv,.json,text/csv,application/json"
                onChange={handleFileChange}
                style={{ marginTop: 4, fontSize: 13, width: '100%' }}
              />
            </div>

            {importResult && (
              <p
                style={{
                  fontSize: 12,
                  color: importResult.toLowerCase().includes('fail') ? '#ef4444' : '#16a34a',
                  margin: 0,
                }}
              >
                {importResult}
              </p>
            )}

            <button
              className="btn btn-primary btn-sm"
              onClick={() => void handleImport()}
              disabled={!importFile || importing}
            >
              {importing ? 'Importing…' : `Import from ${FORMAT_LABELS[importFormat]}`}
            </button>
          </div>
        )}

        <button
          className="btn btn-danger"
          onClick={() =>
            void (async () => {
              try {
                await api.lock();
              } catch {
                /* ignore */
              }
              await storage.clear();
              onLogout();
            })()
          }
        >
          🔒 Lock &amp; Sign Out
        </button>
      </div>
    </div>
  );
}
