use crate::api::auth::extract_session_id;
use crate::crypto::{decrypt, encrypt};
use crate::error::{ApiResult, AppError};
use crate::models::{CustomField, PasswordEntry};
use crate::AppState;
use axum::{
    extract::{Path, Query, State},
    http::HeaderMap,
    Json,
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
pub struct EntryQuery {
    pub search: Option<String>,
    pub sort: Option<String>,
    pub order: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub folder: Option<String>,
    pub tag: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct CreateEntryRequest {
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub folder: Option<String>,
    pub custom_fields: Option<Vec<CustomFieldRequest>>,
}

#[derive(Debug, Deserialize)]
pub struct CustomFieldRequest {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Deserialize)]
pub struct UpdateEntryRequest {
    pub title: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub folder: Option<String>,
    pub custom_fields: Option<Vec<CustomFieldRequest>>,
}

#[derive(Debug, Serialize)]
pub struct EntryResponse {
    pub id: Uuid,
    pub title: String,
    pub username: String,
    pub password: String,
    pub url: Option<String>,
    pub notes: Option<String>,
    pub tags: Option<Vec<String>>,
    pub folder: Option<String>,
    pub custom_fields: Option<Vec<CustomFieldResponse>>,
    pub created_at: chrono::DateTime<Utc>,
    pub updated_at: chrono::DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct CustomFieldResponse {
    pub name: String,
    pub value: String,
}

fn decrypt_entry(entry: &PasswordEntry, key: &[u8]) -> ApiResult<EntryResponse> {
    let password = String::from_utf8(decrypt(key, &entry.password)?)
        .map_err(|_| AppError::Internal("Invalid password encoding".to_string()))?;

    let notes = if let Some(notes_field) = &entry.notes {
        Some(
            String::from_utf8(decrypt(key, notes_field)?)
                .map_err(|_| AppError::Internal("Invalid notes encoding".to_string()))?,
        )
    } else {
        None
    };

    let custom_fields = if let Some(cf) = &entry.custom_fields {
        let mut decrypted_cf = Vec::new();
        for field in cf {
            let value = String::from_utf8(decrypt(key, &field.value)?)
                .map_err(|_| AppError::Internal("Invalid custom field encoding".to_string()))?;
            decrypted_cf.push(CustomFieldResponse {
                name: field.name.clone(),
                value,
            });
        }
        Some(decrypted_cf)
    } else {
        None
    };

    Ok(EntryResponse {
        id: entry.id,
        title: entry.title.clone(),
        username: entry.username.clone(),
        password,
        url: entry.url.clone(),
        notes,
        tags: entry.tags.clone(),
        folder: entry.folder.clone(),
        custom_fields,
        created_at: entry.created_at,
        updated_at: entry.updated_at,
    })
}

pub async fn list_entries(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EntryQuery>,
) -> ApiResult<Json<Value>> {
    tracing::debug!(?query, "List entries request");

    extract_session_id(&state, &headers)?;

    let vault = state.vault.read().await;
    let pv = vault.get_vault()?;
    let key = vault.get_encryption_key().ok_or(AppError::VaultLocked)?;

    let all_entries: Vec<EntryResponse> = pv
        .password_entries
        .iter()
        .map(|e| decrypt_entry(e, key.as_ref()))
        .collect::<ApiResult<Vec<_>>>()?;

    let total_unfiltered = all_entries.len();

    let mut entries = all_entries;

    // Search filter
    if let Some(search) = &query.search {
        let search_lower = search.to_lowercase();
        entries.retain(|e| {
            e.title.to_lowercase().contains(&search_lower)
                || e.username.to_lowercase().contains(&search_lower)
                || e.url
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&search_lower)
                || e.notes
                    .as_deref()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains(&search_lower)
                || e.tags.as_ref().is_some_and(|tags| {
                    tags.iter()
                        .any(|t| t.to_lowercase().contains(&search_lower))
                })
        });
    }

    // Folder filter
    if let Some(folder) = &query.folder {
        entries.retain(|e| e.folder.as_deref() == Some(folder.as_str()));
    }

    // Tag filter
    if let Some(tag) = &query.tag {
        entries.retain(|e| e.tags.as_ref().is_some_and(|tags| tags.contains(tag)));
    }

    // Sort
    let sort_field = query.sort.as_deref().unwrap_or("title");
    let ascending = query.order.as_deref().unwrap_or("asc") != "desc";

    entries.sort_by(|a, b| {
        let cmp = match sort_field {
            "created_at" => a.created_at.cmp(&b.created_at),
            "updated_at" => a.updated_at.cmp(&b.updated_at),
            _ => a.title.to_lowercase().cmp(&b.title.to_lowercase()),
        };
        if ascending {
            cmp
        } else {
            cmp.reverse()
        }
    });

    let total = total_unfiltered;
    let offset = query.offset.unwrap_or(0);
    let limit = query.limit.unwrap_or(entries.len());

    let paginated: Vec<_> = entries.into_iter().skip(offset).take(limit).collect();

    tracing::debug!(returned = paginated.len(), total = total, "Entries listed");

    Ok(Json(json!({
        "entries": paginated,
        "total": total
    })))
}

pub async fn create_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(req): Json<CreateEntryRequest>,
) -> ApiResult<Json<Value>> {
    tracing::debug!(title = %req.title, "Create entry request");

    extract_session_id(&state, &headers)?;

    let now = Utc::now();

    let entry_id = Uuid::new_v4();

    let (entry, response) = {
        let vault = state.vault.read().await;
        let key = vault.get_encryption_key().ok_or(AppError::VaultLocked)?;

        let password_enc = encrypt(key.as_ref(), req.password.as_bytes())
            .map_err(|e| AppError::Internal(e.to_string()))?;

        let notes_enc = if let Some(notes) = &req.notes {
            Some(
                encrypt(key.as_ref(), notes.as_bytes())
                    .map_err(|e| AppError::Internal(e.to_string()))?,
            )
        } else {
            None
        };

        let custom_fields = if let Some(cf) = &req.custom_fields {
            let mut encrypted_cf = Vec::new();
            for field in cf {
                let value_enc = encrypt(key.as_ref(), field.value.as_bytes())
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                encrypted_cf.push(CustomField {
                    name: field.name.clone(),
                    value: value_enc,
                });
            }
            Some(encrypted_cf)
        } else {
            None
        };

        let entry = PasswordEntry {
            id: entry_id,
            title: req.title.clone(),
            username: req.username.clone(),
            password: password_enc,
            url: req.url.clone(),
            notes: notes_enc,
            tags: req.tags.clone(),
            folder: req.folder.clone(),
            custom_fields,
            created_at: now,
            updated_at: now,
        };

        let response = decrypt_entry(&entry, key.as_ref())?;
        (entry, response)
    };

    {
        let mut vault = state.vault.write().await;
        vault.get_vault_mut()?.password_entries.push(entry);
        vault.get_vault_mut()?.metadata.last_modified = now;
        vault
            .save()
            .map_err(|e| AppError::Internal(e.to_string()))?;
    }

    tracing::info!(entry_id = %entry_id, title = %response.title, "Entry created");

    Ok(Json(json!({ "entry": response })))
}

