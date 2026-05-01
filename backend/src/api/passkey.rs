use crate::api::auth::extract_session_id;
use crate::crypto::{decrypt, encrypt};
use crate::error::{ApiResult, AppError};
use crate::models::PasskeyEntry;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CreatePasskeyRequest {
    pub rp_id: String,
    pub rp_name: String,
    pub user_id: String,
    pub user_name: String,
    pub user_display_name: String,
    pub credential_id: String,
    pub private_key: String,
    pub sign_count: Option<u32>,
    pub aaguid: Option<String>,
    pub linked_password_entry_id: Option<Uuid>,
}

/// Summary view of a passkey — does not include private key material.
#[derive(Debug, Serialize)]
pub struct PasskeySummary {
    pub id: Uuid,
    pub rp_id: String,
    pub rp_name: String,
    pub user_id: String,
    pub user_name: String,
    pub user_display_name: String,
    pub credential_id: String,
    pub sign_count: u32,
    pub aaguid: Option<String>,
    pub created_at: chrono::DateTime<Utc>,
    pub last_used_at: Option<chrono::DateTime<Utc>>,
    pub linked_password_entry_id: Option<Uuid>,
}

/// Full passkey response including the decrypted private key.
/// Only returned by create and get endpoints.
#[derive(Debug, Serialize)]
pub struct PasskeyResponse {
    pub id: Uuid,
    pub rp_id: String,
    pub rp_name: String,
    pub user_id: String,
    pub user_name: String,
    pub user_display_name: String,
    pub credential_id: String,
    pub private_key: String,
    pub sign_count: u32,
    pub aaguid: Option<String>,
    pub created_at: chrono::DateTime<Utc>,
    pub last_used_at: Option<chrono::DateTime<Utc>>,
    pub linked_password_entry_id: Option<Uuid>,
}

fn entry_to_summary(entry: &PasskeyEntry) -> PasskeySummary {
    PasskeySummary {
        id: entry.id,
        rp_id: entry.rp_id.clone(),
        rp_name: entry.rp_name.clone(),
        user_id: entry.user_id.clone(),
        user_name: entry.user_name.clone(),
        user_display_name: entry.user_display_name.clone(),
        credential_id: entry.credential_id.clone(),
        sign_count: entry.sign_count,
        aaguid: entry.aaguid.clone(),
        created_at: entry.created_at,
        last_used_at: entry.last_used_at,
        linked_password_entry_id: entry.linked_password_entry_id,
    }
}

fn decrypt_passkey(entry: &PasskeyEntry, key: &[u8]) -> ApiResult<PasskeyResponse> {
    let private_key = String::from_utf8(decrypt(key, &entry.private_key)?)
        .map_err(|_| AppError::Internal("Invalid private key encoding".to_string()))?;

    Ok(PasskeyResponse {
        id: entry.id,
        rp_id: entry.rp_id.clone(),
        rp_name: entry.rp_name.clone(),
        user_id: entry.user_id.clone(),
        user_name: entry.user_name.clone(),
        user_display_name: entry.user_display_name.clone(),
        credential_id: entry.credential_id.clone(),
        private_key,
        sign_count: entry.sign_count,
        aaguid: entry.aaguid.clone(),
        created_at: entry.created_at,
        last_used_at: entry.last_used_at,
        linked_password_entry_id: entry.linked_password_entry_id,
    })
}

pub async fn list_passkeys(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    tracing::debug!("List passkey entries request");

    extract_session_id(&state, &headers)?;

    let vault = state.vault.read().await;
    let pv = vault.get_vault()?;

    let entries: Vec<PasskeySummary> = pv.passkey_entries.iter().map(entry_to_summary).collect();

    tracing::debug!(count = entries.len(), "Passkey entries listed");

    Ok(Json(json!({ "entries": entries })))
}

pub async fn create_passkey(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreatePasskeyRequest>,
) -> ApiResult<Json<Value>> {
    tracing::debug!(rp_id = %req.rp_id, user_name = %req.user_name, "Create passkey entry request");

    extract_session_id(&state, &headers)?;

    let now = Utc::now();
    let entry_id = Uuid::new_v4();

    let (entry, response) = {
        let vault = state.vault.read().await;
        let key = vault.get_encryption_key().ok_or(AppError::VaultLocked)?;

        let private_key_enc = encrypt(key.as_ref(), req.private_key.as_bytes())
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let entry = PasskeyEntry {
            id: entry_id,
            rp_id: req.rp_id,
            rp_name: req.rp_name,
            user_id: req.user_id,
            user_name: req.user_name,
            user_display_name: req.user_display_name,
            credential_id: req.credential_id,
            private_key: private_key_enc,
            sign_count: req.sign_count.unwrap_or(0),
            aaguid: req.aaguid,
            created_at: now,
            last_used_at: None,
            linked_password_entry_id: req.linked_password_entry_id,
        };

        let response = decrypt_passkey(&entry, key.as_ref())?;
        (entry, response)
    };

    {
        let mut vault = state.vault.write().await;
        vault.get_vault_mut()?.passkey_entries.push(entry);
        vault.get_vault_mut()?.metadata.last_modified = now;
        vault
            .save()
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    tracing::info!(entry_id = %entry_id, rp_id = %response.rp_id, "Passkey entry created");

    Ok(Json(json!({ "entry": response })))
}

pub async fn get_passkey(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    tracing::debug!(%id, "Get passkey entry request");

    extract_session_id(&state, &headers)?;

    let vault = state.vault.read().await;
    let pv = vault.get_vault()?;
    let key = vault.get_encryption_key().ok_or(AppError::VaultLocked)?;

    let entry = pv
        .passkey_entries
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| AppError::NotFound("Passkey entry not found".to_string()))?;

    let response = decrypt_passkey(entry, key.as_ref())?;

    Ok(Json(json!({ "entry": response })))
}

pub async fn delete_passkey(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    tracing::debug!(%id, "Delete passkey entry request");

    extract_session_id(&state, &headers)?;

    let mut vault = state.vault.write().await;
    let pv = vault.get_vault_mut()?;

    let initial_len = pv.passkey_entries.len();
    pv.passkey_entries.retain(|e| e.id != id);

    if pv.passkey_entries.len() == initial_len {
        return Err(AppError::NotFound("Passkey entry not found".to_string()));
    }

    pv.metadata.last_modified = Utc::now();
    vault
        .save()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    tracing::info!(%id, "Passkey entry deleted");

    Ok(Json(json!({ "message": "Passkey entry deleted" })))
}
