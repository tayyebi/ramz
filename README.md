# Ramz — Self-Hosted Password Manager

A secure, self-hosted password manager consisting of:

- **Rust backend** — single binary, AES-256-GCM encrypted vault, Argon2id key derivation
- **Browser extension** — Chrome & Firefox (Manifest V3), React UI
- **Android app** — pure Java WebView client, no Gradle/Maven (inspired by [android-webclient](https://github.com/tayyebi/android-webclient))

<p align="center">
  <img src="https://github.com/user-attachments/assets/18f88b98-1f98-433a-a447-9c20b3923a94" width="392" height="566" alt="Ramz extension screenshot" />
</p>

---

## Table of Contents

1. [Security Model](#security-model)
2. [Installation](#installation)
3. [Configuration](#configuration)
4. [Running the Backend](#running-the-backend)
5. [Loading the Extension](#loading-the-extension)
6. [API Reference](#api-reference)
7. [Backup & Restore](#backup--restore)
8. [Development](#development)

---

## Security Model

- **Zero-knowledge architecture**: the master password is never stored or transmitted. Only its Argon2id-derived key is held in memory while the vault is unlocked.
- **AES-256-GCM** encryption for the vault file. A fresh 96-bit nonce is generated for every write.
- **Argon2id** (memory=64 MiB, iterations=3, parallelism=4 by default) for key derivation and password verification.
- **HKDF-SHA256** to derive separate encryption and HMAC keys from the Argon2id output.
- **JWT** (HS256) access tokens (30-minute expiry) and refresh tokens (7-day expiry).
- **Automatic locking** after configurable inactivity period.
- **Rate limiting** on failed unlock attempts (5 per minute by default).
- **Atomic writes** to prevent vault corruption (write → fsync-like → rename).
- **Automatic backups** before every vault write, with configurable retention.

---

## Installation

### Release artifacts

| # | Artifact | Platform |
|---|----------|----------|
| 1 | `ramz` (Linux x64) | Server |
| 2 | `ramz.exe` (Windows x64) | Server |
| 3 | Chrome extension (`.zip`) | Browser |
| 4 | Firefox extension (`.xpi`) | Browser |
| 5 | `ramz.apk` (Android) | Mobile |

Download the latest release from the [Releases](../../releases) page.

### Build from source

```bash
# Backend (Linux / Windows via cross-compilation)
cd backend
cargo build --release
# Binary: target/release/ramz

# Extension
cd extension
npm install && npm run build
# Output: extension/dist/

# Android (requires JDK 17+ and Android SDK command-line tools, no Gradle)
cd android
./build.sh
# Output: android/bin/ramz.apk
```

---

## Configuration

Copy `backend/config.example.toml` to `config.toml` in your working directory and edit as needed.

Key settings:

| Setting | Default | Description |
|---|---|---|
| `server.host` | `127.0.0.1` | Bind address |
| `server.port` | `8080` | Listen port |
| `security.jwt_secret` | random | JWT signing secret |
| `security.jwt_expiration_minutes` | `30` | Access token lifetime |
| `security.inactivity_timeout_minutes` | `15` | Auto-lock timeout |
| `security.argon2.memory_kib` | `65536` | Argon2id memory (KiB) |
| `storage.data_dir` | `./data` | Vault storage directory |
| `storage.auto_backup` | `true` | Enable automatic backups |
| `logging.level` | `info` | Log verbosity |

Environment variable overrides: `RAMZ_HOST`, `RAMZ_PORT`, `RAMZ_JWT_SECRET`, `RAMZ_DATA_DIR`, `RAMZ_CONFIG` (config file path).

---

## Running the Backend

```bash
# Default (reads config.toml if present, uses defaults otherwise)
./ramz

# Custom config file
RAMZ_CONFIG=/etc/ramz/config.toml ./ramz

# Override settings via environment
RAMZ_PORT=9090 RAMZ_JWT_SECRET=mysecret ./ramz
```

The first request to `POST /api/auth/setup` initializes the vault with your master password.

---

## Loading the Extension

### Chrome / Chromium

1. Build the extension: `cd extension && npm install && npm run build`
2. Open `chrome://extensions`
3. Enable **Developer mode**
4. Click **Load unpacked** → select the `extension/dist` folder

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `extension/dist/manifest.json`

> For permanent Firefox installation, sign the extension via [AMO](https://addons.mozilla.org/) or use a self-signed XPI.

---

## API Reference

All protected endpoints require `Authorization: Bearer <access_token>`.

Error responses follow: `{"error": {"code": "CODE", "message": "human-readable message"}}`

### Authentication

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/health` | Health check (no auth) |
| `POST` | `/api/auth/setup` | Initialize vault (first time only) |
| `POST` | `/api/auth/unlock` | Unlock vault, returns JWT |
| `POST` | `/api/auth/lock` | Lock vault, invalidate sessions |
| `POST` | `/api/auth/refresh` | Refresh access token |

### Password Entries

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/vault/entries` | List entries (supports `?search=`, `?sort=`, `?order=`, `?limit=`, `?offset=`, `?folder=`, `?tag=`) |
| `POST` | `/api/vault/entries` | Create entry |
| `GET` | `/api/vault/entries/:id` | Get entry |
| `PUT` | `/api/vault/entries/:id` | Update entry |
| `DELETE` | `/api/vault/entries/:id` | Delete entry |

### MFA / TOTP

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/vault/mfa` | List MFA entries |
| `POST` | `/api/vault/mfa` | Create MFA entry |
| `DELETE` | `/api/vault/mfa/:id` | Delete MFA entry |
| `GET` | `/api/vault/mfa/:id/totp` | Get current TOTP code |
| `POST` | `/api/vault/mfa/import` | Import from `otpauth://` URI |

### Vault

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/vault/status` | Vault status |
| `GET` | `/api/vault/export` | Export decrypted vault (JSON) |
| `POST` | `/api/vault/import` | Import vault data |

---

## Backup & Restore

### Automatic backups

When `storage.auto_backup = true`, a timestamped copy of the vault is saved to `<data_dir>/backups/vault_YYYYMMDD_HHMMSS.enc` before every write. Old backups beyond `backup_retention_days` are pruned automatically.

### Manual backup

```bash
cp data/vault.enc vault.enc.backup
```

### Restore

```bash
# Stop the server first
cp vault.enc.backup data/vault.enc
# Restart the server
```

---

## Development

```bash
# Backend
cd backend
cargo test          # Run all tests
cargo clippy        # Lint
cargo fmt           # Format

# Extension
cd extension
npm install
npm run build       # Production build
npm run dev         # Watch mode
npm run lint        # TypeScript check

# Android (pure Java, no Gradle/Maven)
cd android
./build.sh          # Build APK with self-signed certificate
./build.sh clean    # Remove build artifacts
```