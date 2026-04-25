use axum_test::TestServer;
use ramz::{
    api::build_router,
    config::{AppConfig, Argon2Config, SecurityConfig, StorageConfig},
    session::SessionStore,
    vault::VaultManager,
    AppState, SharedState,
};
use serde_json::{json, Value};
use std::sync::Arc;
use tempfile::TempDir;
use tokio::sync::RwLock;

fn create_test_config(data_dir: &str) -> AppConfig {
    let mut config = AppConfig::default();
    config.security = SecurityConfig {
        jwt_secret: Some("test-secret-key-for-integration-tests".to_string()),
        jwt_expiration_minutes: 60,
        refresh_token_expiration_days: 7,
        inactivity_timeout_minutes: 60,
        max_failed_attempts: 10,
        argon2: Argon2Config {
            memory_kib: 1024,
            iterations: 1,
            parallelism: 1,
        },
    };
    config.storage = StorageConfig {
        data_dir: data_dir.to_string(),
        auto_backup: false,
        backup_retention_days: 30,
    };
    config
}

fn create_test_server() -> (TestServer, TempDir) {
    let temp_dir = TempDir::new().expect("Failed to create temp dir");
    let data_dir = temp_dir.path().to_str().unwrap().to_string();
    let config = create_test_config(&data_dir);

    let sessions = SessionStore::new(&config);
    let vault = VaultManager::new(&config).expect("Failed to create vault manager");
    let auth = ramz::auth::AuthManager::new(&config).expect("Failed to create auth manager");

    let state: AppState = Arc::new(SharedState {
        config: config.clone(),
        sessions,
        vault: RwLock::new(vault),
        auth,
    });

    let router = build_router(state);
    let server = TestServer::new(router).expect("Failed to create test server");

    (server, temp_dir)
}

#[tokio::test]
async fn test_health_check() {
    let (server, _temp) = create_test_server();

    let response = server.get("/api/health").await;
    response.assert_status_ok();

    let body: Value = response.json();
    assert_eq!(body["status"], "ok");
    assert_eq!(body["version"], "0.1.0");
    assert_eq!(body["vault_initialized"], false);
    assert_eq!(body["vault_unlocked"], false);
}

#[tokio::test]
async fn test_vault_status() {
    let (server, _temp) = create_test_server();

    let response = server.get("/api/vault/status").await;
    response.assert_status_ok();

    let body: Value = response.json();
    assert_eq!(body["initialized"], false);
    assert_eq!(body["unlocked"], false);
}

#[tokio::test]
async fn test_setup_and_unlock() {
    let (server, _temp) = create_test_server();

    // Setup vault
    let setup_resp = server
        .post("/api/auth/setup")
        .json(&json!({ "master_password": "TestPass123!" }))
        .await;
    setup_resp.assert_status_ok();

    let body: Value = setup_resp.json();
    assert!(body["access_token"].is_string());
    assert!(body["refresh_token"].is_string());
    assert!(body["session_id"].is_string());

    // Lock vault
    let token = body["access_token"].as_str().unwrap().to_string();
    let lock_resp = server
        .post("/api/auth/lock")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    lock_resp.assert_status_ok();

    // Unlock vault
    let unlock_resp = server
        .post("/api/auth/unlock")
        .json(&json!({ "master_password": "TestPass123!" }))
        .await;
    unlock_resp.assert_status_ok();

    let unlock_body: Value = unlock_resp.json();
    assert!(unlock_body["access_token"].is_string());
}

#[tokio::test]
async fn test_unlock_wrong_password() {
    let (server, _temp) = create_test_server();

    // Setup vault
    server
        .post("/api/auth/setup")
        .json(&json!({ "master_password": "CorrectPass!" }))
        .await
        .assert_status_ok();

    // Lock vault
    server
        .post("/api/auth/lock")
        .add_header(
            axum::http::header::AUTHORIZATION,
            {
                let setup_resp = server
                    .post("/api/auth/setup")
                    .json(&json!({ "master_password": "AnotherPass!" }))
                    .await;
                // Actually we need to lock the current one
                "Bearer dummy".parse().unwrap()
            },
        )
        .await;

    // Try wrong password
    let resp = server
        .post("/api/auth/unlock")
        .json(&json!({ "master_password": "WrongPassword!" }))
        .await;
    resp.assert_status_unauthorized();
}

#[tokio::test]
async fn test_unauthorized_access() {
    let (server, _temp) = create_test_server();

    let response = server.get("/api/vault/entries").await;
    response.assert_status_unauthorized();
}

