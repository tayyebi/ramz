use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptedField {
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaintextVault {
    pub metadata: VaultMetadata,
    pub password_entries: Vec<PasswordEntry>,
    pub mfa_entries: Vec<MfaEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultMetadata {
    pub creation_date: DateTime<Utc>,
    pub last_modified: DateTime<Utc>,
    pub schema_version: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PasswordEntry {
    pub id: Uuid,
    pub title: String,
    pub username: String,
    pub password: EncryptedField,
    pub url: Option<String>,
    pub notes: Option<EncryptedField>,
    pub tags: Option<Vec<String>>,
    pub folder: Option<String>,
    pub custom_fields: Option<Vec<CustomField>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CustomField {
    pub name: String,
    pub value: EncryptedField,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MfaEntry {
    pub id: Uuid,
    pub issuer: Option<String>,
    pub account_name: String,
    pub secret: EncryptedField,
    pub algorithm: TotpAlgorithm,
    pub digits: u8,
    pub period: u64,
    pub created_at: DateTime<Utc>,
    pub linked_password_entry_id: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum TotpAlgorithm {
    Sha1,
    Sha256,
    Sha512,
}

impl Default for TotpAlgorithm {
    fn default() -> Self {
        TotpAlgorithm::Sha1
    }
}

impl FromStr for TotpAlgorithm {
    type Err = anyhow::Error;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_uppercase().as_str() {
            "SHA1" => Ok(TotpAlgorithm::Sha1),
            "SHA256" => Ok(TotpAlgorithm::Sha256),
            "SHA512" => Ok(TotpAlgorithm::Sha512),
            _ => Err(anyhow::anyhow!("Unknown TOTP algorithm: {}", s)),
        }
    }
}

impl std::fmt::Display for TotpAlgorithm {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TotpAlgorithm::Sha1 => write!(f, "SHA1"),
            TotpAlgorithm::Sha256 => write!(f, "SHA256"),
            TotpAlgorithm::Sha512 => write!(f, "SHA512"),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultFile {
    pub version: u32,
    pub salt: String,
    pub password_hash: String,
    pub argon2_params: Argon2Params,
    pub ciphertext: String,
    pub nonce: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Argon2Params {
    pub memory_kib: u32,
    pub iterations: u32,
    pub parallelism: u32,
}