pub async fn get_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    tracing::debug!(%id, "Get entry request");

    extract_session_id(&state, &headers)?;

    let vault = state.vault.read().await;
    let pv = vault.get_vault()?;
    let key = vault.get_encryption_key().ok_or(AppError::VaultLocked)?;

    let entry = pv
        .password_entries
        .iter()
        .find(|e| e.id == id)
        .ok_or_else(|| AppError::NotFound("Entry not found".to_string()))?;

    let response = decrypt_entry(entry, key.as_ref())?;

    Ok(Json(json!({ "entry": response })))
}

pub async fn update_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateEntryRequest>,
) -> ApiResult<Json<Value>> {
    tracing::debug!(%id, "Update entry request");

    extract_session_id(&state, &headers)?;

    let now = Utc::now();

    let response = {
        let mut vault = state.vault.write().await;
        let key = vault
            .get_encryption_key()
            .ok_or(AppError::VaultLocked)?
            .clone();

        let pv = vault.get_vault_mut()?;

        let entry = pv
            .password_entries
            .iter_mut()
            .find(|e| e.id == id)
            .ok_or_else(|| AppError::NotFound("Entry not found".to_string()))?;

        if let Some(title) = req.title {
            entry.title = title;
        }
        if let Some(username) = req.username {
            entry.username = username;
        }
        if let Some(password) = req.password {
            entry.password = encrypt(key.as_ref(), password.as_bytes())
                .map_err(|e| AppError::Internal(e.to_string()))?;
        }
        entry.url = req.url.or(entry.url.clone());
        if let Some(notes) = req.notes {
            entry.notes = Some(
                encrypt(key.as_ref(), notes.as_bytes())
                    .map_err(|e| AppError::Internal(e.to_string()))?,
            );
        }
        if let Some(tags) = req.tags {
            entry.tags = Some(tags);
        }
        entry.folder = req.folder.or(entry.folder.clone());

        if let Some(cf) = req.custom_fields {
            let mut encrypted_cf = Vec::new();
            for field in cf {
                let value_enc = encrypt(key.as_ref(), field.value.as_bytes())
                    .map_err(|e| AppError::Internal(e.to_string()))?;
                encrypted_cf.push(CustomField {
                    name: field.name,
                    value: value_enc,
                });
            }
            entry.custom_fields = Some(encrypted_cf);
        }

        entry.updated_at = now;

        let response = decrypt_entry(entry, key.as_ref())?;

        pv.metadata.last_modified = now;
        vault
            .save()
            .map_err(|e| AppError::Internal(e.to_string()))?;

        response
    };

    tracing::info!(%id, "Entry updated");

    Ok(Json(json!({ "entry": response })))
}

pub async fn delete_entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    tracing::debug!(%id, "Delete entry request");

    extract_session_id(&state, &headers)?;

    let mut vault = state.vault.write().await;
    let pv = vault.get_vault_mut()?;

    let initial_len = pv.password_entries.len();
    pv.password_entries.retain(|e| e.id != id);

    if pv.password_entries.len() == initial_len {
        return Err(AppError::NotFound("Entry not found".to_string()));
    }

    pv.metadata.last_modified = Utc::now();
    vault
        .save()
        .map_err(|e| AppError::Internal(e.to_string()))?;

    tracing::info!(%id, "Entry deleted");

    Ok(Json(json!({ "message": "Entry deleted" })))
}
