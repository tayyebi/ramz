use crate::error::{ApiResult, AppError};
use crate::AppState;
use axum::{extract::State, http::HeaderMap, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct SetupRequest {
    pub master_password: String,
}

#[derive(Debug, Deserialize)]
pub struct UnlockRequest {
    pub master_password: String,
}

#[derive(Debug, Deserialize)]
pub struct RefreshRequest {
    pub refresh_token: String,
}

#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub session_id: Uuid,
}

pub async fn setup(
    State(state): State<AppState>,
    Json(req): Json<SetupRequest>,
) -> ApiResult<Json<Value>> {
    tracing::debug!("Setup request received");

    let vault_exists = {
        let vault = state.vault.read().await;
        vault.vault_exists()
    };

    if vault_exists {
        tracing::warn!("Setup rejected: vault already initialised");
        return Err(AppError::Conflict("Vault already initialized".to_string()));
    }

    {
        let mut vault = state.vault.write().await;
        vault
            .initialize(&req.master_password)
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    tracing::info!("Vault initialised successfully");

    let session = state.sessions.create_session();
    let access_token = state
        .auth
        .generate_access_token(session.id)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let (refresh_token, _token_id) = state
        .auth
        .generate_refresh_token()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    tracing::info!(session_id = %session.id, "Setup completed, session created");

    Ok(Json(json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "session_id": session.id
    })))
}

pub async fn unlock(
    State(state): State<AppState>,
    Json(req): Json<UnlockRequest>,
) -> ApiResult<Json<Value>> {
    let identifier = "unlock";

    tracing::debug!("Unlock request received");

    if state.sessions.is_rate_limited(identifier) {
        tracing::warn!("Unlock request rate-limited");
        return Err(AppError::TooManyRequests);
    }

    let vault_exists = {
        let vault = state.vault.read().await;
        vault.vault_exists()
    };

    if !vault_exists {
        return Err(AppError::BadRequest("Vault not initialized".to_string()));
    }

    let success = {
        let mut vault = state.vault.write().await;
        vault
            .unlock(&req.master_password)
            .map_err(|e| AppError::Internal(e.to_string()))?
    };

    if !success {
        tracing::warn!("Unlock failed: invalid master password");
        state.sessions.record_failed_attempt(identifier);
        return Err(AppError::Unauthorized(
            "Invalid master password".to_string(),
        ));
    }

    state.sessions.clear_failed_attempts(identifier);

    let session = state.sessions.create_session();
    let access_token = state
        .auth
        .generate_access_token(session.id)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let (refresh_token, _token_id) = state
        .auth
        .generate_refresh_token()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    tracing::info!(session_id = %session.id, "Vault unlocked, session created");

    Ok(Json(json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "session_id": session.id
    })))
}

pub async fn lock(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    tracing::debug!("Lock request received");

    extract_session_id(&state, &headers)?;

    {
        let mut vault = state.vault.write().await;
        vault.lock();
    }

    state.sessions.invalidate_all_sessions();

    tracing::info!("Vault locked, all sessions invalidated");

    Ok(Json(json!({ "message": "Vault locked" })))
}

pub async fn refresh(
    State(state): State<AppState>,
    Json(req): Json<RefreshRequest>,
) -> ApiResult<Json<Value>> {
    tracing::debug!("Token refresh request received");

    let claims = state.auth.validate_refresh_token(&req.refresh_token)?;

    let session = state.sessions.create_session();
    let access_token = state
        .auth
        .generate_access_token(session.id)
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let (new_refresh_token, _token_id) = state
        .auth
        .generate_refresh_token()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    let _ = claims;

    tracing::debug!(session_id = %session.id, "Token refreshed, new session created");

    Ok(Json(json!({
        "access_token": access_token,
        "refresh_token": new_refresh_token,
        "session_id": session.id
    })))
}

pub fn extract_session_id(state: &AppState, headers: &HeaderMap) -> ApiResult<Uuid> {
    let auth_header = headers
        .get("Authorization")
        .ok_or_else(|| AppError::Unauthorized("Missing Authorization header".to_string()))?;

    let auth_str = auth_header
        .to_str()
        .map_err(|_| AppError::Unauthorized("Invalid Authorization header".to_string()))?;

    let token = auth_str
        .strip_prefix("Bearer ")
        .ok_or_else(|| AppError::Unauthorized("Invalid Authorization format".to_string()))?;

    let claims = state.auth.validate_access_token(token)?;

    if !state.sessions.is_session_valid(&claims.session_id) {
        return Err(AppError::Unauthorized(
            "Session expired or invalid".to_string(),
        ));
    }

    state.sessions.touch_session(&claims.session_id);

    Ok(claims.session_id)
}
