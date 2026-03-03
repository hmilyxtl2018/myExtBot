//! LLM smoke test — exercises the full `llm::complete()` pipeline.
//!
//! # Usage
//!
//! ```bash
//! # From the apps/desktop/src-tauri directory:
//!
//! # OpenAI
//! OPENAI_API_KEY=sk-... cargo run --example llm_smoke
//!
//! # OpenAI-compatible proxy (e.g. xiaoai.plus)
//! OPENAI_API_KEY=sk-... OPENAI_BASE_URL=https://xiaoai.plus OPENAI_MODEL=gpt-4o \
//!   cargo run --example llm_smoke
//!
//! # Anthropic
//! LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-... \
//!   cargo run --example llm_smoke
//!
//! # Ollama (no key required — `ollama serve` must be running)
//! LLM_PROVIDER=ollama cargo run --example llm_smoke
//! ```
//!
//! The example also picks up a `.env` file in the working directory if present.

use myextbot_lib::llm;

#[tokio::main]
async fn main() {
    // Load .env from the working directory (silently ignored if absent).
    dotenvy::dotenv().ok();

    // Initialise human-readable tracing so RUST_LOG=debug shows the request.
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info".into()),
        )
        .init();

    let provider =
        std::env::var("LLM_PROVIDER").unwrap_or_else(|_| "openai".into());
    let model = match provider.to_lowercase().as_str() {
        "anthropic" => std::env::var("ANTHROPIC_MODEL")
            .unwrap_or_else(|_| "claude-3-5-sonnet-20241022".into()),
        "ollama" => std::env::var("OLLAMA_MODEL").unwrap_or_else(|_| "llama3.2".into()),
        _ => std::env::var("OPENAI_MODEL").unwrap_or_else(|_| "gpt-4o".into()),
    };

    println!("╔══════════════════════════════════════════╗");
    println!("║       myExtBot — LLM smoke test           ║");
    println!("╚══════════════════════════════════════════╝");
    println!("  provider : {provider}");
    println!("  model    : {model}");
    println!();
    println!("Sending prompt …");

    match llm::complete("Reply with ONLY this sentence: 'myExtBot smoke test OK'").await {
        Ok(resp) => {
            println!();
            println!("✅  Success!");
            println!("   model    : {}", resp.model);
            println!("   reply    : {}", resp.text.trim());
            println!(
                "   tokens   : {} prompt + {} completion",
                resp.prompt_tokens, resp.completion_tokens
            );
            println!("   latency  : {} ms", resp.duration_ms);
        }
        Err(e) => {
            eprintln!();
            eprintln!("❌  Error: {e}");
            eprintln!();
            eprintln!("Hint: set the required env vars and retry:");
            eprintln!("  OpenAI   → OPENAI_API_KEY=sk-...");
            eprintln!("  Anthropic→ LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-ant-...");
            eprintln!("  Ollama   → LLM_PROVIDER=ollama  (no key needed)");
            std::process::exit(1);
        }
    }
}
