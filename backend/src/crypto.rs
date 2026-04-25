use crate::config::Argon2Config;
use crate::error::{ApiResult, AppError};
use crate::models::EncryptedField;
use anyhow::Result;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2, Params, Version,
};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use ring::{
    aead::{self, BoundKey, NonceSequence, OpeningKey, SealingKey, UnboundKey, AES_256_GCM},
    error::Unspecified,
    hkdf,
    rand::{SecureRandom, SystemRandom},
};
use zeroize::Zeroizing;

struct OneNonce([u8; 12]);

impl NonceSequence for OneNonce {
    fn advance(&mut self) -> std::result::Result<aead::Nonce, Unspecified> {
        Ok(aead::Nonce::assume_unique_for_key(self.0))
    }
}

pub fn generate_nonce() -> Result<[u8; 12]> {
    let rng = SystemRandom::new();
    let mut nonce = [0u8; 12];
    rng.fill(&mut nonce)
        .map_err(|_| anyhow::anyhow!("Failed to generate nonce"))?;
    Ok(nonce)
}

pub fn generate_salt() -> Result<Vec<u8>> {
    let rng = SystemRandom::new();
    let mut salt = vec![0u8; 32];
    rng.fill(&mut salt)
        .map_err(|_| anyhow::anyhow!("Failed to generate salt"))?;
    Ok(salt)
}

pub fn encrypt(key: &[u8], plaintext: &[u8]) -> Result<EncryptedField> {
    let nonce_bytes = generate_nonce()?;
    let key_bytes: [u8; 32] = key
        .try_into()
        .map_err(|_| anyhow::anyhow!("Key must be 32 bytes"))?;

    let unbound_key = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|_| anyhow::anyhow!("Failed to create encryption key"))?;
    let mut sealing_key = SealingKey::new(unbound_key, OneNonce(nonce_bytes));

    let mut in_out = plaintext.to_vec();
    sealing_key
        .seal_in_place_append_tag(aead::Aad::empty(), &mut in_out)
        .map_err(|_| anyhow::anyhow!("Encryption failed"))?;

    Ok(EncryptedField {
        nonce: BASE64.encode(nonce_bytes),
        ciphertext: BASE64.encode(&in_out),
    })
}

pub fn decrypt(key: &[u8], field: &EncryptedField) -> ApiResult<Vec<u8>> {
    let key_bytes: [u8; 32] = key
        .try_into()
        .map_err(|_| AppError::Internal("Key must be 32 bytes".to_string()))?;

    let nonce_bytes: [u8; 12] = BASE64
        .decode(&field.nonce)
        .map_err(|_| AppError::Internal("Invalid nonce encoding".to_string()))?
        .try_into()
        .map_err(|_| AppError::Internal("Invalid nonce length".to_string()))?;

    let ciphertext = BASE64
        .decode(&field.ciphertext)
        .map_err(|_| AppError::Internal("Invalid ciphertext encoding".to_string()))?;

    let unbound_key = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|_| AppError::Internal("Failed to create decryption key".to_string()))?;
    let mut opening_key = OpeningKey::new(unbound_key, OneNonce(nonce_bytes));

    let mut in_out = ciphertext;
    let plaintext = opening_key
        .open_in_place(aead::Aad::empty(), &mut in_out)
        .map_err(|_| {
            AppError::Unauthorized("Decryption failed - wrong key or corrupted data".to_string())
        })?;

    Ok(plaintext.to_vec())
}

pub fn derive_key(
    password: &str,
    salt: &[u8],
    config: &Argon2Config,
) -> Result<Zeroizing<[u8; 32]>> {
    let params = Params::new(
        config.memory_kib,
        config.iterations,
        config.parallelism,
        Some(32),
    )
    .map_err(|e| anyhow::anyhow!("Invalid Argon2 params: {}", e))?;

    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, Version::V0x13, params);
    let mut output = Zeroizing::new([0u8; 32]);
    argon2
        .hash_password_into(password.as_bytes(), salt, output.as_mut())
        .map_err(|e| anyhow::anyhow!("Key derivation failed: {}", e))?;

    Ok(output)
}

pub fn hkdf_derive(ikm: &[u8], info: &[u8]) -> Result<Zeroizing<[u8; 32]>> {
    let salt = hkdf::Salt::new(hkdf::HKDF_SHA256, b"ramz-hkdf-salt");
    let prk = salt.extract(ikm);
    let info_refs: &[&[u8]] = &[info];
    let okm = prk
        .expand(info_refs, hkdf::HKDF_SHA256)
        .map_err(|_| anyhow::anyhow!("HKDF expand failed"))?;

    let mut output = Zeroizing::new([0u8; 32]);
    okm.fill(output.as_mut())
        .map_err(|_| anyhow::anyhow!("HKDF fill failed"))?;

    Ok(output)
}

