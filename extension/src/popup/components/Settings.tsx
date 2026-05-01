import React, { useRef, useState, useEffect } from 'react';
import { api } from '../../shared/api';
import { storage, DEFAULT_SERVER_URL } from '../../shared/storage';
import {
  detectFormat,
  exportKeePassXML,
  parseImport,
  type ImportedEntry,
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
  keepass: 'KeePass / KeePassXC (CSV or XML)',
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

  // Password import state
  const [showImport, setShowImport] = useState(false);
  const [importFormat, setImportFormat] = useState<ImportFormat>('chrome');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // MFA import state
  const [showMfaImport, setShowMfaImport] = useState(false);
  const [mfaUri, setMfaUri] = useState('');
  const [mfaImportFile, setMfaImportFile] = useState<File | null>(null);
  const [mfaImporting, setMfaImporting] = useState(false);
  const [mfaImportResult, setMfaImportResult] = useState('');
  const mfaFileInputRef = useRef<HTMLInputElement>(null);

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

  const handleExportKeePass = async () => {
    setExporting(true);
    setExportMsg('');
    try {
      const entries = await api.listEntries();
      const xmlData = exportKeePassXML(
        entries.map(
          (e): ImportedEntry => ({
            title: e.title,
            username: e.username,
            password: e.password,
            url: e.url,
            notes: e.notes,
          }),
        ),
      );
      const blob = new Blob([xmlData], { type: 'application/xml' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ramz-vault-${new Date().toISOString().slice(0, 10)}.xml`;
      a.click();
      URL.revokeObjectURL(url);
      setExportMsg('KeePass XML exported successfully.');
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
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err) {
      setImportResult(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const handleImportMfaUri = async () => {
    const uri = mfaUri.trim();
    if (!uri) return;
    setMfaImporting(true);
    setMfaImportResult('');
    try {
      await api.importMfaUri(uri);
      setMfaUri('');
      setMfaImportResult('MFA entry imported.');
    } catch (err) {
      setMfaImportResult(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setMfaImporting(false);
    }
  };

  const handleImportMfaFile = async () => {
    if (!mfaImportFile) return;
    setMfaImporting(true);
    setMfaImportResult('');
    try {
      const text = await mfaImportFile.text();
      let uris: string[];
      if (mfaImportFile.name.toLowerCase().endsWith('.json')) {
        const parsed = JSON.parse(text) as unknown;
        if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of OTP URIs');
        uris = parsed.filter((u): u is string => typeof u === 'string');
      } else {
        uris = text
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l.startsWith('otpauth://'));
      }
      if (uris.length === 0) {
        setMfaImportResult('No OTP URIs found in the file.');
        return;
      }
      let imported = 0;
      let failed = 0;
      for (const uri of uris) {
        try {
          await api.importMfaUri(uri);
          imported++;
        } catch {
          failed++;
        }
      }
      setMfaImportResult(
        `Imported ${imported} MFA entr${imported === 1 ? 'y' : 'ies'}` +
          (failed > 0 ? `, ${failed} failed.` : '.'),
      );
      setMfaImportFile(null);
      if (mfaFileInputRef.current) mfaFileInputRef.current.value = '';
    } catch (err) {
      setMfaImportResult(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setMfaImporting(false);
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
        {/* ── Export ── */}
        <button
          className="btn btn-secondary"
          onClick={() => void handleExport()}
          disabled={exporting}
        >
          {exporting ? 'Exporting...' : '⬇️ Export Vault (JSON)'}
        </button>
        <button
          className="btn btn-secondary"
          onClick={() => void handleExportKeePass()}
          disabled={exporting}
        >
          {exporting ? 'Exporting...' : '⬇️ Export as KeePass XML'}
        </button>
        {exportMsg && <p style={{ fontSize: 12, color: '#64748b' }}>{exportMsg}</p>}

        {/* ── Import Passwords ── */}
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
                File (.csv, .json, or .xml)
              </label>
              <input
                id="import-file"
                ref={fileInputRef}
                type="file"
                accept=".csv,.json,.xml,text/csv,application/json,application/xml"
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

        {/* ── Import MFA Codes ── */}
        <button
          className="btn btn-secondary"
          onClick={() => {
            setShowMfaImport((v) => !v);
            setMfaImportResult('');
          }}
        >
          🔑 Import MFA Codes
        </button>

        {showMfaImport && (
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
              <label htmlFor="mfa-uri" style={{ fontSize: 12 }}>
                OTP Auth URI
              </label>
              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                <input
                  id="mfa-uri"
                  type="text"
                  value={mfaUri}
                  onChange={(e) => setMfaUri(e.target.value)}
                  placeholder="otpauth://totp/..."
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
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleImportMfaUri()}
                  disabled={!mfaUri.trim() || mfaImporting}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {mfaImporting ? '…' : 'Import'}
                </button>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label htmlFor="mfa-file" style={{ fontSize: 12 }}>
                Batch import (.txt or .json with OTP URIs)
              </label>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                <input
                  id="mfa-file"
                  ref={mfaFileInputRef}
                  type="file"
                  accept=".txt,.json,text/plain,application/json"
                  onChange={(e) => {
                    setMfaImportFile(e.target.files?.[0] ?? null);
                    setMfaImportResult('');
                  }}
                  style={{ flex: 1, fontSize: 13 }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleImportMfaFile()}
                  disabled={!mfaImportFile || mfaImporting}
                  style={{ whiteSpace: 'nowrap' }}
                >
                  {mfaImporting ? 'Importing…' : 'Import File'}
                </button>
              </div>
            </div>

            {mfaImportResult && (
              <p
                style={{
                  fontSize: 12,
                  color: mfaImportResult.toLowerCase().includes('fail') ? '#ef4444' : '#16a34a',
                  margin: 0,
                }}
              >
                {mfaImportResult}
              </p>
            )}
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
