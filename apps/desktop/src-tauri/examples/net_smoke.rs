//! Network tool smoke test — exercises `tools::net::fetch()` against a live
//! public URL without requiring any API key.
//!
//! # Usage
//!
//! ```bash
//! # From the apps/desktop/src-tauri directory:
//! cargo run --example net_smoke
//!
//! # Override the target URL:
//! NET_SMOKE_URL=https://api.github.com cargo run --example net_smoke
//! ```

use myextbot_lib::tools::net;
use serde_json::json;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    let url = std::env::var("NET_SMOKE_URL")
        .unwrap_or_else(|_| "https://httpbin.org/get".into());

    println!("╔══════════════════════════════════════════╗");
    println!("║      myExtBot — net.fetch smoke test      ║");
    println!("╚══════════════════════════════════════════╝");
    println!("  url : {url}");
    println!();
    println!("Sending request …");

    let headers = json!({
        "User-Agent": "myExtBot/0.1 smoke-test"
    });

    match net::fetch(&url, "GET", &headers, None).await {
        Ok(result) => {
            let status = result["status"].as_u64().unwrap_or(0);
            let body   = result["body"].as_str().unwrap_or("");

            println!();
            println!("✅  Success!");
            println!("   HTTP status : {status}");

            // Pretty-print the JSON body if possible, otherwise truncate safely
            // by character boundary (not byte index) to avoid panics on multi-byte
            // sequences.
            let display = if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(body) {
                serde_json::to_string_pretty(&parsed).unwrap_or_else(|_| body.to_string())
            } else {
                let char_count = 300;
                let truncated: String = body.chars().take(char_count).collect();
                let suffix = if body.chars().count() > char_count { "…" } else { "" };
                format!("{truncated}{suffix}")
            };
            println!("   body (first 300 chars):");
            for line in display.lines().take(20) {
                println!("     {line}");
            }
        }
        Err(e) => {
            eprintln!();
            eprintln!("❌  Error: {e}");
            std::process::exit(1);
        }
    }
}
