use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Unauthorized(String),
    #[error("{0}")]
    Forbidden(String),
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Conflict(String),
    #[error("Too many requests")]
    TooManyRequests,
    #[error("{0}")]
    Internal(String),
    #[error("Vault is locked")]
    VaultLocked,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, code, message) = match &self {
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, "UNAUTHORIZED", msg.clone()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, "FORBIDDEN", msg.clone()),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, "NOT_FOUND", msg.clone()),
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, "BAD_REQUEST", msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, "CONFLICT", msg.clone()),
            AppError::TooManyRequests => (
                StatusCode::TOO_MANY_REQUESTS,
                "TOO_MANY_REQUESTS",
                "Too many requests".to_string(),
            ),
            AppError::Internal(msg) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL_ERROR",
                msg.clone(),
            ),
            AppError::VaultLocked => (
                StatusCode::UNAUTHORIZED,
                "VAULT_LOCKED",
                "Vault is locked".to_string(),
            ),
        };

        (
            status,
            Json(json!({
                "error": {
                    "code": code,
                    "message": message
                }
            })),
        )
            .into_response()
    }
}

impl From<anyhow::Error> for AppError {
    fn from(err: anyhow::Error) -> Self {
        AppError::Internal(err.to_string())
    }
}

pub type ApiResult<T> = Result<T, AppError>;
