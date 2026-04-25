export function generatePassword(options: {
  length: number;
  uppercase: boolean;
  lowercase: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
}): string {
  let charset = '';
  if (options.lowercase)
    charset += options.excludeAmbiguous
      ? 'abcdefghjkmnpqrstuvwxyz'
      : 'abcdefghijklmnopqrstuvwxyz';
  if (options.uppercase)
    charset += options.excludeAmbiguous
      ? 'ABCDEFGHJKLMNPQRSTUVWXYZ'
      : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (options.digits) charset += options.excludeAmbiguous ? '23456789' : '0123456789';
  if (options.symbols) charset += '!@#$%^&*()-_=+[]{}|;:,.<>?';
  if (!charset) charset = 'abcdefghijklmnopqrstuvwxyz';

  const array = new Uint32Array(options.length);
  crypto.getRandomValues(array);
  return Array.from(array, (x) => charset[x % charset.length]).join('');
}

export function estimateStrength(password: string): { score: number; label: string } {
  let score = 0;
  if (password.length >= 8) score += 20;
  if (password.length >= 12) score += 20;
  if (password.length >= 16) score += 10;
  if (/[a-z]/.test(password)) score += 10;
  if (/[A-Z]/.test(password)) score += 10;
  if (/[0-9]/.test(password)) score += 10;
  if (/[^a-zA-Z0-9]/.test(password)) score += 20;
  score = Math.min(score, 100);
  const label =
    score < 40 ? 'Weak' : score < 70 ? 'Fair' : score < 90 ? 'Strong' : 'Very Strong';
  return { score, label };
}

export function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).catch(() => {
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

export function getDomainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
