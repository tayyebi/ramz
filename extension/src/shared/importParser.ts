/** Parsed representation of a single importable credential. */
export interface ImportedEntry {
  title: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
}

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

function parseCSVRow(row: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (inQuotes && row[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = parseCSVRow(lines[0]).map((h) => h.toLowerCase().trim().replace(/^"|"$/g, ''));
  return lines
    .slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const values = parseCSVRow(line);
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => {
        obj[h] = (values[i] ?? '').trim();
      });
      return obj;
    });
}

// ---------------------------------------------------------------------------
// Chrome CSV  (name, url, username, password, note)
// ---------------------------------------------------------------------------
export function parseChrome(text: string): ImportedEntry[] {
  return parseCSV(text)
    .filter((r) => r['password'])
    .map((r) => ({
      title: r['name'] || r['url'] || 'Imported',
      username: r['username'] || '',
      password: r['password'],
      url: r['url'] || undefined,
      notes: r['note'] || r['notes'] || undefined,
    }));
}

// ---------------------------------------------------------------------------
// Firefox CSV  (url, username, password, httpRealm, formActionOrigin, …)
// ---------------------------------------------------------------------------
export function parseFirefox(text: string): ImportedEntry[] {
  return parseCSV(text)
    .filter((r) => r['password'])
    .map((r) => {
      const url = r['url'] || r['formactionorigin'] || '';
      let title = url;
      try {
        title = new URL(url).hostname || url;
      } catch {
        /* keep raw url */
      }
      return {
        title,
        username: r['username'] || '',
        password: r['password'],
        url: url || undefined,
        notes: r['httprealm'] || undefined,
      };
    });
}

// ---------------------------------------------------------------------------
// Bitwarden JSON  (unencrypted export)
// ---------------------------------------------------------------------------
interface BitwardenItem {
  name?: string;
  type?: number;
  notes?: string;
  login?: {
    username?: string;
    password?: string;
    uris?: { uri?: string }[];
  };
}
interface BitwardenExport {
  items?: BitwardenItem[];
}

export function parseBitwarden(text: string): ImportedEntry[] {
  let data: BitwardenExport;
  try {
    data = JSON.parse(text) as BitwardenExport;
  } catch {
    throw new Error('Invalid Bitwarden JSON file');
  }
  if (!Array.isArray(data.items)) throw new Error('Unexpected Bitwarden format');
  return data.items
    .filter((item) => item.type === 1 && item.login?.password)
    .map((item) => ({
      title: item.name || 'Imported',
      username: item.login?.username || '',
      password: item.login?.password ?? '',
      url: item.login?.uris?.[0]?.uri || undefined,
      notes: item.notes || undefined,
    }));
}

// ---------------------------------------------------------------------------
// Passbolt CSV  (name/title, username, password, url/uri, description/notes)
// Header names vary between Passbolt versions; we normalise them.
// ---------------------------------------------------------------------------
export function parsePassbolt(text: string): ImportedEntry[] {
  return parseCSV(text)
    .filter((r) => r['password'] || r['secret'])
    .map((r) => ({
      title: r['name'] || r['title'] || r['url'] || 'Imported',
      username: r['username'] || '',
      password: r['password'] || r['secret'] || '',
      url: r['url'] || r['uri'] || undefined,
      notes: r['description'] || r['notes'] || undefined,
    }));
}

// ---------------------------------------------------------------------------
// Auto-detect format from filename + content
// ---------------------------------------------------------------------------
export type ImportFormat = 'chrome' | 'firefox' | 'bitwarden' | 'passbolt';

export function detectFormat(filename: string, text: string): ImportFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.json')) return 'bitwarden';

  // Only inspect the first (header) line of the CSV for column names
  const firstLine = (text.split(/\r?\n/)[0] ?? '').toLowerCase();
  if (firstLine.includes('httprealm') || firstLine.includes('formactionorigin'))
    return 'firefox';
  if (firstLine.includes(',otp,') || firstLine.includes(',tags,') || firstLine.startsWith('"otp"') || firstLine.startsWith('"tags"'))
    return 'passbolt';
  return 'chrome'; // default CSV fallback
}

export function parseImport(format: ImportFormat, text: string): ImportedEntry[] {
  switch (format) {
    case 'chrome':    return parseChrome(text);
    case 'firefox':   return parseFirefox(text);
    case 'bitwarden': return parseBitwarden(text);
    case 'passbolt':  return parsePassbolt(text);
  }
}
