use crate::{
    state::{now, num, text, State},
    windows,
};
use serde_json::{json, Value};
use sha1::{Digest, Sha1};
use tauri::{AppHandle, Manager};
pub async fn http(state: &State, url: &str, options: &Value) -> Result<Value, String> {
    let url = url::Url::parse(url).map_err(|e| e.to_string())?;
    if url.scheme() != "https"
        && !(url.scheme() == "http"
            && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]")))
    {
        return Err("Use HTTPS for network requests".into());
    }
    let method = text(options, "method")
        .parse()
        .unwrap_or(reqwest::Method::GET);
    let mut request = state.client.request(method, url);
    if let Some(headers) = options["headers"].as_object() {
        for (k, v) in headers {
            if let Some(v) = v.as_str() {
                request = request.header(k, v);
            }
        }
    }
    if let Some(body) = options["body"].as_str() {
        request = request.body(body.to_string());
    }
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status().as_u16();
    let mut headers = json!({});
    for (k, v) in response.headers() {
        if k != reqwest::header::SET_COOKIE {
            headers[k.as_str()] = json!(v.to_str().unwrap_or(""));
        }
    }
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() + chunk.len() > 8 * 1024 * 1024 {
            return Err("Network response too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let text = String::from_utf8_lossy(&bytes).into_owned();
    Ok(json!({"status":status,"headers":headers,"text":text}))
}
pub fn cache(state: &State, key: &str, value: Option<Value>) -> Result<Value, String> {
    let hash = format!("{:x}", Sha1::digest(key.as_bytes()));
    let dir = state.root.join("lyrics");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join(format!("{}.json", &hash[..20]));
    if let Some(result) = value {
        std::fs::write(
            file,
            json!({"key":key,"at":now(),"result":result}).to_string(),
        )
        .map_err(|e| e.to_string())?;
        return Ok(Value::Bool(true));
    }
    let data = std::fs::read(file)
        .ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
    Ok(data
        .filter(|v| v["key"] == key)
        .map(|v| v["result"].clone())
        .unwrap_or(Value::Null))
}
pub async fn calendar(app: &AppHandle, request: bool) -> Result<Value, String> {
    let state = app.state::<State>();
    let settings = state.settings();
    let value = if cfg!(target_os = "macos") && settings["calendarSource"] == "apple" {
        let mut v = tauri::async_runtime::spawn_blocking(move || {
            crate::platform::native(json!({"op":"calendar","request":request}))
        })
        .await
        .map_err(|e| e.to_string())?;
        let ids = settings["appleCalendarIds"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        if let Some(events) = v["events"].as_array_mut() {
            events.retain(|e| ids.is_empty() || ids.contains(&e["calendarId"]));
            for e in events {
                let hay = format!(
                    "{} {} {}",
                    text(e, "url"),
                    text(e, "location"),
                    text(e, "notes")
                );
                let link = hay
                    .split_whitespace()
                    .find(|w| {
                        w.starts_with("https://")
                            && [
                                "zoom.us",
                                "meet.google.com",
                                "teams.microsoft.com",
                                "webex.com",
                                "whereby.com",
                                "meet.jit.si",
                            ]
                            .iter()
                            .any(|host| w.contains(host))
                    })
                    .map(str::to_string);
                e["link"] = json!(link);
            }
        }
        v
    } else {
        let url = text(&settings, "icsUrl")
            .trim()
            .replace("webcal://", "https://");
        if url.is_empty() {
            json!({"events":[],"error":null})
        } else {
            match http(&state, &url, &json!({})).await {
                Ok(r) if r["status"].as_u64().unwrap_or(500) < 300 => {
                    json!({"ics":r["text"],"events":[],"error":null})
                }
                Ok(r) => json!({"events":[],"error":format!("Calendar returned {}",r["status"])}),
                Err(e) => json!({"events":[],"error":e}),
            }
        }
    };
    *state.calendar.lock().unwrap() = value.clone();
    windows::emit(app, "calendar", value.clone());
    Ok(value)
}
pub fn service(state: &State) -> Option<&'static str> {
    let media = state.media.lock().unwrap();
    let app = text(&media, "app");
    if crate::helper::apple(app) {
        Some("apple")
    } else if app.to_lowercase().contains("spotify") {
        Some("spotify")
    } else {
        None
    }
}
async fn player_tokens(app: &AppHandle, name: &str, refresh: bool) -> Result<Value, String> {
    let state = app.state::<State>();
    let initial = state.secret(name);
    if !refresh {
        if let Some(value) = &initial {
            if name == "apple" || num(value, "exp", 0.0) > now() as f64 + 60000.0 {
                return Ok(value.clone());
            }
        }
    }
    if initial.is_none() {
        return Err(format!("Connect {name} in Settings → Music & Lyrics"));
    }
    windows::auth(app, name, false)?;
    for _ in 0..50 {
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        if let Some(value) = state.secret(name) {
            if Some(&value) != initial.as_ref()
                || name == "spotify" && num(&value, "exp", 0.0) > now() as f64 + 60000.0
            {
                return Ok(value);
            }
        }
    }
    Err(format!("Reconnect {name} in Settings → Music & Lyrics"))
}
pub async fn player(
    app: &AppHandle,
    name: &str,
    operation: &str,
    q: &Value,
) -> Result<Value, String> {
    let state = app.state::<State>();
    if service(&state) != Some(name) {
        return Err("Lyrics must come from the player currently playing".into());
    }
    let mut tok = player_tokens(app, name, false).await?;
    let target = if name == "spotify" {
        if operation == "search" {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            let term = format!(
                "track:{} artist:{}",
                text(q, "title"),
                text(q, "artist").split([',', '&']).next().unwrap_or("")
            );
            query
                .append_pair("q", &term)
                .append_pair("type", "track")
                .append_pair("limit", "8");
            format!("https://api.spotify.com/v1/search?{}", query.finish())
        } else {
            let id = text(q, "id");
            if !id.chars().all(|c| c.is_ascii_alphanumeric()) {
                return Err("Invalid track id".into());
            }
            format!("https://spclient.wg.spotify.com/color-lyrics/v2/track/{id}?format=json&vocalRemoval=false&market=from_token")
        }
    } else if name == "apple" {
        let sf = state
            .client
            .get("https://amp-api.music.apple.com/v1/me/storefront")
            .bearer_auth(text(&tok, "dev"))
            .header("Media-User-Token", text(&tok, "user"))
            .send()
            .await
            .map_err(|e| e.to_string())?;
        if sf.status().is_success() {
            let data: Value = sf.json().await.map_err(|e| e.to_string())?;
            if let Some(id) = data["data"][0]["id"].as_str() {
                tok["sf"] = json!(id);
                state.set_secret("apple", Some(tok.clone()))?;
            }
        }
        let sf = text(&tok, "sf");
        if !sf.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
            return Err("Invalid storefront".into());
        }
        if operation == "search" {
            let mut query = url::form_urlencoded::Serializer::new(String::new());
            query
                .append_pair(
                    "term",
                    &format!("{} {}", text(q, "artist"), text(q, "title")),
                )
                .append_pair("types", "songs")
                .append_pair("limit", "8");
            format!(
                "https://amp-api.music.apple.com/v1/catalog/{sf}/search?{}",
                query.finish()
            )
        } else {
            let id = text(q, "id");
            if !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.') {
                return Err("Invalid song id".into());
            }
            format!("https://amp-api.music.apple.com/v1/catalog/{sf}/songs/{id}/lyrics")
        }
    } else {
        return Err("Unsupported lyrics source".into());
    };
    for attempt in 0..2 {
        let mut request = state.client.get(&target).bearer_auth(if name == "apple" {
            text(&tok, "dev")
        } else {
            text(&tok, "token")
        });
        if name == "apple" {
            request = request
                .header("Media-User-Token", text(&tok, "user"))
                .header("Origin", "https://music.apple.com")
                .header("Referer", "https://music.apple.com/");
        } else {
            request = request.header("app-platform", "WebPlayer");
            if !text(&tok, "clientToken").is_empty() {
                request = request.header("client-token", text(&tok, "clientToken"));
            }
        }
        let response = request.send().await.map_err(|e| e.to_string())?;
        if matches!(response.status().as_u16(), 401 | 403) && attempt == 0 {
            tok = player_tokens(app, name, true).await?;
            continue;
        }
        if response.status().as_u16() == 404 {
            return Ok(json!({}));
        }
        return response
            .error_for_status()
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string());
    }
    Err("The player session expired".into())
}
pub async fn todo(app: &AppHandle, operation: &str, args: &[Value]) -> Result<Value, String> {
    let state = app.state::<State>();
    let arg = |i: usize| args.get(i).cloned().unwrap_or(Value::Null);
    if operation == "info" {
        return Ok(state.todo_info());
    }
    if operation == "logout" {
        state.set_secret("todo", None)?;
        state.store.lock().unwrap()["todolist"]["cookie"] = json!("");
        state.save()?;
        state.broadcast(app);
        return Ok(state.todo_info());
    }
    if operation == "login" {
        let raw = arg(0);
        let raw = raw.as_str().unwrap_or("").trim();
        let mut url = url::Url::parse(&if raw.contains("://") {
            raw.into()
        } else {
            format!("https://{raw}")
        })
        .map_err(|_| "Enter a valid server address")?;
        if !matches!(url.scheme(), "https" | "http") {
            return Err("Use an HTTPS address".into());
        }
        if !matches!(url.host_str(), Some("localhost" | "127.0.0.1")) {
            url.set_scheme("https").ok();
        }
        let base = url.origin().ascii_serialization();
        let name = arg(1);
        let password = arg(2);
        let response = state
            .client
            .post(format!("{base}/api/login"))
            .json(&json!({"username":name,"password":password,"next":"/todo/"}))
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let cookie = response
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .filter_map(|v| v.split(';').next())
            .collect::<Vec<_>>()
            .join("; ");
        if cookie.is_empty() {
            return Err("The server did not start a session".into());
        }
        for prefix in ["/todo", ""] {
            let r = state
                .client
                .get(format!("{base}{prefix}/api/me"))
                .header("Cookie", &cookie)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if r.status().is_success() {
                let me: Value = r.json().await.map_err(|e| e.to_string())?;
                state.set_secret("todo", Some(json!(cookie)))?;
                state.set("todolist",json!({"url":base,"user":name,"name":me["name"].as_str().unwrap_or(name.as_str().unwrap_or("")),"prefix":prefix,"cookie":"rust:keyring"}))?;
                state.broadcast(app);
                return Ok(state.todo_info());
            }
        }
        return Err("Signed in but the Todolist API was not found".into());
    }
    let conf = state.store.lock().unwrap()["todolist"].clone();
    let cookie = state
        .secret("todo")
        .ok_or("Sign in to your Todolist in Settings")?;
    let base = format!("{}{}", text(&conf, "url"), text(&conf, "prefix"));
    let mut add_body = json!({"title":arg(0),"due":arg(1),"time":arg(2)});
    if operation == "add" && arg(1).as_str().is_none_or(str::is_empty) {
        let mut parsed = arg(3);
        if text(&conf, "prefix") == "/todo" {
            if let Ok(response) = state
                .client
                .get(format!("{base}/api/parse"))
                .query(&[("text", arg(0).as_str().unwrap_or(""))])
                .header("Cookie", cookie.as_str().unwrap_or(""))
                .send()
                .await
            {
                if response.status().is_success() {
                    if let Ok(value) = response.json::<Value>().await {
                        if value["title"].is_string() {
                            parsed = value;
                        }
                    }
                }
            }
        }
        if parsed["title"].is_string() {
            add_body = parsed;
        }
    }
    let (method, path, body) = match operation {
        "list" => (reqwest::Method::GET, "/api/data".to_string(), Value::Null),
        "add" => (reqwest::Method::POST, "/api/tasks".to_string(), add_body),
        "update" => (
            reqwest::Method::PATCH,
            format!(
                "/api/tasks/{}",
                url::form_urlencoded::byte_serialize(arg(0).as_str().unwrap_or("").as_bytes())
                    .collect::<String>()
            ),
            arg(1),
        ),
        "remove" => (
            reqwest::Method::DELETE,
            format!(
                "/api/tasks/{}",
                url::form_urlencoded::byte_serialize(arg(0).as_str().unwrap_or("").as_bytes())
                    .collect::<String>()
            ),
            Value::Null,
        ),
        _ => return Err("Unknown Todolist action".into()),
    };
    let mut r = state
        .client
        .request(method, format!("{base}{path}"))
        .header("Cookie", cookie.as_str().unwrap_or(""));
    if !body.is_null() {
        r = r.json(&body);
    }
    let response = r.send().await.map_err(|e| e.to_string())?;
    if response.status().as_u16() == 401 {
        state.set_secret("todo", None)?;
        return Err("Your Todolist session expired. Sign in again in Settings.".into());
    }
    let value: Value = response
        .error_for_status()
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    if operation != "list" {
        return Ok(value);
    }
    let lists = value["lists"].as_array().cloned().unwrap_or_default();
    Ok(json!(value["tasks"].as_array().cloned().unwrap_or_default().iter().map(|t|json!({"id":t["id"],"text":t["title"],"done":t["done"],"doneAt":t["doneAt"],"due":t["due"],"time":t["time"],"priority":t["priority"],"status":t["status"],"repeat":t["repeat"],"list":lists.iter().find(|l|l["id"]==t["listId"]).map(|l|text(l,"name")).unwrap_or("")})).collect::<Vec<_>>()))
}

