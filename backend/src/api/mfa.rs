use crate::api::auth::extract_session_id;
use crate::crypto::{decrypt, encrypt};
use crate::error::{ApiResult, AppError};
use crate::models::{MfaEntry, TotpAlgorithm};
use crate::utils::parse_otpauth_uri;
use crate::AppState;
use axum::{
    extract::{Path, State},
    http::HeaderMap,
    Json,
};
use chrono::Utc;
use data_encoding::BASE32;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use totp_lite::{totp_custom, Sha1, Sha256, Sha512};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct CreateMfaRequest {
    pub issuer: Option<String>,
    pub account_name: String,
    pub secret: String,
    pub algorithm: Option<TotpAlgorithm>,
    pub digits: Option<u8>,
    pub period: Option<u64>,
    pub linked_password_entry_id: Option<Uuid>,
}

#[derive(Debug, Deserialize)]
pub struct ImportMfaUriRequest {
    pub uri: String,
    pub linked_password_entry_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct MfaResponse {
    pub id: Uuid,
    pub issuer: Option<String>,
    pub account_name: String,
    pub secret: String,
    pub algorithm: TotpAlgorithm,
    pub digits: u8,
    pub period: u64,
    pub created_at: chrono::DateTime<Utc>,
    pub linked_password_entry_id: Option<Uuid>,
}

fn decrypt_mfa(entry: &MfaEntry, key: &[u8]) -> ApiResult<MfaResponse> {
    let secret = String::from_utf8(decrypt(key, &entry.secret)?)
        .map_err(|_| AppError::Internal("Invalid secret encoding".to_string()))?;

    Ok(MfaResponse {
        id: entry.id,
        issuer: entry.issuer.clone(),
        account_name: entry.account_name.clone(),
        secret,
        algorithm: entry.algorithm.clone(),
        digits: entry.digits,
        period: entry.period,
        created_at: entry.created_at,
        linked_password_entry_id: entry.linked_password_entry_id,
    })
}

pub async fn list_mfa(State(state): State<AppState>, headers: HeaderMap) -> ApiResult<Json<Value>> {
    tracing::debug!("List MFA entries request");

    extract_session_id(&state, &headers)?;

    let vault = state.vault.read().await;
    let pv = vault.get_vault()?;
    let key = vault.get_encryption_key().ok_or(AppError::VaultLocked)?;

    let entries: Vec<MfaResponse> = pv
        .mfa_entries
        .iter()
        .map(|e| decrypt_mfa(e, key.as_ref()))
        .collect::<ApiResult<Vec<_>>>()?;

    tracing::debug!(count = entries.len(), "MFA entries listed");

    Ok(Json(json!({ "entries": entries })))
}

pub async fn create_mfa(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateMfaRequest>,
) -> ApiResult<Json<Value>> {
    tracing::debug!(account = %req.account_name, "Create MFA entry request");

    extract_session_id(&state, &headers)?;

    let now = Utc::now();
    let entry_id = Uuid::new_v4();

    let (entry, response) = {
        let vault = state.vault.read().await;
        let key = vault.get_encryption_key().ok_or(AppError::VaultLocked)?;

        let secret_enc = encrypt(key.as_ref(), req.secret.as_bytes())
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let entry = MfaEntry {
            id: entry_id,
            issuer: req.issuer,
            account_name: req.account_name,
            secret: secret_enc,
            algorithm: req.algorithm.unwrap_or_default(),
            digits: req.digits.unwrap_or(6),
            period: req.period.unwrap_or(30),
            created_at: now,
            linked_password_entry_id: req.linked_password_entry_id,
        };

        let response = decrypt_mfa(&entry, key.as_ref())?;
        (entry, response)
    };

    {
        let mut vault = state.vault.write().await;
        vault.get_vault_mut()?.mfa_entries.push(entry);
        vault.get_vault_mut()?.metadata.last_modified = now;
        vault
            .save()
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    tracing::info!(entry_id = %entry_id, account = %response.account_name, "MFA entry created");

    Ok(Json(json!({ "entry": response })))
}

pub async fn delete_mfa(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    tracing::debug!(%id, "Delete MFA entry request");

    extract_session_id(&state, &headers)?;

    let mut vault = state.vault.write().await;
    let pv = vault.get_vault_mut()?;

    let initial_len = pv.mfa_entries.len();
    pv.mfa_entries.retain(|e| e.id != id);

    if pv.mfa_entries.len() == initial_len {
        return Err(AppError::NotFound("MFA entry not found".to_string()));
    }

    pv.metadata.last_modified = Utc::now();
    vault
        .save()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    tracing::info!(%id, "MFA entry deleted");

    Ok(Json(json!({ "message": "MFA entry deleted" })))
}

pub async fn generate_totp(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    tracing::trace!(%id, "Generate TOTP request");

    extract_session_id(&state, &headers)?;

    let vault = state.vault.read().await;
    let pv = vault.get_vault()?;
    let key = vault.get_encryption_key().ok_or(AppError::VaultLocked)?;

    let entry = pv
        .mfa_entries
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| AppError::NotFound("MFA entry not found".to_string()))?;

    let secret_str = String::from_utf8(decrypt(key.as_ref(), &entry.secret)?)
        .map_err(|_| AppError::Internal("Invalid secret encoding".to_string()))?;

    let secret_decoded = BASE32
        .decode(secret_str.to_uppercase().as_bytes())
        .map_err(|_| AppError::BadRequest("Invalid base32 secret".to_string()))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();

    let step = now / entry.period;
    let expires_in = entry.period - (now % entry.period);

    let code = match entry.algorithm {
        TotpAlgorithm::Sha1 => {
            totp_custom::<Sha1>(step, entry.digits as u32, &secret_decoded, entry.period)
        }
        TotpAlgorithm::Sha256 => {
            totp_custom::<Sha256>(step, entry.digits as u32, &secret_decoded, entry.period)
        }
        TotpAlgorithm::Sha512 => {
            totp_custom::<Sha512>(step, entry.digits as u32, &secret_decoded, entry.period)
        }
    };

    Ok(Json(json!({
        "code": code,
        "expires_in": expires_in,
        "period": entry.period
    })))
}

pub async fn import_mfa_uri(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<ImportMfaUriRequest>,
) -> ApiResult<Json<Value>> {
    tracing::debug!("Import MFA URI request");

    extract_session_id(&state, &headers)?;

    let params = parse_otpauth_uri(&req.uri)
        .map_err(|e| AppError::BadRequest(format!("Invalid OTP URI: {}", e)))?;

    let algorithm: TotpAlgorithm = params.algorithm.parse().unwrap_or(TotpAlgorithm::Sha1);

    let now = Utc::now();
    let entry_id = Uuid::new_v4();

    let (entry, response) = {
        let vault = state.vault.read().await;
        let key = vault.get_encryption_key().ok_or(AppError::VaultLocked)?;

        let secret_enc = encrypt(key.as_ref(), params.secret.as_bytes())
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let entry = MfaEntry {
            id: entry_id,
            issuer: params.issuer,
            account_name: params.account_name,
            secret: secret_enc,
            algorithm,
            digits: params.digits,
            period: params.period,
            created_at: now,
            linked_password_entry_id: req.linked_password_entry_id,
        };

        let response = decrypt_mfa(&entry, key.as_ref())?;
        (entry, response)
    };

    {
        let mut vault = state.vault.write().await;
        vault.get_vault_mut()?.mfa_entries.push(entry);
        vault.get_vault_mut()?.metadata.last_modified = now;
        vault
            .save()
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    tracing::info!(entry_id = %entry_id, account = %response.account_name, "MFA entry imported from URI");

    Ok(Json(json!({ "entry": response })))
}
