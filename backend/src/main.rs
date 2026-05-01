use clap::{CommandFactory, Parser};
use ramz::{config::AppConfig, session::SessionStore, vault::VaultManager, AppState, SharedState};
use std::sync::Arc;
use tokio::sync::RwLock;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// Ramz – self-hosted password manager backend
#[derive(Parser, Debug)]
#[command(version, about, long_about = None)]
struct Cli {
    /// Host address to listen on (overrides config file and RAMZ_HOST env var)
    #[arg(long, value_name = "HOST")]
    host: Option<String>,

    /// Port to listen on (overrides config file and RAMZ_PORT env var)
    #[arg(short, long, value_name = "PORT")]
    port: Option<u16>,

    /// Increase log verbosity: -v = debug, -vv = trace, -vvv = all crates
    #[arg(short, long, action = clap::ArgAction::Count)]
    verbose: u8,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Accept bare `help` as an alias for --help
    let raw_args: Vec<String> = std::env::args().collect();
    if raw_args.get(1).map(|s| s.as_str()) == Some("help") {
        Cli::command().print_long_help()?;
        println!();
        return Ok(());
    }

    let cli = Cli::parse();
    let mut config = AppConfig::load()?;

    // CLI args take highest precedence (above config file and env vars)
    if let Some(host) = cli.host {
        config.server.host = host;
    }
    if let Some(port) = cli.port {
        config.server.port = port;
    }

    let log_level = match cli.verbose {
        0 => config
            .logging
            .level
            .as_deref()
            .unwrap_or("info")
            .to_string(),
        1 => "info,ramz=debug".to_string(),
        2 => "debug".to_string(),
        _ => "trace".to_string(),
    };

    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| log_level.into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!(version = env!("CARGO_PKG_VERSION"), "Starting Ramz backend");
    tracing::debug!(host = %config.server.host, port = config.server.port, "Effective listen address");

    let sessions = SessionStore::new(&config);
    tracing::debug!("Session store initialised");

    let vault = VaultManager::new(&config)?;
    tracing::debug!(
        data_dir = %config.storage.data_dir,
        vault_exists = vault.vault_exists(),
        "Vault manager initialised"
    );

    let auth = ramz::auth::AuthManager::new(&config)?;
    tracing::debug!("Auth manager initialised");

    let state: AppState = Arc::new(SharedState {
        config: config.clone(),
        sessions,
        vault: RwLock::new(vault),
        auth,
    });

    let app = ramz::api::build_router(state.clone());

    let addr = format!("{}:{}", config.server.host, config.server.port);
    tracing::info!(%addr, "Listening for connections");

    let listener = tokio::net::TcpListener::bind(&addr).await?;
    axum::serve(listener, app).await?;

    Ok(())
}
