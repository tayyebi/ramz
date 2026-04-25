# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, report security issues by emailing the maintainer directly or via [GitHub's private vulnerability reporting](https://github.com/tayyebi/ramz/security/advisories/new).

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested mitigations

You will receive a response within 72 hours.

---

## Threat Model

### In scope
- Confidentiality of stored credentials (passwords, TOTP secrets, notes)
- Integrity of the vault file
- Authentication bypass
- Token forgery or session hijacking
- Local privilege escalation via the server process

### Out of scope
- Attacks requiring physical access to the unlocked machine
- Browser/OS-level vulnerabilities outside the extension
- Social engineering
- Denial of service (the server is intended for local use only)

### Trust boundaries
- The backend runs on `localhost` by default and is not exposed to the network.
- The browser extension communicates only with `http://localhost:8080`.
- The vault file is encrypted at rest; without the master password and salt it is computationally infeasible to recover plaintext.

---

## Cryptographic Design

| Component | Algorithm | Notes |
|---|---|---|
| Key derivation | Argon2id | memory=64 MiB, iterations=3, parallelism=4 (configurable) |
| Sub-key derivation | HKDF-SHA256 | Separate encryption key derived from Argon2id output |
| Vault encryption | AES-256-GCM | 256-bit key, 96-bit nonce (CSPRNG), authentication tag included |
| Password verification | Argon2id (PHC hash) | Stored hash used only for unlock verification |
| JWT signing | HMAC-SHA256 | Secret randomly generated or user-supplied |
| TOTP | HMAC-SHA1/256/512 | Per RFC 6238 |

### Key derivation flow

```
master_password + salt
        │
        ▼
   Argon2id (raw 32 bytes)
        │
        ▼
   HKDF-SHA256 (info = "ramz-encryption-key")
        │
        ▼
   32-byte AES-256 encryption key  (in memory only while unlocked)
```

### Vault file format

```json
{
  "version": 1,
  "salt": "<base64>",
  "password_hash": "<argon2id PHC string>",
  "argon2_params": { "memory_kib": 65536, "iterations": 3, "parallelism": 4 },
  "nonce": "<base64 96-bit>",
  "ciphertext": "<base64 AES-256-GCM ciphertext + 128-bit auth tag>"
}
```

---

## Recommendations

1. **Use a strong, unique master password** (16+ characters, mixed case, digits, symbols).
2. **Enable full-disk encryption** (BitLocker, FileVault, LUKS) on the machine hosting the vault.
3. **Keep the backend on localhost** unless you have a hardened reverse proxy with TLS.
4. **Back up the vault file** regularly and store backups securely (offline or encrypted).
5. **Keep the binary up to date** to receive security patches.
6. **Set a `jwt_secret`** in `config.toml` so sessions survive restarts without being invalidated.
7. **Rotate your master password** periodically using export → re-import with a new password (key rotation feature planned).

---

## Dependency Auditing

The CI pipeline runs `cargo audit` on every build to detect known vulnerabilities in Rust dependencies.
