import React, { useState, useEffect } from 'react';
import type { PasswordEntry } from '../../shared/types';
import { api } from '../../shared/api';
import { generatePassword, estimateStrength } from '../../shared/utils';

interface Props {
  entryId: string | null;
  isNew: boolean;
  onBack: () => void;
  onSaved: () => void;
}

type FormData = {
  title: string;
  username: string;
  password: string;
  url: string;
  notes: string;
  tags: string;
};

export default function EntryForm({ entryId, isNew, onBack, onSaved }: Props) {
  const [form, setForm] = useState<FormData>({
    title: '',
    username: '',
    password: '',
    url: '',
    notes: '',
    tags: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isNew && entryId) {
      void (async () => {
        try {
          const entry = await api.getEntry(entryId);
          setForm({
            title: entry.title,
            username: entry.username,
            password: entry.password,
            url: entry.url ?? '',
            notes: entry.notes ?? '',
            tags: entry.tags?.join(', ') ?? '',
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load entry');
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [isNew, entryId]);

  const handleChange = (field: keyof FormData) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleGenerate = () => {
    const pw = generatePassword({
      length: 16,
      uppercase: true,
      lowercase: true,
      digits: true,
      symbols: true,
      excludeAmbiguous: false,
    });
    setForm((f) => ({ ...f, password: pw }));
    setShowPassword(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    setSaving(true);
    setError('');

    const payload: Omit<PasswordEntry, 'id' | 'created_at' | 'updated_at'> = {
      title: form.title.trim(),
      username: form.username.trim(),
      password: form.password,
      url: form.url.trim() || undefined,
      notes: form.notes.trim() || undefined,
      tags: form.tags
        ? form.tags
            .split(',')
            .map((t) => t.trim())
            .filter(Boolean)
        : undefined,
    };

    try {
      if (isNew) {
        await api.createEntry(payload);
      } else if (entryId) {
        await api.updateEntry(entryId, payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save entry');
    } finally {
      setSaving(false);
    }
  };

  const strength = form.password ? estimateStrength(form.password) : null;
  const strengthClass =
    strength?.label === 'Weak'
      ? 'strength-weak'
      : strength?.label === 'Fair'
        ? 'strength-fair'
        : strength?.label === 'Strong'
          ? 'strength-strong'
          : 'strength-very-strong';

  if (loading) return <p style={{ textAlign: 'center', color: '#64748b' }}>Loading...</p>;

  return (
    <div>
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>
          ← Back
        </button>
        <span style={{ fontWeight: 600 }}>{isNew ? 'New Entry' : 'Edit Entry'}</span>
      </div>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <div className="form-group">
          <label htmlFor="title">Title *</label>
          <input
            id="title"
            type="text"
            value={form.title}
            onChange={handleChange('title')}
            placeholder="e.g. Gmail"
            required
          />
        </div>
        <div className="form-group">
          <label htmlFor="username">Username / Email</label>
          <input
            id="username"
            type="text"
            value={form.username}
            onChange={handleChange('username')}
            placeholder="user@example.com"
          />
        </div>
        <div className="form-group">
          <label htmlFor="password">Password</label>
          <div className="password-field">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={handleChange('password')}
              placeholder="Password"
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? '🙈' : '👁️'}
            </button>
          </div>
          {strength && (
            <div>
              <div className={`strength-bar ${strengthClass}`} />
              <span style={{ fontSize: 11, color: '#64748b' }}>{strength.label}</span>
            </div>
          )}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 6 }}
            onClick={handleGenerate}
          >
            Generate
          </button>
        </div>
        <div className="form-group">
          <label htmlFor="url">URL</label>
          <input
            id="url"
            type="url"
            value={form.url}
            onChange={handleChange('url')}
            placeholder="https://example.com"
          />
        </div>
        <div className="form-group">
          <label htmlFor="notes">Notes</label>
          <textarea
            id="notes"
            value={form.notes}
            onChange={handleChange('notes')}
            placeholder="Optional notes..."
          />
        </div>
        <div className="form-group">
          <label htmlFor="tags">Tags</label>
          <input
            id="tags"
            type="text"
            value={form.tags}
            onChange={handleChange('tags')}
            placeholder="work, personal (comma-separated)"
          />
        </div>
        {error && <p className="error-msg">{error}</p>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
