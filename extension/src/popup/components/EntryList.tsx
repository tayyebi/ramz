import React from 'react';
import type { PasswordEntry } from '../../shared/types';
import { copyToClipboard } from '../../shared/utils';

interface Props {
  entries: PasswordEntry[];
  onSelect: (id: string) => void;
}

export default function EntryList({ entries, onSelect }: Props) {
  return (
    <div className="entry-list">
      {entries.map((entry) => (
        <div key={entry.id} className="entry-card" onClick={() => onSelect(entry.id)}>
          <div className="entry-avatar">{entry.title.charAt(0).toUpperCase()}</div>
          <div className="entry-info">
            <div className="entry-title">{entry.title}</div>
            <div className="entry-username">{entry.username}</div>
          </div>
          <div className="entry-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="btn-icon"
              title="Copy username"
              onClick={() => copyToClipboard(entry.username)}
            >
              👤
            </button>
            <button
              className="btn-icon"
              title="Copy password"
              onClick={() => copyToClipboard(entry.password)}
            >
              📋
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
