use ramz::config::Argon2Config;
use ramz::crypto::*;

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
    let plaintext = b"Hello, crypto world!";
    let encrypted = encrypt(&key, plaintext).unwrap();
    let decrypted = decrypt(&key, &encrypted).unwrap();
    assert_eq!(decrypted, plaintext);
}

#[test]
fn test_wrong_key_fails() {
    let key1 = [1u8; 32];
    let key2 = [2u8; 32];
    let plaintext = b"secret data";
    let encrypted = encrypt(&key1, plaintext).unwrap();
    assert!(decrypt(&key2, &encrypted).is_err());
}

#[test]
fn test_unique_nonces() {
    let key = [0u8; 32];
    let plaintext = b"same message";
    let e1 = encrypt(&key, plaintext).unwrap();
    let e2 = encrypt(&key, plaintext).unwrap();
    assert_ne!(e1.nonce, e2.nonce);
    // But both should decrypt correctly
    assert_eq!(decrypt(&key, &e1).unwrap(), plaintext);
    assert_eq!(decrypt(&key, &e2).unwrap(), plaintext);
}

#[test]
fn test_key_derivation_deterministic() {
    let config = fast_argon2();
    let salt = b"test_salt_12345678901234567890ab";
    let k1 = derive_key("mypassword", salt, &config).unwrap();
    let k2 = derive_key("mypassword", salt, &config).unwrap();
    assert_eq!(k1.as_ref(), k2.as_ref());
}

#[test]
fn test_key_derivation_salt_sensitive() {
    let config = fast_argon2();
    let salt1 = b"salt_aaaaaaaaaaaaaaaaaaaaaaaaaaa1";
    let salt2 = b"salt_bbbbbbbbbbbbbbbbbbbbbbbbbbb2";
    let k1 = derive_key("mypassword", salt1, &config).unwrap();
    let k2 = derive_key("mypassword", salt2, &config).unwrap();
    assert_ne!(k1.as_ref(), k2.as_ref());
}

#[test]
fn test_hkdf_distinct_outputs() {
    let ikm = [0x42u8; 32];
    let o1 = hkdf_derive(&ikm, b"context-a").unwrap();
    let o2 = hkdf_derive(&ikm, b"context-b").unwrap();
    assert_ne!(o1.as_ref(), o2.as_ref());
}

#[test]
fn test_password_hash_and_verify() {
    let config = fast_argon2();
    let salt = generate_salt().unwrap();
    let hash = hash_master_password("supersecret", &salt, &config).unwrap();
    assert!(verify_master_password("supersecret", &hash).unwrap());
    assert!(!verify_master_password("wrongpassword", &hash).unwrap());
}

#[test]
fn test_encryption_key_derivation() {
    let config = fast_argon2();
    let salt = generate_salt().unwrap();
    let k1 = get_encryption_key("password123", &salt, &config).unwrap();
    let k2 = get_encryption_key("password123", &salt, &config).unwrap();
    assert_eq!(k1.as_ref(), k2.as_ref());

    let k3 = get_encryption_key("different_password", &salt, &config).unwrap();
    assert_ne!(k1.as_ref(), k3.as_ref());
}
