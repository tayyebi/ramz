use anyhow::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use rand::Rng;
use ring::rand::{SecureRandom, SystemRandom};
use url::Url;

pub fn generate_random_secret(bytes: usize) -> String {
    let rng = SystemRandom::new();
    let mut buf = vec![0u8; bytes];
    rng.fill(&mut buf).expect("Failed to generate random bytes");
    BASE64.encode(&buf)
}

pub fn generate_password(
    length: usize,
    use_uppercase: bool,
    use_lowercase: bool,
    use_digits: bool,
    use_symbols: bool,
    exclude_ambiguous: bool,
) -> String {
    let mut charset = String::new();

    if use_uppercase {
        if exclude_ambiguous {
            charset.push_str("ABCDEFGHJKLMNPQRSTUVWXYZ");
        } else {
            charset.push_str("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
        }
    }
    if use_lowercase {
        if exclude_ambiguous {
            charset.push_str("abcdefghjkmnpqrstuvwxyz");
        } else {
            charset.push_str("abcdefghijklmnopqrstuvwxyz");
        }
    }
    if use_digits {
        if exclude_ambiguous {
            charset.push_str("23456789");
        } else {
            charset.push_str("0123456789");
        }
    }
    if use_symbols {
        charset.push_str("!@#$%^&*()_+-=[]{}|;:,.<>?");
    }

    if charset.is_empty() {
        charset.push_str("abcdefghijklmnopqrstuvwxyz");
    }

    let chars: Vec<char> = charset.chars().collect();
    let mut rng = rand::thread_rng();
    (0..length)
        .map(|_| chars[rng.gen_range(0..chars.len())])
        .collect()
}

pub fn estimate_password_strength(password: &str) -> u32 {
    if password.is_empty() {
        return 0;
    }

    let len = password.len();
    let mut score: u32 = 0;

    // Length scoring
    score += match len {
        0..=7 => 10,
        8..=11 => 20,
        12..=15 => 30,
        16..=19 => 40,
        _ => 50,
    };

    let has_upper = password.chars().any(|c| c.is_uppercase());
    let has_lower = password.chars().any(|c| c.is_lowercase());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    let has_symbol = password.chars().any(|c| !c.is_alphanumeric());

    let variety = [has_upper, has_lower, has_digit, has_symbol]
        .iter()
        .filter(|&&b| b)
        .count() as u32;

    score += variety * 10;

    score.min(100)
}

#[derive(Debug, Clone)]
pub struct OtpauthParams {
    pub account_name: String,
    pub issuer: Option<String>,
    pub secret: String,
    pub algorithm: String,
    pub digits: u8,
    pub period: u64,
}

pub fn parse_otpauth_uri(uri: &str) -> Result<OtpauthParams> {
    let url = Url::parse(uri).map_err(|e| anyhow::anyhow!("Invalid OTP URI: {}", e))?;

    if url.scheme() != "otpauth" {
        return Err(anyhow::anyhow!("URI must use otpauth scheme"));
    }

    if url.host_str() != Some("totp") {
        return Err(anyhow::anyhow!("Only TOTP is supported"));
    }

    // Parse path - strip leading slash
    let path = url.path().trim_start_matches('/');
    let decoded_path = urlencoding::decode(path)
        .map_err(|e| anyhow::anyhow!("Failed to decode path: {}", e))?
        .into_owned();

    let (issuer_from_path, account_name) = if let Some(colon_pos) = decoded_path.find(':') {
        let issuer = decoded_path[..colon_pos].trim().to_string();
        let account = decoded_path[colon_pos + 1..].trim().to_string();
        (Some(issuer), account)
    } else {
        (None, decoded_path)
    };

    let mut secret = String::new();
    let mut issuer: Option<String> = None;
    let mut algorithm = "SHA1".to_string();
    let mut digits: u8 = 6;
    let mut period: u64 = 30;

    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "secret" => secret = value.into_owned(),
            "issuer" => issuer = Some(value.into_owned()),
            "algorithm" => algorithm = value.into_owned().to_uppercase(),
            "digits" => digits = value.parse().unwrap_or(6),
            "period" => period = value.parse().unwrap_or(30),
            _ => {}
        }
    }

    if secret.is_empty() {
        return Err(anyhow::anyhow!("Missing secret parameter"));
    }

    let final_issuer = issuer.or(issuer_from_path);

    Ok(OtpauthParams {
        account_name,
        issuer: final_issuer,
        secret,
        algorithm,
        digits,
        period,
    })
}