pub fn hash_master_password(password: &str, salt: &[u8], config: &Argon2Config) -> Result<String> {
    let params = Params::new(
        config.memory_kib,
        config.iterations,
        config.parallelism,
        Some(32),
    )
    .map_err(|e| anyhow::anyhow!("Invalid Argon2 params: {}", e))?;

    let argon2 = Argon2::new(argon2::Algorithm::Argon2id, Version::V0x13, params);
    let salt_string =
        SaltString::encode_b64(salt).map_err(|e| anyhow::anyhow!("Salt encoding failed: {}", e))?;

    let hash = argon2
        .hash_password(password.as_bytes(), &salt_string)
        .map_err(|e| anyhow::anyhow!("Password hashing failed: {}", e))?;

    Ok(hash.to_string())
}

pub fn verify_master_password(password: &str, hash: &str) -> Result<bool> {
    let parsed_hash =
        PasswordHash::new(hash).map_err(|e| anyhow::anyhow!("Invalid hash: {}", e))?;

    let argon2 = Argon2::default();
    Ok(argon2
        .verify_password(password.as_bytes(), &parsed_hash)
        .is_ok())
}

pub fn get_encryption_key(
    password: &str,
    salt: &[u8],
    config: &Argon2Config,
) -> Result<Zeroizing<[u8; 32]>> {
    let derived = derive_key(password, salt, config)?;
    hkdf_derive(derived.as_ref(), b"ramz-encryption-key")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Argon2Config;

    fn fast_argon2() -> Argon2Config {
        Argon2Config {
            memory_kib: 1024,
            iterations: 1,
            parallelism: 1,
        }
    }

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let key = [0u8; 32];
        let plaintext = b"Hello, World!";
        let encrypted = encrypt(&key, plaintext).unwrap();
        let decrypted = decrypt(&key, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_wrong_key_fails() {
        let key1 = [0u8; 32];
        let key2 = [1u8; 32];
        let plaintext = b"secret data";
        let encrypted = encrypt(&key1, plaintext).unwrap();
        assert!(decrypt(&key2, &encrypted).is_err());
    }

    #[test]
    fn test_unique_nonces() {
        let key = [0u8; 32];
        let plaintext = b"test";
        let e1 = encrypt(&key, plaintext).unwrap();
        let e2 = encrypt(&key, plaintext).unwrap();
        assert_ne!(e1.nonce, e2.nonce);
    }

    #[test]
    fn test_key_derivation_deterministic() {
        let config = fast_argon2();
        let salt = b"test_salt_12345678901234567890123";
        let k1 = derive_key("password", salt, &config).unwrap();
        let k2 = derive_key("password", salt, &config).unwrap();
        assert_eq!(k1.as_ref(), k2.as_ref());
    }

    #[test]
    fn test_key_derivation_salt_sensitive() {
        let config = fast_argon2();
        let salt1 = b"test_salt_12345678901234567890123";
        let salt2 = b"diff_salt_12345678901234567890123";
        let k1 = derive_key("password", salt1, &config).unwrap();
        let k2 = derive_key("password", salt2, &config).unwrap();
        assert_ne!(k1.as_ref(), k2.as_ref());
    }

    #[test]
    fn test_hkdf_distinct_outputs() {
        let ikm = [42u8; 32];
        let o1 = hkdf_derive(&ikm, b"info1").unwrap();
        let o2 = hkdf_derive(&ikm, b"info2").unwrap();
        assert_ne!(o1.as_ref(), o2.as_ref());
    }

    #[test]
    fn test_password_hash_and_verify() {
        let config = fast_argon2();
        let salt = generate_salt().unwrap();
        let hash = hash_master_password("mypassword", &salt, &config).unwrap();
        assert!(verify_master_password("mypassword", &hash).unwrap());
        assert!(!verify_master_password("wrongpassword", &hash).unwrap());
    }

    #[test]
    fn test_encryption_key_derivation() {
        let config = fast_argon2();
        let salt = generate_salt().unwrap();
        let k1 = get_encryption_key("password", &salt, &config).unwrap();
        let k2 = get_encryption_key("password", &salt, &config).unwrap();
        assert_eq!(k1.as_ref(), k2.as_ref());
        let k3 = get_encryption_key("other", &salt, &config).unwrap();
        assert_ne!(k1.as_ref(), k3.as_ref());
    }
}
