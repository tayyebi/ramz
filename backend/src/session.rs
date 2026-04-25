use crate::config::AppConfig;
use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionData {
    pub id: Uuid,
    pub created_at: DateTime<Utc>,
    pub last_active: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct FailedAttempts {
    count: u32,
    first_attempt: DateTime<Utc>,
}

#[derive(Clone)]
pub struct SessionStore {
    sessions: Arc<DashMap<Uuid, SessionData>>,
    failed_attempts: Arc<DashMap<String, FailedAttempts>>,
    inactivity_timeout_minutes: u64,
    max_failed_attempts: u32,
}

impl SessionStore {
    pub fn new(config: &AppConfig) -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            failed_attempts: Arc::new(DashMap::new()),
            inactivity_timeout_minutes: config.security.inactivity_timeout_minutes,
            max_failed_attempts: config.security.max_failed_attempts,
        }
    }

    pub fn create_session(&self) -> SessionData {
        let session = SessionData {
            id: Uuid::new_v4(),
            created_at: Utc::now(),
            last_active: Utc::now(),
        };
        self.sessions.insert(session.id, session.clone());
        session
    }

    pub fn get_session(&self, id: &Uuid) -> Option<SessionData> {
        self.sessions.get(id).map(|s| s.clone())
    }

    pub fn touch_session(&self, id: &Uuid) -> bool {
        if let Some(mut session) = self.sessions.get_mut(id) {
            session.last_active = Utc::now();
            true
        } else {
            false
        }
    }

    pub fn invalidate_session(&self, id: &Uuid) {
        self.sessions.remove(id);
    }

    pub fn invalidate_all_sessions(&self) {
        self.sessions.clear();
    }

    pub fn is_session_valid(&self, id: &Uuid) -> bool {
        if let Some(session) = self.sessions.get(id) {
            let timeout = Duration::minutes(self.inactivity_timeout_minutes as i64);
            let elapsed = Utc::now() - session.last_active;
            elapsed < timeout
        } else {
            false
        }
    }

    pub fn is_rate_limited(&self, identifier: &str) -> bool {
        if let Some(attempts) = self.failed_attempts.get(identifier) {
            let window = Duration::minutes(1);
            let elapsed = Utc::now() - attempts.first_attempt;
            if elapsed < window && attempts.count >= self.max_failed_attempts {
                return true;
            }
        }
        false
    }

    pub fn record_failed_attempt(&self, identifier: &str) {
        let mut entry = self
            .failed_attempts
            .entry(identifier.to_string())
            .or_insert(FailedAttempts {
                count: 0,
                first_attempt: Utc::now(),
            });

        let window = Duration::minutes(1);
        let elapsed = Utc::now() - entry.first_attempt;
        if elapsed >= window {
            entry.count = 1;
            entry.first_attempt = Utc::now();
        } else {
            entry.count += 1;
        }
    }

    pub fn clear_failed_attempts(&self, identifier: &str) {
        self.failed_attempts.remove(identifier);
    }
}
