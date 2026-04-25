import React, { useState, useEffect, useCallback } from 'react';
import { generatePassword, estimateStrength, copyToClipboard } from '../../shared/utils';

interface Props {
  onBack: () => void;
}

interface GenOptions {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}

export default function PasswordGenerator({ onBack }: Props) {
  const [options, setOptions] = useState<GenOptions>({
    length: 16,
    uppercase: true,
    lowercase: true,
    digits: true,
    symbols: true,
    excludeAmbiguous: false,
  });
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const generate = useCallback(() => {
    setPassword(generatePassword(options));
  }, [options]);

  useEffect(() => {
    generate();
  }, [generate]);

  const setOption = <K extends keyof GenOptions>(key: K, value: GenOptions[K]) =>
    setOptions((o) => ({ ...o, [key]: value }));

  const handleCopy = () => {
    copyToClipboard(password);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const strength = password ? estimateStrength(password) : null;
  const strengthClass =
    strength?.label === 'Weak'
      ? 'strength-weak'
      : strength?.label === 'Fair'
        ? 'strength-fair'
        : strength?.label === 'Strong'
          ? 'strength-strong'
          : 'strength-very-strong';

  return (
    <div>
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>
          ← Back
        </button>
        <span style={{ fontWeight: 600 }}>Password Generator</span>
      </div>

      <div className="generated-password">{password || '—'}</div>
      {strength && (
        <div style={{ marginBottom: 12 }}>
          <div className={`strength-bar ${strengthClass}`} />
          <span style={{ fontSize: 11, color: '#64748b' }}>
            {strength.label} ({strength.score}/100)
          </span>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-primary btn-sm" onClick={handleCopy}>
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={generate}>
          Regenerate
        </button>
      </div>

      <div className="generator-controls">
        <div className="slider-row">
          <label>Length</label>
          <input
            type="range"
            min={8}
            max={64}
            value={options.length}
            onChange={(e) => setOption('length', Number(e.target.value))}
          />
          <span className="slider-value">{options.length}</span>
        </div>

        {(
          [
            ['uppercase', 'Uppercase (A-Z)'],
            ['lowercase', 'Lowercase (a-z)'],
            ['digits', 'Digits (0-9)'],
            ['symbols', 'Symbols (!@#...)'],
            ['excludeAmbiguous', 'Exclude ambiguous'],
          ] as [keyof GenOptions, string][]
        ).map(([key, label]) => (
          <label key={key} className="checkbox-row">
            <input
              type="checkbox"
              checked={options[key] as boolean}
              onChange={(e) => setOption(key, e.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
    </div>
  );
}
