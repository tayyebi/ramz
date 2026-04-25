use ramz::{config::AppConfig, session::SessionStore, vault::VaultManager, AppState, SharedState};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = AppConfig::load()?;

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
                let level = config
                    .logging
                    .level
                    .as_deref()
                    .unwrap_or("info")
                    .to_string();
                level.into()
            }),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let sessions = SessionStore::new(&config);
    let vault = VaultManager::new(&config)?;
    let auth = ramz::auth::AuthManager::new(&config)?;

    let state: AppState = Arc::new(SharedState {
        config: config.clone(),
        sessions,
        vault: RwLock::new(vault),
        auth,
    });

    let app = ramz::api::build_router(state.clone());

    let addr = format!("{}:{}", config.server.host, config.server.port);
    tracing::info!("Listening on {}", addr);

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
