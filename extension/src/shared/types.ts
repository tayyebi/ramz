export interface PasswordEntry {
  id: string;
  title: string;
  username: string;
  password: string;
  url?: string;
  notes?: string;
  tags?: string[];
  folder?: string;
  created_at: string;
  updated_at: string;
}

export interface MfaEntry {
  id: string;
  account_name: string;
  issuer?: string;
  algorithm: 'SHA1' | 'SHA256' | 'SHA512';
  digits: number;
  period: number;
  linked_password_entry_id?: string;
  created_at: string;
}

export interface PasskeyEntry {
  id: string;
  rp_id: string;
  rp_name: string;
  user_id: string;
  user_name: string;
  user_display_name: string;
  credential_id: string;
  sign_count: number;
  aaguid?: string;
  created_at: string;
  last_used_at?: string;
  linked_password_entry_id?: string;
}

export interface TotpCode {
  code: string;
  expires_in: number;
}

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  entry_count?: number;
  mfa_count?: number;
  last_modified?: string;
}

export interface ApiError {
  code: string;
  message: string;
}

export type AppView = 'login' | 'dashboard' | 'entry-detail' | 'entry-form' | 'mfa' | 'passkeys' | 'settings' | 'generator';