pub async fn art(state: &State, url: &str) -> Result<Value, String> {
    use futures_util::StreamExt;
    let url = url::Url::parse(url).map_err(|e| e.to_string())?;
    if url.scheme() != "https" || !url.host_str().is_some_and(|h| h.ends_with(".mzstatic.com")) {
        return Err("Artwork must come from Apple's artwork service".into());
    }
    let response = state
        .client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        if bytes.len() + chunk.len() > 3_000_000 {
            return Err("Artwork too large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| e.to_string())?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(4096);
    limits.max_image_height = Some(4096);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|e| e.to_string())?
        .thumbnail(192, 192)
        .to_rgb8();
    let mut jpeg = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 85)
        .encode_image(&image)
        .map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(json!(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(jpeg)
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn privileged_http_enforces_transport_and_response_size() {
        let root =
            std::env::temp_dir().join(format!("atoll-http-test-{:x}", rand::random::<u128>()));
        let state = State::new(root.clone()).unwrap();
        assert!(http(&state, "file:///etc/passwd", &json!({}))
            .await
            .is_err());
        assert!(http(&state, "http://example.org", &json!({}))
            .await
            .is_err());
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = server.local_addr().unwrap().port();
        let thread = std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut s, _) = server.accept().unwrap();
            let mut buf = [0; 1024];
            let _ = s.read(&mut buf);
            let _ = s.write_all(
                b"HTTP/1.1 200 OK\r\nContent-Length: 8388609\r\nConnection: close\r\n\r\n",
            );
            let _ = s.write_all(&vec![b'x'; 8388609]);
        });
        assert_eq!(
            http(&state, &format!("http://127.0.0.1:{port}"), &json!({}))
                .await
                .unwrap_err(),
            "Network response too large"
        );
        thread.join().unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
