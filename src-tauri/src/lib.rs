#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  use std::{
    fs,
    path::Path,
    time::Duration as StdDuration,
    sync::{
      atomic::{AtomicBool, Ordering},
      Mutex,
    },
    thread,
    time::Duration,
  };

  use tauri::{Emitter, Manager};
  use serde::Deserialize;

  #[derive(Default)]
  struct ClipboardWatcher {
    running: AtomicBool,
    handle: Mutex<Option<thread::JoinHandle<()>>>,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  enum CommandMode {
    #[serde(rename = "!np")]
    BangNp,
    #[serde(rename = "/np")]
    SlashNp,
    #[serde(rename = "/npp")]
    SlashNpp,
  }

  impl Default for CommandMode {
    fn default() -> Self {
      CommandMode::BangNp
    }
  }

  impl std::fmt::Display for CommandMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
      match self {
        CommandMode::BangNp => write!(f, "!np"),
        CommandMode::SlashNp => write!(f, "/np"),
        CommandMode::SlashNpp => write!(f, "/npp"),
      }
    }
  }

  #[derive(Default)]
  struct NpContext {
    current_mapcode: Mutex<Option<String>>,
    command_mode: Mutex<CommandMode>,
  }

  struct HotkeyRegistry {
    prev_map: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    next_map: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    replay_current: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    // Mass perm hotkeys (Insert/Delete/PageDown)
    mp_play: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    mp_pause: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    mp_next: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    mp_prev: Mutex<Option<tauri_plugin_global_shortcut::Shortcut>>,
    mp_enabled: AtomicBool,
    enabled: AtomicBool,
  }

  impl Default for HotkeyRegistry {
    fn default() -> Self {
      Self {
        prev_map: Mutex::new(None),
        next_map: Mutex::new(None),
        replay_current: Mutex::new(None),
        mp_play: Mutex::new(None),
        mp_pause: Mutex::new(None),
        mp_next: Mutex::new(None),
        mp_prev: Mutex::new(None),
        mp_enabled: AtomicBool::new(false),
        enabled: AtomicBool::new(true),
      }
    }
  }

  #[derive(Clone, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct NpContextUpdate {
    mapcode: Option<String>,
    command_mode: CommandMode,
  }

  #[derive(Clone, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct RegisterHotkeysArgs {
    // defaults:
    // - "PageUp"
    // - "PageDown"
    // - "Insert"
    prev_map: Option<String>,
    next_map: Option<String>,
    replay_current: Option<String>,
  }

  #[derive(Clone, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct MassPermHotkeysArgs {
    toggle: String,
    play_current: String,
    next: String,
    prev: String,
  }

  #[derive(Clone, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct SetMassPermHotkeysArgs {
    enabled: bool,
    hotkeys: MassPermHotkeysArgs,
  }

  #[derive(Clone, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct SendNpArgs {
    mapcode: String,
    command_mode: CommandMode,
  }

  #[derive(Clone, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct SendPermArgs {
    mapcode: String,
    category_number: i32,
  }

  // -------------------------
  // Export JSON (schema v1)
  // -------------------------
  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct ExportSettingsV1 {
    command_mode: CommandMode,
    dedupe: bool,
    auto_capture_clipboard: bool,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct ExportQueueItemV1 {
    id: String,
    mapcode: String,
    author: Option<String>,
    xml: Option<String>,
    submitter: Option<String>,
    imported_ignored: Option<bool>,
    imported_reason: Option<String>,
    commands_used: Vec<CommandMode>,
    review: String,
    decision: Option<String>,
    status: String,
    created_at: String,
    updated_at: String,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct ExportSessionV1 {
    category: String,
    input_method: String,
    started_at: String,
    reviewer_user_id: Option<String>,
    thread_id: Option<String>,
    collected_at: Option<String>,
    limit_per_user: Option<i64>,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct ExportPayloadV1 {
    schema_version: u32,
    app_version: String,
    exported_at: String,
    settings: ExportSettingsV1,
    session: Option<ExportSessionV1>,
    items: Vec<ExportQueueItemV1>,
  }

  #[tauri::command]
  fn export_json(path: String, payload: ExportPayloadV1) -> Result<String, String> {
    if payload.schema_version != 1 {
      return Err(format!("invalid schemaVersion: {}", payload.schema_version));
    }

    let trimmed = path.trim();
    if trimmed.is_empty() {
      return Err("empty path".into());
    }

    // Se o usuário não colocou extensão, força .json (mantém compatibilidade)
    let final_path = if Path::new(trimmed).extension().is_none() {
      format!("{trimmed}.json")
    } else {
      trimmed.to_string()
    };

    let mut txt = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    txt.push('\n');
    fs::write(&final_path, txt).map_err(|e| e.to_string())?;
    Ok(final_path)
  }

  // -------------------------
  // Session API import
  // -------------------------
  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct SessionApiMap {
    submitter: String,
    map_code: String,
    ignored: bool,
    reason: Option<String>,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct SessionApiSuccess {
    category: String,
    #[serde(deserialize_with = "de_string_from_number_or_string")]
    thread_id: String,
    collected_at: String,
    limit_per_user: i64,
    maps: Vec<SessionApiMap>,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct SessionApiError {
    error: String,
    category: Option<String>,
    #[serde(default, deserialize_with = "de_opt_string_from_number_or_string")]
    thread_id: Option<String>,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct SessionApiEnvelope {
    ok: bool,
    status: u16,
    data: Option<SessionApiSuccess>,
    error: Option<SessionApiError>,
  }

  fn normalize_category_code(raw: &str) -> Option<String> {
    let t = raw.trim().to_uppercase();
    if t.is_empty() {
      return None;
    }
    let t = if t.starts_with('P') { t } else { format!("P{t}") };
    let digits = t.strip_prefix('P')?;
    if digits.is_empty() || !digits.chars().all(|c| c.is_ascii_digit()) {
      return None;
    }
    Some(format!("P{digits}"))
  }

  fn de_string_from_number_or_string<'de, D>(deserializer: D) -> Result<String, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let v = serde_json::Value::deserialize(deserializer)?;
    match v {
      serde_json::Value::String(s) => Ok(s),
      serde_json::Value::Number(n) => Ok(n.to_string()),
      serde_json::Value::Bool(b) => Ok(b.to_string()),
      serde_json::Value::Null => Ok(String::new()),
      other => Ok(other.to_string()),
    }
  }

  fn de_opt_string_from_number_or_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
  where
    D: serde::Deserializer<'de>,
  {
    let v = Option::<serde_json::Value>::deserialize(deserializer)?;
    Ok(match v {
      None | Some(serde_json::Value::Null) => None,
      Some(serde_json::Value::String(s)) => Some(s),
      Some(serde_json::Value::Number(n)) => Some(n.to_string()),
      Some(serde_json::Value::Bool(b)) => Some(b.to_string()),
      Some(other) => Some(other.to_string()),
    })
  }

  #[derive(Clone, Debug)]
  struct SessionApiConfig {
    base_url: String,
    token: String,
  }

  fn normalize_base_url(raw: &str) -> String {
    let t = raw.trim();
    if t.is_empty() {
      return String::new();
    }
    let mut s = if t.starts_with("http://") || t.starts_with("https://") {
      t.to_string()
    } else {
      format!("http://{t}")
    };
    if !s.ends_with('/') {
      s.push('/');
    }
    s
  }

  fn parse_dotenv(contents: &str) -> std::collections::HashMap<String, String> {
    let mut out = std::collections::HashMap::new();
    for line in contents.lines() {
      let t = line.trim();
      if t.is_empty() || t.starts_with('#') {
        continue;
      }
      let Some((k, v)) = t.split_once('=') else { continue };
      let key = k.trim().to_string();
      let mut val = v.trim().to_string();
      if (val.starts_with('"') && val.ends_with('"')) || (val.starts_with('\'') && val.ends_with('\'')) {
        val = val[1..val.len().saturating_sub(1)].to_string();
      }
      out.insert(key, val);
    }
    out
  }

  fn read_sibling_dotenv() -> Option<std::collections::HashMap<String, String>> {
    // Em dev: `D:\xerobot\maps-reviewer-desktop\src-tauri` → sibling `..\xero3.0\.env`
    let candidates: Vec<std::path::PathBuf> = {
      let mut v = Vec::new();
      if let Ok(cwd) = std::env::current_dir() {
        // Primeiro tenta .env no cwd e no repo
        v.push(cwd.join(".env"));
        v.push(cwd.join("..").join(".env"));
        v.push(cwd.join("..").join("maps-reviewer-desktop").join(".env"));
        v.push(cwd.join("..").join("..").join("maps-reviewer-desktop").join(".env"));
        v.push(cwd.join("..").join("xero3.0").join(".env"));
        v.push(cwd.join("..").join("..").join("xero3.0").join(".env"));
        v.push(cwd.join("..").join("..").join("..").join("xero3.0").join(".env"));
      }
      if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
          v.push(dir.join(".env"));
          v.push(dir.join("..").join(".env"));
          v.push(dir.join("..").join("xero3.0").join(".env"));
          v.push(dir.join("..").join("..").join("xero3.0").join(".env"));
        }
      }
      v
    };

    for p in candidates {
      if let Ok(txt) = fs::read_to_string(&p) {
        return Some(parse_dotenv(&txt));
      }
    }
    None
  }

  fn load_session_api_config() -> SessionApiConfig {
    let env_base_url = std::env::var("SESSION_API_BASE_URL").ok().unwrap_or_default();
    let env_host = std::env::var("SESSION_API_HOST").ok().unwrap_or_default();
    let env_port = std::env::var("SESSION_API_PORT").ok().unwrap_or_default();
    let env_token = std::env::var("SESSION_API_TOKEN").ok().unwrap_or_default();

    let build_base_url = option_env!("SESSION_API_BASE_URL").unwrap_or("").to_string();
    let build_host = option_env!("SESSION_API_HOST").unwrap_or("").to_string();
    let build_port = option_env!("SESSION_API_PORT").unwrap_or("").to_string();
    let build_token = option_env!("SESSION_API_TOKEN").unwrap_or("").to_string();

    let file_map = read_sibling_dotenv().unwrap_or_default();

    let file_base_url = file_map.get("SESSION_API_BASE_URL").cloned().unwrap_or_default();
    let base_url_raw = if !env_base_url.trim().is_empty() {
      env_base_url
    } else if !file_base_url.trim().is_empty() {
      file_base_url
    } else if !build_base_url.trim().is_empty() {
      build_base_url
    } else {
      String::new()
    };

    let hostport_configured = !env_host.trim().is_empty()
      || !env_port.trim().is_empty()
      || file_map.contains_key("SESSION_API_HOST")
      || file_map.contains_key("SESSION_API_PORT")
      || !build_host.trim().is_empty()
      || !build_port.trim().is_empty();

    // Priority:
    // 1) SESSION_API_BASE_URL (runtime env, .env, build-time env)
    // 2) SESSION_API_HOST/PORT (runtime env, .env, build-time env) -> http://host:port
    // 3) default -> ngrok base url (user request)
    let base_url = if !base_url_raw.trim().is_empty() {
      normalize_base_url(&base_url_raw)
    } else if hostport_configured {
      let host = (if !env_host.trim().is_empty() {
        env_host
      } else {
        let file_host = file_map.get("SESSION_API_HOST").cloned().unwrap_or_default();
        if !file_host.trim().is_empty() {
          file_host
        } else if !build_host.trim().is_empty() {
          build_host
        } else {
          "127.0.0.1".to_string()
        }
      })
      .trim()
      .to_string();

      let port_raw = (if !env_port.trim().is_empty() {
        env_port
      } else {
        let file_port = file_map.get("SESSION_API_PORT").cloned().unwrap_or_default();
        if !file_port.trim().is_empty() {
          file_port
        } else if !build_port.trim().is_empty() {
          build_port
        } else {
          "8765".to_string()
        }
      })
      .trim()
      .to_string();

      let port = port_raw.parse::<u16>().unwrap_or(8765);
      normalize_base_url(&format!("http://{host}:{port}"))
    } else {
      normalize_base_url("https://nonflirtatious-abstentiously-raquel.ngrok-free.dev")
    };

    let token = (if !env_token.trim().is_empty() {
      env_token
    } else {
      let file_token = file_map.get("SESSION_API_TOKEN").cloned().unwrap_or_default();
      if !file_token.trim().is_empty() {
        file_token
      } else {
        build_token
      }
    })
    .trim()
    .to_string();

    SessionApiConfig { base_url, token }
  }

  #[tauri::command]
  fn fetch_session_api(category_type: String) -> Result<SessionApiEnvelope, String> {
    let Some(category) = normalize_category_code(&category_type) else {
      return Ok(SessionApiEnvelope {
        ok: false,
        status: 400,
        data: None,
        error: Some(SessionApiError {
          error: "missing_category".to_string(),
          category: None,
          thread_id: None,
        }),
      });
    };

    let cfg = load_session_api_config();
    let mut url = reqwest::Url::parse(&cfg.base_url)
      .map_err(|e| e.to_string())?
      .join("session")
      .map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("categoryType", &category);

    let client = reqwest::blocking::Client::builder()
      .timeout(StdDuration::from_secs(6))
      .build()
      .map_err(|e| e.to_string())?;

    let mut req = client.get(url);
    if !cfg.token.trim().is_empty() {
      req = req.header("Authorization", format!("Bearer {}", cfg.token.trim()));
    }

    let resp = req.send().map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().map_err(|e| e.to_string())?;

    // tenta extrair erro padronizado mesmo quando status != 200
    if let Ok(err) = serde_json::from_str::<SessionApiError>(&body) {
      if !err.error.is_empty() {
        return Ok(SessionApiEnvelope {
          ok: false,
          status,
          data: None,
          error: Some(err),
        });
      }
    }

    match serde_json::from_str::<SessionApiSuccess>(&body) {
      Ok(data) => Ok(SessionApiEnvelope {
        ok: true,
        status,
        data: Some(data),
        error: None,
      }),
      Err(_) => Ok(SessionApiEnvelope {
        ok: false,
        status,
        data: None,
        error: Some(SessionApiError {
          error: "invalid_response".to_string(),
          category: Some(category),
          thread_id: None,
        }),
      }),
    }
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct SubmitReviewEnvelope {
    ok: bool,
    status: u16,
    body: Option<String>,
    error: Option<String>,
  }

  #[tauri::command]
  fn submit_session_review_api(
    category_type: String,
    payload: ExportPayloadV1,
    token: Option<String>,
    votecrew: Option<bool>,
    post_as_private: Option<bool>,
  ) -> Result<SubmitReviewEnvelope, String> {
    let Some(category) = normalize_category_code(&category_type) else {
      return Ok(SubmitReviewEnvelope {
        ok: false,
        status: 400,
        body: None,
        error: Some("missing_category".to_string()),
      });
    };

    // valida schema
    if payload.schema_version != 1 {
      return Ok(SubmitReviewEnvelope {
        ok: false,
        status: 400,
        body: None,
        error: Some(format!("invalid schemaVersion: {}", payload.schema_version)),
      });
    }

    let cfg = load_session_api_config();
    let url = reqwest::Url::parse(&cfg.base_url)
      .map_err(|e| e.to_string())?
      .join(&format!("session/{category}/review"))
      .map_err(|e| e.to_string())?;

    let client = reqwest::blocking::Client::builder()
      .timeout(StdDuration::from_secs(10))
      .build()
      .map_err(|e| e.to_string())?;

    // Bearer auth is the fixed API token (SESSION_API_TOKEN).
    let mut req = client.post(url);
    if !cfg.token.trim().is_empty() {
      req = req.header("Authorization", format!("Bearer {}", cfg.token.trim()));
    }

    // userToken/votecrew/postAsPrivate are only part of the submit payload JSON.
    let mut v = serde_json::to_value(&payload).map_err(|e| e.to_string())?;
    if let serde_json::Value::Object(ref mut obj) = v {
      if let Some(t) = token.as_ref().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        obj.insert("userToken".to_string(), serde_json::Value::String(t));
      }
      if votecrew.unwrap_or(false) {
        obj.insert("votecrew".to_string(), serde_json::Value::Bool(true));
      }
      if post_as_private.unwrap_or(false) {
        obj.insert("postAsPrivate".to_string(), serde_json::Value::Bool(true));
      }
    }

    req = req.json(&v);

    let resp = req.send().map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().unwrap_or_default();

    if (200..300).contains(&status) {
      Ok(SubmitReviewEnvelope {
        ok: true,
        status,
        body: if body.trim().is_empty() { None } else { Some(body) },
        error: None,
      })
    } else {
      Ok(SubmitReviewEnvelope {
        ok: false,
        status,
        body: if body.trim().is_empty() { None } else { Some(body.clone()) },
        error: Some(if body.trim().is_empty() {
          "request_failed".to_string()
        } else {
          body
        }),
      })
    }
  }

  // -------------------------
  // Auth (validate token)
  // -------------------------
  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct AuthRole {
    #[serde(deserialize_with = "de_string_from_number_or_string")]
    id: String,
    name: String,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct AuthUser {
    #[serde(deserialize_with = "de_string_from_number_or_string")]
    id: String,
    name: String,
    username: String,
    avatar: String,
    roles: Vec<AuthRole>,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  struct AuthRecordIn {
    created_at: String,
    #[serde(deserialize_with = "de_string_from_number_or_string")]
    guild_id: String,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  struct AuthResponseIn {
    ok: bool,
    token: Option<String>,
    user: Option<AuthUser>,
    record: Option<AuthRecordIn>,
    error: Option<String>,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct AuthRecordOut {
    created_at: String,
    guild_id: String,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct AuthSuccessOut {
    ok: bool,
    token: String,
    user: AuthUser,
    record: AuthRecordOut,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct AuthEnvelope {
    ok: bool,
    status: u16,
    data: Option<AuthSuccessOut>,
    error: Option<String>,
  }

  #[tauri::command]
  fn validate_auth_token(token: String) -> Result<AuthEnvelope, String> {
    let t = token.trim().to_string();
    if t.is_empty() {
      return Ok(AuthEnvelope {
        ok: false,
        status: 400,
        data: None,
        error: Some("missing_token".to_string()),
      });
    }

    let cfg = load_session_api_config();
    let mut url = reqwest::Url::parse(&cfg.base_url)
      .map_err(|e| e.to_string())?
      .join("auth")
      .map_err(|e| e.to_string())?;
    url.query_pairs_mut().append_pair("token", &t);

    let client = reqwest::blocking::Client::builder()
      .timeout(StdDuration::from_secs(6))
      .build()
      .map_err(|e| e.to_string())?;

    let resp = client.get(url).send().map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let body = resp.text().map_err(|e| e.to_string())?;

    match serde_json::from_str::<AuthResponseIn>(&body) {
      Ok(parsed) => {
        if parsed.ok {
          let Some(tok) = parsed.token.clone() else {
            return Ok(AuthEnvelope {
              ok: false,
              status,
              data: None,
              error: Some("invalid_response".to_string()),
            });
          };
          let Some(user) = parsed.user.clone() else {
            return Ok(AuthEnvelope {
              ok: false,
              status,
              data: None,
              error: Some("invalid_response".to_string()),
            });
          };
          let Some(rec) = parsed.record.clone() else {
            return Ok(AuthEnvelope {
              ok: false,
              status,
              data: None,
              error: Some("invalid_response".to_string()),
            });
          };

          Ok(AuthEnvelope {
            ok: true,
            status,
            data: Some(AuthSuccessOut {
              ok: true,
              token: tok,
              user,
              record: AuthRecordOut {
                created_at: rec.created_at,
                guild_id: rec.guild_id,
              },
            }),
            error: None,
          })
        } else {
          Ok(AuthEnvelope {
            ok: false,
            status,
            data: None,
            error: parsed.error.clone().or_else(|| Some("invalid_token".to_string())),
          })
        }
      }
      Err(_) => Ok(AuthEnvelope {
        ok: false,
        status,
        data: None,
        error: Some("invalid_response".to_string()),
      }),
    }
  }

  fn build_np_command(mode: CommandMode, mapcode: &str) -> String {
    format!("{mode} @{mapcode}")
  }

  fn build_perm_command(category_number: i32, mapcode: &str) -> String {
    format!("/p {} @{}", category_number, mapcode)
  }

  fn is_macos() -> bool {
    cfg!(target_os = "macos")
  }

  fn normalize_shortcut_string(raw: &str) -> String {
    let parts: Vec<String> = raw
      .split('+')
      .map(|part| part.trim())
      .filter(|part| !part.is_empty())
      .map(|part| part.to_string())
      .collect();

    if parts.is_empty() {
      return String::new();
    }

    let last_idx = parts.len().saturating_sub(1);
    let mut normalized = Vec::with_capacity(parts.len() + 1);
    let mut shift_present = false;
    for (idx, part) in parts.iter().enumerate() {
      if idx == last_idx {
        continue;
      }
      if part.eq_ignore_ascii_case("shift") {
        shift_present = true;
      }
      normalized.push(part.clone());
    }

    let base = parts.get(last_idx).cloned().unwrap_or_default();
    let needs_shift = matches!(base.as_str(), "<" | ">" | "?");
    if needs_shift && !shift_present {
      normalized.push("Shift".to_string());
    }

    let mapped = match base.as_str() {
      "<" | "," => "Comma",
      ">" | "." => "Period",
      "?" | "/" => "Slash",
      _ => base.as_str(),
    };
    normalized.push(mapped.to_string());

    normalized.join("+")
  }

  fn paste_modifier_key() -> enigo::Key {
    if is_macos() {
      enigo::Key::Meta
    } else {
      enigo::Key::Control
    }
  }

  fn type_in_active_window_and_enter(text: &str) -> Result<(), String> {
    use enigo::{Direction, Enigo, Key, Keyboard, Settings};
    use std::{thread, time::Duration};

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    // Clipboard + paste is faster than text() for long commands.
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    let prev_clip = clipboard.get_text().ok();
    clipboard.set_text(text.to_string()).map_err(|e| e.to_string())?;

    // Flow: Enter (open chat) -> paste -> Enter (submit)
    enigo.key(Key::Return, Direction::Click).map_err(|e| e.to_string())?;
    let cmd = paste_modifier_key();
    enigo.key(cmd, Direction::Press).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(20));
    enigo.key(Key::Unicode('v'), Direction::Click).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(20));
    enigo.key(cmd, Direction::Release).map_err(|e| e.to_string())?;
    thread::sleep(Duration::from_millis(250));
    enigo.key(Key::Return, Direction::Click).map_err(|e| e.to_string())?;

    // best-effort clipboard restore (only if it was text)
    if let Some(prev) = prev_clip {
      let _ = clipboard.set_text(prev);
    }
    Ok(())
  }

  fn unregister_shortcut(app: &tauri::AppHandle, sc: &Option<tauri_plugin_global_shortcut::Shortcut>) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    if let Some(sc) = sc.as_ref() {
      let _ = app.global_shortcut().unregister(sc.clone());
    }
  }

  fn unregister_all_hotkeys(app: &tauri::AppHandle, reg: &HotkeyRegistry) -> Result<(), String> {
    let prev = reg.prev_map.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let next = reg.next_map.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let replay = reg.replay_current.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let mp_play = reg.mp_play.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let mp_pause = reg.mp_pause.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let mp_next = reg.mp_next.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let mp_prev = reg.mp_prev.lock().map_err(|_| "hotkey lock poisoned")?.clone();

    // unregister (best effort)
    unregister_shortcut(app, &prev);
    unregister_shortcut(app, &next);
    unregister_shortcut(app, &replay);
    unregister_shortcut(app, &mp_play);
    unregister_shortcut(app, &mp_pause);
    unregister_shortcut(app, &mp_next);
    unregister_shortcut(app, &mp_prev);

    *reg.prev_map.lock().map_err(|_| "hotkey lock poisoned")? = None;
    *reg.next_map.lock().map_err(|_| "hotkey lock poisoned")? = None;
    *reg.replay_current.lock().map_err(|_| "hotkey lock poisoned")? = None;
    *reg.mp_play.lock().map_err(|_| "hotkey lock poisoned")? = None;
    *reg.mp_pause.lock().map_err(|_| "hotkey lock poisoned")? = None;
    *reg.mp_next.lock().map_err(|_| "hotkey lock poisoned")? = None;
    *reg.mp_prev.lock().map_err(|_| "hotkey lock poisoned")? = None;

    Ok(())
  }

  fn unregister_massperm_hotkeys(app: &tauri::AppHandle, reg: &HotkeyRegistry) -> Result<(), String> {
    let mp_play = reg.mp_play.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let mp_pause = reg.mp_pause.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let mp_next = reg.mp_next.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let mp_prev = reg.mp_prev.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    unregister_shortcut(app, &mp_play);
    unregister_shortcut(app, &mp_pause);
    unregister_shortcut(app, &mp_next);
    unregister_shortcut(app, &mp_prev);
    *reg.mp_play.lock().map_err(|_| "hotkey lock poisoned")? = None;
    *reg.mp_pause.lock().map_err(|_| "hotkey lock poisoned")? = None;
    *reg.mp_next.lock().map_err(|_| "hotkey lock poisoned")? = None;
    *reg.mp_prev.lock().map_err(|_| "hotkey lock poisoned")? = None;
    reg.mp_enabled.store(false, Ordering::SeqCst);
    Ok(())
  }

  fn set_massperm_hotkeys_enabled(
    app: &tauri::AppHandle,
    reg: &HotkeyRegistry,
    enabled: bool,
    hotkeys: &MassPermHotkeysArgs,
  ) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    let toggle_accel = hotkeys.toggle.trim();
    let play_current_accel = hotkeys.play_current.trim();
    let next_accel = hotkeys.next.trim();
    let prev_accel = hotkeys.prev.trim();

    if toggle_accel.is_empty() || play_current_accel.is_empty() || next_accel.is_empty() || prev_accel.is_empty() {
      return Err("empty mass perm hotkey".to_string());
    }

    let mp_play = normalize_shortcut_string(toggle_accel)
      .parse::<tauri_plugin_global_shortcut::Shortcut>()
      .map_err(|_| format!("invalid hotkey (toggle): {toggle_accel}"))?;
    let mp_pause = normalize_shortcut_string(play_current_accel)
      .parse::<tauri_plugin_global_shortcut::Shortcut>()
      .map_err(|_| format!("invalid hotkey (playCurrent): {play_current_accel}"))?;
    let mp_next = normalize_shortcut_string(next_accel)
      .parse::<tauri_plugin_global_shortcut::Shortcut>()
      .map_err(|_| format!("invalid hotkey (next): {next_accel}"))?;
    let mp_prev = normalize_shortcut_string(prev_accel)
      .parse::<tauri_plugin_global_shortcut::Shortcut>()
      .map_err(|_| format!("invalid hotkey (prev): {prev_accel}"))?;

    *reg.mp_play.lock().map_err(|_| "hotkey lock poisoned")? = Some(mp_play.clone());
    *reg.mp_pause.lock().map_err(|_| "hotkey lock poisoned")? = Some(mp_pause.clone());
    *reg.mp_next.lock().map_err(|_| "hotkey lock poisoned")? = Some(mp_next.clone());
    *reg.mp_prev.lock().map_err(|_| "hotkey lock poisoned")? = Some(mp_prev.clone());

    if enabled {
      // Remove conflitos entre hotkeys de sessão e mass perm
      let prev = reg.prev_map.lock().map_err(|_| "hotkey lock poisoned")?.clone();
      let next = reg.next_map.lock().map_err(|_| "hotkey lock poisoned")?.clone();
      let replay = reg.replay_current.lock().map_err(|_| "hotkey lock poisoned")?.clone();
      let mp_list = vec![mp_play.clone(), mp_pause.clone(), mp_next.clone(), mp_prev.clone()];
      for sc in [prev, next, replay].into_iter().flatten() {
        if mp_list.iter().any(|x| x == &sc) {
          unregister_shortcut(app, &Some(sc));
        }
      }

      app.global_shortcut().register(mp_play).map_err(|e| e.to_string())?;
      app.global_shortcut().register(mp_pause).map_err(|e| e.to_string())?;
      app.global_shortcut().register(mp_next).map_err(|e| e.to_string())?;
      app.global_shortcut().register(mp_prev).map_err(|e| e.to_string())?;

      reg.mp_enabled.store(true, Ordering::SeqCst);
      let _ = app.emit("massperm_hotkeys_status", serde_json::json!({ "enabled": true }));
      Ok(())
    } else {
      unregister_massperm_hotkeys(app, reg)?;

      // Re-registra hotkeys de sessão (apenas as que conflitam) se hotkeys estiverem habilitadas
      if reg.enabled.load(Ordering::SeqCst) {
        let next = reg.next_map.lock().map_err(|_| "hotkey lock poisoned")?.clone();
        let replay = reg.replay_current.lock().map_err(|_| "hotkey lock poisoned")?.clone();
        let prev = reg.prev_map.lock().map_err(|_| "hotkey lock poisoned")?.clone();
        if let Some(sc) = next {
          let _ = app.global_shortcut().register(sc);
        }
        if let Some(sc) = replay {
          let _ = app.global_shortcut().register(sc);
        }
        if let Some(sc) = prev {
          let _ = app.global_shortcut().register(sc);
        }
      }

      let _ = app.emit("massperm_hotkeys_status", serde_json::json!({ "enabled": false }));
      Ok(())
    }
  }

  fn set_hotkeys_enabled(
    app: &tauri::AppHandle,
    reg: &HotkeyRegistry,
    enabled: bool,
  ) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    reg.enabled.store(enabled, Ordering::SeqCst);

    let prev = reg.prev_map.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let next = reg.next_map.lock().map_err(|_| "hotkey lock poisoned")?.clone();
    let replay = reg
      .replay_current
      .lock()
      .map_err(|_| "hotkey lock poisoned")?
      .clone();

    if enabled {
      if let Some(sc) = prev {
        let _ = app.global_shortcut().register(sc);
      }
      if let Some(sc) = next {
        let _ = app.global_shortcut().register(sc);
      }
      if let Some(sc) = replay {
        let _ = app.global_shortcut().register(sc);
      }
    } else {
      unregister_shortcut(app, &prev);
      unregister_shortcut(app, &next);
      unregister_shortcut(app, &replay);
    }

    let _ = app.emit("hotkeys_status", serde_json::json!({ "enabled": enabled }));
    Ok(())
  }

  #[tauri::command]
  fn set_review_hotkeys_enabled_cmd(
    app: tauri::AppHandle,
    reg: tauri::State<'_, HotkeyRegistry>,
    enabled: bool,
  ) -> Result<(), String> {
    set_hotkeys_enabled(&app, &reg, enabled)
  }

  #[tauri::command]
  fn read_clipboard_text() -> Result<Option<String>, String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    match clipboard.get_text() {
      Ok(text) => Ok(Some(text)),
      Err(arboard::Error::ContentNotAvailable) => Ok(None),
      Err(e) => Err(e.to_string()),
    }
  }

  #[tauri::command]
  fn write_clipboard_text(text: String) -> Result<(), String> {
    let mut clipboard = arboard::Clipboard::new().map_err(|e| e.to_string())?;
    clipboard.set_text(text).map_err(|e| e.to_string())?;
    Ok(())
  }

  #[tauri::command]
  fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
  }

  // -------------------------
  // Cypher801 mapInfo
  // -------------------------
  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  struct CypherMapInfoEntry {
    id: i64,
    author: String,
    xml: String,
    p: i64,
  }

  #[derive(Clone, serde::Serialize, serde::Deserialize, Debug)]
  struct CypherMapInfoResponse {
    error: bool,
    data: Vec<CypherMapInfoEntry>,
  }

  #[tauri::command]
  fn fetch_map_info(map_ids: Vec<i64>) -> Result<CypherMapInfoResponse, String> {
    const KEY: &str = "e3b0c44298fc1c149af9-934ca495991b7852b855";

    let ids: Vec<i64> = map_ids
      .into_iter()
      .filter(|id| *id > 0)
      .collect();

    if ids.is_empty() {
      return Ok(CypherMapInfoResponse {
        error: false,
        data: vec![],
      });
    }

    // mantém URLs razoáveis
    let mut out = Vec::<CypherMapInfoEntry>::new();
    let client = reqwest::blocking::Client::builder()
      .timeout(StdDuration::from_secs(8))
      .build()
      .map_err(|e| e.to_string())?;

    for chunk in ids.chunks(80) {
      let joined = chunk
        .iter()
        .map(|x| x.to_string())
        .collect::<Vec<_>>()
        .join(",");
      let url = format!("https://cypher801.app/mapInfo/?maps={joined}&key={KEY}");
      let resp = client.get(url).send().map_err(|e| e.to_string())?;
      let body = resp.text().map_err(|e| e.to_string())?;
      let parsed: CypherMapInfoResponse = serde_json::from_str(&body).map_err(|e| e.to_string())?;
      if parsed.error {
        return Ok(parsed);
      }
      out.extend(parsed.data.into_iter());
    }

    Ok(CypherMapInfoResponse { error: false, data: out })
  }

  #[tauri::command]
  fn set_np_context(ctx: NpContextUpdate, state: tauri::State<'_, NpContext>) -> Result<(), String> {
    *state
      .current_mapcode
      .lock()
      .map_err(|_| "np context lock poisoned")? = ctx.mapcode.map(|s| s.trim().to_string()).filter(|s| !s.is_empty());
    *state.command_mode.lock().map_err(|_| "np context lock poisoned")? = ctx.command_mode;
    Ok(())
  }

  #[tauri::command]
  fn send_np_to_active_window(args: SendNpArgs) -> Result<String, String> {
    let mc = args.mapcode.trim();
    if mc.is_empty() {
      return Err("empty mapcode".into());
    }
    let mc = mc.strip_prefix('@').unwrap_or(mc);
    let cmd = build_np_command(args.command_mode, mc);
    type_in_active_window_and_enter(&cmd)?;
    Ok(cmd)
  }

  #[tauri::command]
  fn send_perm_to_active_window(args: SendPermArgs) -> Result<String, String> {
    let mc = args.mapcode.trim();
    if mc.is_empty() {
      return Err("empty mapcode".into());
    }
    if args.category_number < 0 || args.category_number > 999 {
      return Err("invalid categoryNumber".into());
    }

    let mc = mc.strip_prefix('@').unwrap_or(mc);
    let cmd = build_perm_command(args.category_number, mc);
    type_in_active_window_and_enter(&cmd)?;
    Ok(cmd)
  }

  #[derive(Clone, serde::Deserialize, Debug)]
  #[serde(rename_all = "camelCase")]
  struct SendCustomArgs {
    mapcode: String,
    prefix: String,
    suffix: Option<String>,
  }

  #[tauri::command]
  fn send_custom_to_active_window(args: SendCustomArgs) -> Result<String, String> {
    let mc = args.mapcode.trim();
    if mc.is_empty() {
      return Err("empty mapcode".into());
    }
    let mc = mc.strip_prefix('@').unwrap_or(mc);

    let prefix = args.prefix.trim();
    if prefix.is_empty() {
      return Err("empty prefix".into());
    }

    let suffix = args.suffix.unwrap_or_default();
    let suffix = suffix.trim();

    let cmd = if suffix.is_empty() {
      format!("{prefix} @{mc}")
    } else {
      format!("{prefix} @{mc} {suffix}")
    };

    type_in_active_window_and_enter(&cmd)?;
    Ok(cmd)
  }

  #[tauri::command]
  fn register_hotkeys(
    app: tauri::AppHandle,
    reg: tauri::State<'_, HotkeyRegistry>,
    args: RegisterHotkeysArgs,
  ) -> Result<(), String> {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;

    // troca hotkeys de forma idempotente
    unregister_all_hotkeys(&app, &reg)?;

    let prev_accel = args.prev_map.as_deref().unwrap_or("PageUp").trim();
    let next_accel = args.next_map.as_deref().unwrap_or("PageDown").trim();
    let replay_accel = args.replay_current.as_deref().unwrap_or("Insert").trim();

    let prev_map = normalize_shortcut_string(prev_accel)
      .parse::<tauri_plugin_global_shortcut::Shortcut>()
      .map_err(|_| format!("invalid hotkey (prevMap): {prev_accel}"))?;
    let next_map = normalize_shortcut_string(next_accel)
      .parse::<tauri_plugin_global_shortcut::Shortcut>()
      .map_err(|_| format!("invalid hotkey (nextMap): {next_accel}"))?;
    let replay_current = normalize_shortcut_string(replay_accel)
      .parse::<tauri_plugin_global_shortcut::Shortcut>()
      .map_err(|_| format!("invalid hotkey (replayCurrent): {replay_accel}"))?;

    *reg.prev_map.lock().map_err(|_| "hotkey lock poisoned")? = Some(prev_map.clone());
    *reg.next_map.lock().map_err(|_| "hotkey lock poisoned")? = Some(next_map.clone());
    *reg
      .replay_current
      .lock()
      .map_err(|_| "hotkey lock poisoned")? = Some(replay_current.clone());

    // registra as demais conforme flag enabled (default: true)
    if reg.enabled.load(Ordering::SeqCst) {
      let mp_play = reg.mp_play.lock().ok().and_then(|g| g.clone());
      let mp_pause = reg.mp_pause.lock().ok().and_then(|g| g.clone());
      let mp_next = reg.mp_next.lock().ok().and_then(|g| g.clone());
      let mp_prev = reg.mp_prev.lock().ok().and_then(|g| g.clone());
      let mp_list = [mp_play, mp_pause, mp_next, mp_prev];
      let conflicts = |sc: &tauri_plugin_global_shortcut::Shortcut| {
        mp_list.iter().flatten().any(|mp| mp == sc)
      };

      if !reg.mp_enabled.load(Ordering::SeqCst) || !conflicts(&prev_map) {
        let _ = app.global_shortcut().register(prev_map.clone());
      }
      if !reg.mp_enabled.load(Ordering::SeqCst) || !conflicts(&next_map) {
        let _ = app.global_shortcut().register(next_map.clone());
      }
      if !reg.mp_enabled.load(Ordering::SeqCst) || !conflicts(&replay_current) {
        let _ = app.global_shortcut().register(replay_current.clone());
      }
    }

    let _ = app.emit(
      "hotkeys_registered",
      serde_json::json!({
        "enabled": reg.enabled.load(Ordering::SeqCst),
        "prevMap": prev_accel,
        "nextMap": next_accel,
        "replayCurrent": replay_accel
      }),
    );

    Ok(())
  }

  #[tauri::command]
  fn set_massperm_hotkeys_enabled_cmd(
    app: tauri::AppHandle,
    reg: tauri::State<'_, HotkeyRegistry>,
    args: SetMassPermHotkeysArgs,
  ) -> Result<(), String> {
    set_massperm_hotkeys_enabled(&app, &reg, args.enabled, &args.hotkeys)
  }

  #[tauri::command]
  fn start_clipboard_watch(
    app: tauri::AppHandle,
    watcher: tauri::State<'_, ClipboardWatcher>,
  ) -> Result<(), String> {
    if watcher.running.swap(true, Ordering::SeqCst) {
      return Ok(());
    }

    let app = app.clone();
    let handle = thread::spawn(move || {
      let mut last: Option<String> = None;

      loop {
        // stop condition
        if !app.state::<ClipboardWatcher>().running.load(Ordering::SeqCst) {
          break;
        }

        let next = (|| -> Option<String> {
          let mut clipboard = arboard::Clipboard::new().ok()?;
          let txt = clipboard.get_text().ok()?;
          let trimmed = txt.trim();
          if trimmed.is_empty() {
            return None;
          }
          Some(trimmed.to_string())
        })();

        if let Some(text) = next {
          if last.as_deref() != Some(text.as_str()) {
            last = Some(text.clone());
            let _ = app.emit("clipboard_changed", text);
          }
        }

        thread::sleep(Duration::from_millis(600));
      }
    });

    *watcher.handle.lock().map_err(|_| "watcher lock poisoned")? = Some(handle);
    Ok(())
  }

  #[tauri::command]
  fn stop_clipboard_watch(watcher: tauri::State<'_, ClipboardWatcher>) -> Result<(), String> {
    watcher.running.store(false, Ordering::SeqCst);
    if let Some(handle) = watcher
      .handle
      .lock()
      .map_err(|_| "watcher lock poisoned")?
      .take()
    {
      let _ = handle.join();
    }
    Ok(())
  }

  tauri::Builder::default()
    .plugin(
      tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
          if event.state() != tauri_plugin_global_shortcut::ShortcutState::Pressed {
            return;
          }

          let reg = app.state::<HotkeyRegistry>();

          // mass perm hotkeys (funcionam independentemente do enabled toggle da sessão)
          if reg.mp_enabled.load(Ordering::SeqCst) {
            let mp_play = reg.mp_play.lock().ok().and_then(|g| g.clone());
            if mp_play.as_ref() == Some(shortcut) {
              let _ = app.emit("hotkey_massperm_toggle", ());
              return;
            }
            let mp_pause = reg.mp_pause.lock().ok().and_then(|g| g.clone());
            if mp_pause.as_ref() == Some(shortcut) {
              let _ = app.emit("hotkey_massperm_play_current", ());
              return;
            }
            let mp_prev = reg.mp_prev.lock().ok().and_then(|g| g.clone());
            if mp_prev.as_ref() == Some(shortcut) {
              let _ = app.emit("hotkey_massperm_prev", ());
              return;
            }
            let mp_next = reg.mp_next.lock().ok().and_then(|g| g.clone());
            if mp_next.as_ref() == Some(shortcut) {
              let _ = app.emit("hotkey_massperm_next", ());
              return;
            }
          }

          if !reg.enabled.load(Ordering::SeqCst) {
            return;
          }

          let prev = reg.prev_map.lock().ok().and_then(|g| g.clone());
          if prev.as_ref() == Some(shortcut) {
            let _ = app.emit("hotkey_nav_play", serde_json::json!({ "delta": -1 }));
            return;
          }

          let next = reg.next_map.lock().ok().and_then(|g| g.clone());
          if next.as_ref() == Some(shortcut) {
            let _ = app.emit("hotkey_nav_play", serde_json::json!({ "delta": 1 }));
            return;
          }

          let replay = reg.replay_current.lock().ok().and_then(|g| g.clone());
          if replay.as_ref() == Some(shortcut) {
            let _ = app.emit("hotkey_replay_current", ());
            return;
          }
        })
        .build(),
    )
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_process::init())
    .plugin(tauri_plugin_updater::Builder::new().build())
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .manage(ClipboardWatcher::default())
    .manage(NpContext::default())
    .manage(HotkeyRegistry::default())
    .invoke_handler(tauri::generate_handler![
      read_clipboard_text,
      write_clipboard_text,
      read_text_file,
      fetch_map_info,
      set_np_context,
      send_np_to_active_window,
      send_perm_to_active_window,
      send_custom_to_active_window,
      export_json,
      validate_auth_token,
      fetch_session_api,
      submit_session_review_api,
      register_hotkeys,
      set_massperm_hotkeys_enabled_cmd,
      set_review_hotkeys_enabled_cmd,
      start_clipboard_watch,
      stop_clipboard_watch
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
