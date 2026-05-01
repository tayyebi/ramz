use crate::AppState;
use axum::{
    http::{header, HeaderValue},
    routing::{delete, get, post, put},
    Router,
};
use tower_http::{
    cors::{Any, CorsLayer},
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};

pub mod auth;
pub mod entries;
pub mod health;
pub mod mfa;
pub mod passkey;
pub mod vault;

pub fn build_router(state: AppState) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    Router::new()
        // Health
        .route("/api/health", get(health::health_check))
        // Auth
        .route("/api/auth/setup", post(auth::setup))
        .route("/api/auth/unlock", post(auth::unlock))
        .route("/api/auth/lock", post(auth::lock))
        .route("/api/auth/refresh", post(auth::refresh))
        // Entries
        .route("/api/vault/entries", get(entries::list_entries))
        .route("/api/vault/entries", post(entries::create_entry))
        .route("/api/vault/entries/:id", get(entries::get_entry))
        .route("/api/vault/entries/:id", put(entries::update_entry))
        .route("/api/vault/entries/:id", delete(entries::delete_entry))
        // MFA
        .route("/api/vault/mfa", get(mfa::list_mfa))
        .route("/api/vault/mfa", post(mfa::create_mfa))
        .route("/api/vault/mfa/:id", delete(mfa::delete_mfa))
        .route("/api/vault/mfa/:id/totp", get(mfa::generate_totp))
        .route("/api/vault/mfa/import", post(mfa::import_mfa_uri))
        // Passkeys
        .route("/api/vault/passkeys", get(passkey::list_passkeys))
        .route("/api/vault/passkeys", post(passkey::create_passkey))
        .route("/api/vault/passkeys/:id", get(passkey::get_passkey))
        .route("/api/vault/passkeys/:id", delete(passkey::delete_passkey))
        // Vault
        .route("/api/vault/export", get(vault::export_vault))
        .route("/api/vault/import", post(vault::import_vault))
        .route("/api/vault/status", get(vault::vault_status))
        .layer(SetResponseHeaderLayer::overriding(
            header::HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ))
        .layer(TraceLayer::new_for_http())
        .layer(cors)
        .with_state(state)
}
