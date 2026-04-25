use crate::utils::generate_random_secret;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    #[serde(default)]
    pub server: ServerConfig,
    #[serde(default)]
    pub security: SecurityConfig,
    #[serde(default)]
    pub storage: StorageConfig,
    #[serde(default)]
    pub logging: LoggingConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(default = "default_host")]
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    #[serde(default)]
    pub enable_https: bool,
    pub tls_cert_path: Option<String>,
    pub tls_key_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityConfig {
    pub jwt_secret: Option<String>,
    #[serde(default = "default_jwt_expiration_minutes")]
    pub jwt_expiration_minutes: i64,
    #[serde(default = "default_refresh_token_expiration_days")]
    pub refresh_token_expiration_days: i64,
    #[serde(default = "default_inactivity_timeout_minutes")]
    pub inactivity_timeout_minutes: u64,
    #[serde(default = "default_max_failed_attempts")]
    pub max_failed_attempts: u32,
    #[serde(default)]
    pub argon2: Argon2Config,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Argon2Config {
    #[serde(default = "default_memory_kib")]
    pub memory_kib: u32,
    #[serde(default = "default_iterations")]
    pub iterations: u32,
    #[serde(default = "default_parallelism")]
    pub parallelism: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StorageConfig {
    #[serde(default = "default_data_dir")]
    pub data_dir: String,
    #[serde(default = "default_auto_backup")]
    pub auto_backup: bool,
    #[serde(default = "default_backup_retention_days")]
    pub backup_retention_days: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LoggingConfig {
    pub level: Option<String>,
}

fn default_host() -> String { "127.0.0.1".to_string() }
fn default_port() -> u16 { 8080 }
fn default_jwt_expiration_minutes() -> i64 { 30 }
fn default_refresh_token_expiration_days() -> i64 { 7 }
fn default_inactivity_timeout_minutes() -> u64 { 15 }
fn default_max_failed_attempts() -> u32 { 5 }
fn default_memory_kib() -> u32 { 65536 }
fn default_iterations() -> u32 { 3 }
fn default_parallelism() -> u32 { 4 }
fn default_data_dir() -> String { "./data".to_string() }
fn default_auto_backup() -> bool { true }
fn default_backup_retention_days() -> u32 { 30 }

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: default_host(),
            port: default_port(),
            enable_https: false,
            tls_cert_path: None,
            tls_key_path: None,
        }
    }
}

impl Default for SecurityConfig {
    fn default() -> Self {
        Self {
            jwt_secret: None,
            jwt_expiration_minutes: default_jwt_expiration_minutes(),
            refresh_token_expiration_days: default_refresh_token_expiration_days(),
            inactivity_timeout_minutes: default_inactivity_timeout_minutes(),
            max_failed_attempts: default_max_failed_attempts(),
            argon2: Argon2Config::default(),
        }
    }
}

impl Default for Argon2Config {
    fn default() -> Self {
        Self {
            memory_kib: default_memory_kib(),
            iterations: default_iterations(),
            parallelism: default_parallelism(),
        }
    }
}

impl Default for StorageConfig {
    fn default() -> Self {
        Self {
            data_dir: default_data_dir(),
            auto_backup: default_auto_backup(),
            backup_retention_days: default_backup_retention_days(),
        }
    }
}

impl AppConfig {
    pub fn load() -> Result<Self> {
        let config_path = std::env::var("RAMZ_CONFIG")
            .ok()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("config.toml"));

        let mut config: AppConfig = if config_path.exists() {
            let content = std::fs::read_to_string(&config_path)?;
            toml::from_str(&content)?
        } else {
            AppConfig::default()
        };

        // Override with env vars
        if let Ok(host) = std::env::var("RAMZ_HOST") {
            config.server.host = host;
        }
        if let Ok(port) = std::env::var("RAMZ_PORT") {
            config.server.port = port.parse()?;
        }
        if let Ok(secret) = std::env::var("RAMZ_JWT_SECRET") {
            config.security.jwt_secret = Some(secret);
        }
        if let Ok(data_dir) = std::env::var("RAMZ_DATA_DIR") {
            config.storage.data_dir = data_dir;
        }

        // Generate random JWT secret if none provided
        if config.security.jwt_secret.is_none() {
            config.security.jwt_secret = Some(generate_random_secret(32));
        }

        Ok(config)
    }
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            server: ServerConfig::default(),
            security: SecurityConfig::default(),
            storage: StorageConfig::default(),
            logging: LoggingConfig::default(),
        }
    }
}
