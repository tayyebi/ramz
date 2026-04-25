use crate::api::auth::extract_session_id;
use crate::crypto::{decrypt, encrypt};
use crate::error::{AppError, ApiResult};
use crate::models::PlaintextVault;
use crate::AppState;
use axum::{
    extract::State,
    http::HeaderMap,
    Json,
};
use serde_json::{json, Value};

pub async fn vault_status(State(state): State<AppState>) -> Json<Value> {
    let vault = state.vault.read().await;
    Json(json!({
        "initialized": vault.vault_exists(),
        "unlocked": vault.is_unlocked()
    }))
}

pub async fn export_vault(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> ApiResult<Json<Value>> {
    extract_session_id(&state, &headers)?;

    let vault = state.vault.read().await;
    let pv = vault.get_vault()?;
    let key = vault.get_encryption_key().ok_or(AppError::VaultLocked)?;

    // Decrypt all entries for export
    let mut decrypted_entries = Vec::new();
    for entry in &pv.password_entries {
        let password = String::from_utf8(decrypt(key.as_ref(), &entry.password)?)
            .map_err(|_| AppError::Internal("Invalid password encoding".to_string()))?;

        let notes = if let Some(notes_field) = &entry.notes {
            Some(
                String::from_utf8(decrypt(key.as_ref(), notes_field)?)
                    .map_err(|_| AppError::Internal("Invalid notes encoding".to_string()))?,
            )
        } else {
            None
        };

        decrypted_entries.push(json!({
            "id": entry.id,
            "title": entry.title,
            "username": entry.username,
            "password": password,
            "url": entry.url,
            "notes": notes,
            "tags": entry.tags,
            "folder": entry.folder,
            "created_at": entry.created_at,
            "updated_at": entry.updated_at,
        }));
    }

    let mut decrypted_mfa = Vec::new();
    for entry in &pv.mfa_entries {
        let secret = String::from_utf8(decrypt(key.as_ref(), &entry.secret)?)
            .map_err(|_| AppError::Internal("Invalid secret encoding".to_string()))?;

        decrypted_mfa.push(json!({
            "id": entry.id,
            "issuer": entry.issuer,
            "account_name": entry.account_name,
            "secret": secret,
            "algorithm": entry.algorithm,
            "digits": entry.digits,
            "period": entry.period,
            "created_at": entry.created_at,
            "linked_password_entry_id": entry.linked_password_entry_id,
        }));
    }

    Ok(Json(json!({
        "format": "ramz",
        "version": 1,
        "metadata": pv.metadata,
        "password_entries": decrypted_entries,
        "mfa_entries": decrypted_mfa,
    })))
}

pub async fn import_vault(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(body): Json<Value>,
) -> ApiResult<Json<Value>> {
    extract_session_id(&state, &headers)?;

    let format = body
        .get("format")
        .and_then(|f| f.as_str())
        .unwrap_or("ramz");

    if format != "ramz" {
        return Err(AppError::BadRequest(format!(
            "Unsupported import format: {}",
            format
        )));
    }

    let password_entries = body
        .get("password_entries")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();

    let mfa_entries = body
        .get("mfa_entries")
        .and_then(|e| e.as_array())
        .cloned()
        .unwrap_or_default();

    let mut imported_count = 0;

    {
        let vault_read = state.vault.read().await;
        let key = vault_read.get_encryption_key().ok_or(AppError::VaultLocked)?.clone();
        drop(vault_read);

        let mut vault = state.vault.write().await;

        for entry_val in &password_entries {
            let title = entry_val.get("title").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let username = entry_val.get("username").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let password = entry_val.get("password").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let url = entry_val.get("url").and_then(|v| v.as_str()).map(|s| s.to_string());
            let notes = entry_val.get("notes").and_then(|v| v.as_str()).map(|s| s.to_string());
            let folder = entry_val.get("folder").and_then(|v| v.as_str()).map(|s| s.to_string());
            let tags = entry_val.get("tags").and_then(|v| v.as_array()).map(|arr| {
                arr.iter().filter_map(|t| t.as_str().map(|s| s.to_string())).collect()
            });

            let now = chrono::Utc::now();
            let password_enc = encrypt(key.as_ref(), password.as_bytes())
                .map_err(|e| AppError::Internal(e.to_string()))?;
            let notes_enc = if let Some(n) = notes {
                Some(encrypt(key.as_ref(), n.as_bytes()).map_err(|e| AppError::Internal(e.to_string()))?)
            } else {
                None
            };

            let entry = crate::models::PasswordEntry {
                id: uuid::Uuid::new_v4(),
                title,
                username,
                password: password_enc,
                url,
                notes: notes_enc,
                tags,
                folder,
                custom_fields: None,
                created_at: now,
                updated_at: now,
            };

            vault.get_vault_mut()?.password_entries.push(entry);
            imported_count += 1;
        }

        for entry_val in &mfa_entries {
            let account_name = entry_val.get("account_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let secret_str = entry_val.get("secret").and_then(|v| v.as_str()).unwrap_or("").to_string();
            let issuer = entry_val.get("issuer").and_then(|v| v.as_str()).map(|s| s.to_string());
            let algorithm_str = entry_val.get("algorithm").and_then(|v| v.as_str()).unwrap_or("SHA1");
            let algorithm: crate::models::TotpAlgorithm = algorithm_str.parse().unwrap_or_default();
            let digits = entry_val.get("digits").and_then(|v| v.as_u64()).unwrap_or(6) as u8;
            let period = entry_val.get("period").and_then(|v| v.as_u64()).unwrap_or(30);

            let now = chrono::Utc::now();
            let secret_enc = encrypt(key.as_ref(), secret_str.as_bytes())
                .map_err(|e| AppError::Internal(e.to_string()))?;

            let entry = crate::models::MfaEntry {
                id: uuid::Uuid::new_v4(),
                issuer,
                account_name,
                secret: secret_enc,
                algorithm,
                digits,
                period,
                created_at: now,
                linked_password_entry_id: None,
            };

            vault.get_vault_mut()?.mfa_entries.push(entry);
            imported_count += 1;
        }

        vault.get_vault_mut()?.metadata.last_modified = chrono::Utc::now();
        vault.save().map_err(|e| AppError::Internal(e.to_string()))?;
    }

    Ok(Json(json!({
        "message": "Import successful",
        "imported_count": imported_count
    })))
}