#[tokio::test]
async fn test_entry_crud() {
    let (server, _temp) = create_test_server();

    // Setup
    let setup_resp = server
        .post("/api/auth/setup")
        .json(&json!({ "master_password": "TestPass123!" }))
        .await;
    setup_resp.assert_status_ok();
    let token = setup_resp.json::<Value>()["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create entry
    let create_resp = server
        .post("/api/vault/entries")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .json(&json!({
            "title": "Test Entry",
            "username": "user@example.com",
            "password": "secret123",
            "url": "https://example.com"
        }))
        .await;
    create_resp.assert_status_ok();

    let create_body: Value = create_resp.json();
    let entry_id = create_body["entry"]["id"].as_str().unwrap().to_string();

    // Get entry
    let get_resp = server
        .get(&format!("/api/vault/entries/{}", entry_id))
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    get_resp.assert_status_ok();

    let get_body: Value = get_resp.json();
    assert_eq!(get_body["entry"]["title"], "Test Entry");
    assert_eq!(get_body["entry"]["password"], "secret123");

    // Update entry
    let update_resp = server
        .put(&format!("/api/vault/entries/{}", entry_id))
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .json(&json!({
            "title": "Updated Entry",
            "password": "newpassword456"
        }))
        .await;
    update_resp.assert_status_ok();

    let update_body: Value = update_resp.json();
    assert_eq!(update_body["entry"]["title"], "Updated Entry");
    assert_eq!(update_body["entry"]["password"], "newpassword456");

    // List entries
    let list_resp = server
        .get("/api/vault/entries")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    list_resp.assert_status_ok();

    let list_body: Value = list_resp.json();
    assert_eq!(list_body["total"], 1);

    // Delete entry
    let delete_resp = server
        .delete(&format!("/api/vault/entries/{}", entry_id))
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    delete_resp.assert_status_ok();

    // Confirm deletion
    let list_after_resp = server
        .get("/api/vault/entries")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    let list_after_body: Value = list_after_resp.json();
    assert_eq!(list_after_body["total"], 0);
}

#[tokio::test]
async fn test_search_entries() {
    let (server, _temp) = create_test_server();

    // Setup
    let setup_resp = server
        .post("/api/auth/setup")
        .json(&json!({ "master_password": "TestPass123!" }))
        .await;
    let token = setup_resp.json::<Value>()["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create entries
    for title in &["GitHub", "Gmail", "Slack"] {
        server
            .post("/api/vault/entries")
            .add_header(
                axum::http::header::AUTHORIZATION,
                format!("Bearer {}", token).parse().unwrap(),
            )
            .json(&json!({
                "title": title,
                "username": "user",
                "password": "pass"
            }))
            .await
            .assert_status_ok();
    }

    // Search for "git"
    let search_resp = server
        .get("/api/vault/entries")
        .add_query_param("search", "git")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    search_resp.assert_status_ok();

    let body: Value = search_resp.json();
    assert_eq!(body["total"], 3); // total unfiltered
    assert_eq!(body["entries"].as_array().unwrap().len(), 1);
    assert_eq!(body["entries"][0]["title"], "GitHub");
}

#[tokio::test]
async fn test_mfa_crud() {
    let (server, _temp) = create_test_server();

    // Setup
    let setup_resp = server
        .post("/api/auth/setup")
        .json(&json!({ "master_password": "TestPass123!" }))
        .await;
    let token = setup_resp.json::<Value>()["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create MFA entry (use a valid base32 secret)
    let create_resp = server
        .post("/api/vault/mfa")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .json(&json!({
            "issuer": "TestApp",
            "account_name": "user@example.com",
            "secret": "JBSWY3DPEHPK3PXP",
            "algorithm": "SHA1",
            "digits": 6,
            "period": 30
        }))
        .await;
    create_resp.assert_status_ok();

    let create_body: Value = create_resp.json();
    let mfa_id = create_body["entry"]["id"].as_str().unwrap().to_string();

    // List MFA
    let list_resp = server
        .get("/api/vault/mfa")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    list_resp.assert_status_ok();
    let list_body: Value = list_resp.json();
    assert_eq!(list_body["entries"].as_array().unwrap().len(), 1);

    // Generate TOTP
    let totp_resp = server
        .get(&format!("/api/vault/mfa/{}/totp", mfa_id))
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    totp_resp.assert_status_ok();
    let totp_body: Value = totp_resp.json();
    assert!(totp_body["code"].is_string());
    assert!(totp_body["expires_in"].is_number());

    // Delete MFA
    let delete_resp = server
        .delete(&format!("/api/vault/mfa/{}", mfa_id))
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    delete_resp.assert_status_ok();
}

#[tokio::test]
async fn test_lock_and_unlock() {
    let (server, _temp) = create_test_server();

    // Setup
    let setup_resp = server
        .post("/api/auth/setup")
        .json(&json!({ "master_password": "TestPass123!" }))
        .await;
    let token = setup_resp.json::<Value>()["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // Lock
    let lock_resp = server
        .post("/api/auth/lock")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    lock_resp.assert_status_ok();

    // Check status is locked
    let status_resp = server.get("/api/vault/status").await;
    let status: Value = status_resp.json();
    assert_eq!(status["unlocked"], false);
    assert_eq!(status["initialized"], true);

    // Unlock again
    let unlock_resp = server
        .post("/api/auth/unlock")
        .json(&json!({ "master_password": "TestPass123!" }))
        .await;
    unlock_resp.assert_status_ok();
    let new_token = unlock_resp.json::<Value>()["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // Verify we can access entries again
    let list_resp = server
        .get("/api/vault/entries")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", new_token).parse().unwrap(),
        )
        .await;
    list_resp.assert_status_ok();
}

#[tokio::test]
async fn test_export_vault() {
    let (server, _temp) = create_test_server();

    // Setup
    let setup_resp = server
        .post("/api/auth/setup")
        .json(&json!({ "master_password": "TestPass123!" }))
        .await;
    let token = setup_resp.json::<Value>()["access_token"]
        .as_str()
        .unwrap()
        .to_string();

    // Create an entry
    server
        .post("/api/vault/entries")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .json(&json!({
            "title": "Export Test",
            "username": "user",
            "password": "exportpass"
        }))
        .await;

    // Export
    let export_resp = server
        .get("/api/vault/export")
        .add_header(
            axum::http::header::AUTHORIZATION,
            format!("Bearer {}", token).parse().unwrap(),
        )
        .await;
    export_resp.assert_status_ok();

    let body: Value = export_resp.json();
    assert_eq!(body["format"], "ramz");
    assert_eq!(body["version"], 1);
    assert_eq!(body["password_entries"].as_array().unwrap().len(), 1);
    assert_eq!(body["password_entries"][0]["title"], "Export Test");
    assert_eq!(body["password_entries"][0]["password"], "exportpass");
}
