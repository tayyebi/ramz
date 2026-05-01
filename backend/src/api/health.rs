use crate::AppState;
use axum::{extract::State, Json};
use serde_json::{json, Value};

pub async fn health_check(State(state): State<AppState>) -> Json<Value> {
    tracing::trace!("Health check requested");
    let vault = state.vault.read().await;
    Json(json!({
        "status": "ok",
        "version": "0.1.0",
        "vault_initialized": vault.vault_exists(),
        "vault_unlocked": vault.is_unlocked()
    }))
}
