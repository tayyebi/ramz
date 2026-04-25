pub mod api;
pub mod auth;
pub mod config;
pub mod crypto;
pub mod error;
pub mod models;
pub mod session;
pub mod utils;
pub mod vault;

use crate::auth::AuthManager;
use crate::config::AppConfig;
use crate::session::SessionStore;
use crate::vault::VaultManager;

pub type AppState = std::sync::Arc<SharedState>;

pub struct SharedState {
    pub config: AppConfig,
    pub sessions: SessionStore,
    pub vault: tokio::sync::RwLock<VaultManager>,
    pub auth: AuthManager,
}
