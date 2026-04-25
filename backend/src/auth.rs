use crate::config::AppConfig;
use crate::error::{AppError, ApiResult};
use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use jsonwebtoken::{decode, encode, DecodingKey, EncodingKey, Header, Validation};
use ring::rand::{SecureRandom, SystemRandom};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: String,
    pub exp: i64,
    pub iat: i64,
    pub session_id: Uuid,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RefreshClaims {
    pub sub: String,
    pub exp: i64,
    pub iat: i64,
    pub token_id: Uuid,
}

pub struct AuthManager {
    encoding_key: EncodingKey,
    decoding_key: DecodingKey,
    jwt_expiration_minutes: i64,
    refresh_token_expiration_days: i64,
}

impl AuthManager {
    pub fn new(config: &AppConfig) -> Result<Self> {
        let secret = config
            .security
            .jwt_secret
            .as_deref()
            .unwrap_or("default-secret");

        Ok(Self {
            encoding_key: EncodingKey::from_secret(secret.as_bytes()),
            decoding_key: DecodingKey::from_secret(secret.as_bytes()),
            jwt_expiration_minutes: config.security.jwt_expiration_minutes,
            refresh_token_expiration_days: config.security.refresh_token_expiration_days,
        })
    }

    pub fn generate_access_token(&self, session_id: Uuid) -> Result<String> {
        let now = chrono::Utc::now().timestamp();
        let exp = now + self.jwt_expiration_minutes * 60;

        let claims = Claims {
            sub: "ramz".to_string(),
            exp,
            iat: now,
            session_id,
        };

        let token = encode(&Header::default(), &claims, &self.encoding_key)?;
        Ok(token)
    }

    pub fn generate_refresh_token(&self) -> Result<(String, Uuid)> {
        let rng = SystemRandom::new();
        let mut token_bytes = [0u8; 32];
        rng.fill(&mut token_bytes)
            .map_err(|_| anyhow::anyhow!("Failed to generate refresh token"))?;

        let token_id = Uuid::new_v4();
        let now = chrono::Utc::now().timestamp();
        let exp = now + self.refresh_token_expiration_days * 86400;

        let claims = RefreshClaims {
            sub: "ramz".to_string(),
            exp,
            iat: now,
            token_id,
        };

        let token = encode(&Header::default(), &claims, &self.encoding_key)?;
        Ok((token, token_id))
    }

    pub fn validate_access_token(&self, token: &str) -> ApiResult<Claims> {
        let mut validation = Validation::default();
        validation.validate_exp = true;

        decode::<Claims>(token, &self.decoding_key, &validation)
            .map(|data| data.claims)
            .map_err(|e| AppError::Unauthorized(format!("Invalid token: {}", e)))
    }

    pub fn validate_refresh_token(&self, token: &str) -> ApiResult<RefreshClaims> {
        let mut validation = Validation::default();
        validation.validate_exp = true;

        decode::<RefreshClaims>(token, &self.decoding_key, &validation)
            .map(|data| data.claims)
            .map_err(|e| AppError::Unauthorized(format!("Invalid refresh token: {}", e)))
    }
}

pub fn _generate_random_bytes(len: usize) -> Result<Vec<u8>> {
    let rng = SystemRandom::new();
    let mut bytes = vec![0u8; len];
    rng.fill(&mut bytes)
        .map_err(|_| anyhow::anyhow!("Failed to generate random bytes"))?;
    Ok(bytes)
}

pub fn _encode_base64(bytes: &[u8]) -> String {
    BASE64.encode(bytes)
}
