use crate::config::AppConfig;
use crate::crypto::{
    decrypt, encrypt, generate_salt, get_encryption_key, hash_master_password,
    verify_master_password,
};
use crate::error::{ApiResult, AppError};
use crate::models::{
    Argon2Params, PlaintextVault, VaultFile, VaultMetadata,
};
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use chrono::Utc;
use std::path::PathBuf;
use zeroize::Zeroizing;

pub struct VaultManager {
    vault_path: PathBuf,
    backup_dir: PathBuf,
    config: AppConfig,
    decrypted_vault: Option<PlaintextVault>,
    encryption_key: Option<Zeroizing<[u8; 32]>>,
}

impl VaultManager {
    pub fn new(config: &AppConfig) -> Result<Self> {
        let data_dir = PathBuf::from(&config.storage.data_dir);
        std::fs::create_dir_all(&data_dir)?;

        let backup_dir = data_dir.join("backups");
        std::fs::create_dir_all(&backup_dir)?;

        let vault_path = data_dir.join("vault.enc");

        Ok(Self {
            vault_path,
            backup_dir,
            config: config.clone(),
            decrypted_vault: None,
            encryption_key: None,
        })
    }

    pub fn vault_exists(&self) -> bool {
        self.vault_path.exists()
    }

    pub fn initialize(&mut self, master_password: &str) -> Result<()> {
        if self.vault_exists() {
            return Err(anyhow::anyhow!("Vault already exists"));
        }

        let salt = generate_salt()?;
        let argon2_config = &self.config.security.argon2;

        let password_hash = hash_master_password(master_password, &salt, argon2_config)?;
        let encryption_key = get_encryption_key(master_password, &salt, argon2_config)?;

        let now = Utc::now();
        let vault = PlaintextVault {
            metadata: VaultMetadata {
                creation_date: now,
                last_modified: now,
                schema_version: 1,
            },
            password_entries: vec![],
            mfa_entries: vec![],
        };

        let vault_json = serde_json::to_vec(&vault)?;
        let encrypted = encrypt(encryption_key.as_ref(), &vault_json)
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        let vault_file = VaultFile {
            version: 1,
            salt: BASE64.encode(&salt),
            password_hash,
            argon2_params: Argon2Params {
                memory_kib: argon2_config.memory_kib,
                iterations: argon2_config.iterations,
                parallelism: argon2_config.parallelism,
            },
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
        };

        let vault_file_json = serde_json::to_string_pretty(&vault_file)?;
        std::fs::write(&self.vault_path, vault_file_json)?;

        self.decrypted_vault = Some(vault);
        self.encryption_key = Some(encryption_key);

        Ok(())
    }

    pub fn unlock(&mut self, master_password: &str) -> Result<bool> {
        if !self.vault_exists() {
            return Err(anyhow::anyhow!("Vault does not exist"));
        }

        let vault_file_json = std::fs::read_to_string(&self.vault_path)?;
        let vault_file: VaultFile = serde_json::from_str(&vault_file_json)?;

        if !verify_master_password(master_password, &vault_file.password_hash)? {
            return Ok(false);
        }

        let salt = BASE64.decode(&vault_file.salt)?;
        let argon2_config = crate::config::Argon2Config {
            memory_kib: vault_file.argon2_params.memory_kib,
            iterations: vault_file.argon2_params.iterations,
            parallelism: vault_file.argon2_params.parallelism,
        };

        let encryption_key = get_encryption_key(master_password, &salt, &argon2_config)?;

        let encrypted_field = crate::models::EncryptedField {
            nonce: vault_file.nonce,
            ciphertext: vault_file.ciphertext,
        };

        let vault_json = decrypt(encryption_key.as_ref(), &encrypted_field)
            .map_err(|_| anyhow::anyhow!("Failed to decrypt vault"))?;

        let vault: PlaintextVault = serde_json::from_slice(&vault_json)?;

        self.decrypted_vault = Some(vault);
        self.encryption_key = Some(encryption_key);

        Ok(true)
    }

    pub fn lock(&mut self) {
        self.decrypted_vault = None;
        self.encryption_key = None;
    }

    pub fn is_unlocked(&self) -> bool {
        self.decrypted_vault.is_some() && self.encryption_key.is_some()
    }

    pub fn get_vault(&self) -> ApiResult<&PlaintextVault> {
        self.decrypted_vault.as_ref().ok_or(AppError::VaultLocked)
    }

    pub fn get_vault_mut(&mut self) -> ApiResult<&mut PlaintextVault> {
        self.decrypted_vault.as_mut().ok_or(AppError::VaultLocked)
    }

    pub fn save(&self) -> Result<()> {
        let vault = self
            .decrypted_vault
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Vault is locked"))?;
        let encryption_key = self
            .encryption_key
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("No encryption key"))?;

        // Create backup if enabled
        if self.config.storage.auto_backup && self.vault_path.exists() {
            self.create_backup()?;
            self.cleanup_old_backups()?;
        }

        // Re-read vault file for params
        let vault_file_json = std::fs::read_to_string(&self.vault_path)?;
        let vault_file: VaultFile = serde_json::from_str(&vault_file_json)?;

        let vault_json = serde_json::to_vec(vault)?;
        let encrypted = encrypt(encryption_key.as_ref(), &vault_json)
            .map_err(|e| anyhow::anyhow!("Encryption failed: {}", e))?;

        let new_vault_file = VaultFile {
            version: vault_file.version,
            salt: vault_file.salt,
            password_hash: vault_file.password_hash,
            argon2_params: vault_file.argon2_params,
            ciphertext: encrypted.ciphertext,
            nonce: encrypted.nonce,
        };

        let new_vault_file_json = serde_json::to_string_pretty(&new_vault_file)?;

        // Atomic write: write to .tmp then rename
        let tmp_path = self.vault_path.with_extension("tmp");
        std::fs::write(&tmp_path, new_vault_file_json)?;
        std::fs::rename(&tmp_path, &self.vault_path)?;

        Ok(())
    }

    fn create_backup(&self) -> Result<()> {
        if !self.vault_path.exists() {
            return Ok(());
        }

        let timestamp = Utc::now().format("%Y%m%d_%H%M%S");
        let backup_name = format!("vault_{}.enc", timestamp);
        let backup_path = self.backup_dir.join(backup_name);

        std::fs::copy(&self.vault_path, &backup_path)?;
        Ok(())
    }

    fn cleanup_old_backups(&self) -> Result<()> {
        let retention_days = self.config.storage.backup_retention_days as i64;
        let cutoff = Utc::now() - chrono::Duration::days(retention_days);

        if let Ok(entries) = std::fs::read_dir(&self.backup_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if path.extension().map(|e| e == "enc").unwrap_or(false) {
                    if let Ok(metadata) = std::fs::metadata(&path) {
                        if let Ok(modified) = metadata.modified() {
                            let modified_dt: chrono::DateTime<Utc> = modified.into();
                            if modified_dt < cutoff {
                                let _ = std::fs::remove_file(&path);
                            }
                        }
                    }
                }
            }
        }

        Ok(())
    }

    pub fn get_encryption_key(&self) -> Option<&Zeroizing<[u8; 32]>> {
        self.encryption_key.as_ref()
    }
}
