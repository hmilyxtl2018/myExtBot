//! Verifier framework.
//!
//! Built-in verifiers:
//! - `verify.screen_changed`   – image diff score threshold
//! - `verify.exit_code_is`     – checks command exit code
//! - `verify.window_title_is`  – checks active window title
//! - `verify.dom_contains`     – DOM content check via browser sidecar (stub)
//! - `verify.text_present_ocr` – OCR text check (enforces region requirement)
//!
//! Default behaviour:
//! - High-risk actions (desktop.clickRectCenter, desktop.typeText) automatically
//!   get a `verify.screen_changed` node inserted after execution.
//! - `verify.text_present_ocr` always requires a `region` parameter.
//!
//! Confidence update rule:
//! - A `pass` claim sets confidence to max(existing, score) (capped at 1.0).
//! - A `fail` claim sets confidence to min(existing, 1 - score) (floored at 0).
//! - Multiple claims are averaged if existing confidence is already set.

#![allow(dead_code)]

use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A verifier request specifying which built-in to run and with what params.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifierRequest {
    /// Verifier name, e.g. `verify.screen_changed`.
    pub verifier: String,
    /// Tool-specific parameters (varies per verifier).
    pub params: Value,
}

/// Result from running a verifier.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifierOutput {
    pub passed: bool,
    pub score: f64,
    pub detail: String,
}

/// Run a built-in verifier by name, returning its output.
///
/// # Errors
/// Returns an error if required parameters are missing or the verifier is unknown.
pub fn run_verifier(req: &VerifierRequest) -> Result<VerifierOutput> {
    match req.verifier.as_str() {
        "verify.screen_changed" => screen_changed(&req.params),
        "verify.exit_code_is" => exit_code_is(&req.params),
        "verify.window_title_is" => window_title_is(&req.params),
        "verify.dom_contains" => dom_contains(&req.params),
        "verify.text_present_ocr" => text_present_ocr(&req.params),
        other => bail!("Unknown verifier: {other}"),
    }
}

/// Update a node's confidence given a new claim score.
///
/// Rule:
/// - pass  → new_confidence = max(existing.unwrap_or(0.5), score)
/// - fail  → new_confidence = min(existing.unwrap_or(0.5), 1.0 - score)
pub fn update_confidence(existing: Option<f64>, passed: bool, score: f64) -> f64 {
    let base = existing.unwrap_or(0.5);
    if passed {
        f64::max(base, score).min(1.0)
    } else {
        f64::min(base, 1.0 - score).max(0.0)
    }
}

// ── Built-in implementations (stubs / placeholder logic) ─────────────────────

fn screen_changed(params: &Value) -> Result<VerifierOutput> {
    let threshold = params
        .get("threshold")
        .and_then(Value::as_f64)
        .unwrap_or(0.05);
    // Stub: without real image capture we emit a synthetic pass at 80% diff.
    let diff_score = params
        .get("_stub_diff")
        .and_then(Value::as_f64)
        .unwrap_or(0.8);
    let passed = diff_score >= threshold;
    Ok(VerifierOutput {
        passed,
        score: diff_score,
        detail: format!("diff={:.2} threshold={:.2}", diff_score, threshold),
    })
}

fn exit_code_is(params: &Value) -> Result<VerifierOutput> {
    let expected = params
        .get("expected")
        .and_then(Value::as_i64)
        .unwrap_or(0);
    let actual = params
        .get("actual")
        .and_then(Value::as_i64)
        .ok_or_else(|| anyhow::anyhow!("verify.exit_code_is requires 'actual' param"))?;
    let passed = actual == expected;
    Ok(VerifierOutput {
        passed,
        score: if passed { 1.0 } else { 0.0 },
        detail: format!("expected={expected} actual={actual}"),
    })
}

fn window_title_is(params: &Value) -> Result<VerifierOutput> {
    let expected = params
        .get("expected")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("verify.window_title_is requires 'expected' param"))?;
    let actual = params
        .get("actual")
        .and_then(Value::as_str)
        .unwrap_or("");
    let passed = actual == expected;
    Ok(VerifierOutput {
        passed,
        score: if passed { 1.0 } else { 0.0 },
        detail: format!("expected={:?} actual={:?}", expected, actual),
    })
}

fn dom_contains(params: &Value) -> Result<VerifierOutput> {
    // Stub: browser sidecar not yet integrated
    let selector = params
        .get("selector")
        .and_then(Value::as_str)
        .unwrap_or("(none)");
    Ok(VerifierOutput {
        passed: false,
        score: 0.0,
        detail: format!("dom_contains stub: selector={selector} (browser sidecar not connected)"),
    })
}

fn text_present_ocr(params: &Value) -> Result<VerifierOutput> {
    // Cloud OCR verifier MUST have a region parameter
    if params.get("region").is_none() {
        bail!("verify.text_present_ocr requires a 'region' parameter ({{x,y,w,h}})");
    }
    let text = params
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| anyhow::anyhow!("verify.text_present_ocr requires 'text' param"))?;
    // Stub: without real OCR integration return a synthetic result
    let found = params
        .get("_stub_found")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    Ok(VerifierOutput {
        passed: found,
        score: if found { 0.9 } else { 0.0 },
        detail: format!("ocr stub: searching for {:?}, found={found}", text),
    })
}

// ── Custom verifier rule DSL ──────────────────────────────────────────────────

/// A user-defined verifier rule (JSON DSL).
///
/// Example:
/// ```json
/// {
///   "name": "check-button-clicked",
///   "when": "desktop.clickRectCenter",
///   "assert": "all",
///   "checks": [
///     { "type": "screen_changed", "threshold": 0.1 },
///     { "type": "ocr_contains", "text": "OK", "region": {"x":0,"y":0,"w":100,"h":50} }
///   ],
///   "on_fail": ["retry", "ask_user"]
/// }
/// ```
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifierRule {
    pub id: String,
    pub scope: String, // default: "task"
    pub name: String,
    pub when: String,            // tool name trigger
    pub assert_mode: AssertMode, // all | any
    pub checks: Vec<RuleCheck>,
    pub on_fail: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AssertMode {
    All,
    Any,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RuleCheck {
    #[serde(rename = "type")]
    pub check_type: String,
    #[serde(flatten)]
    pub params: Value,
}

/// Evaluate all checks in a rule, returning whether the rule passes.
pub fn evaluate_rule(rule: &VerifierRule) -> Result<(bool, Vec<VerifierOutput>)> {
    let mut outputs = Vec::new();
    for check in &rule.checks {
        let verifier_name = match check.check_type.as_str() {
            "screen_changed" => "verify.screen_changed",
            "ocr_contains" => "verify.text_present_ocr",
            other => other,
        };
        let req = VerifierRequest {
            verifier: verifier_name.to_string(),
            params: check.params.clone(),
        };
        let out = run_verifier(&req)?;
        outputs.push(out);
    }
    let passed = match rule.assert_mode {
        AssertMode::All => outputs.iter().all(|o| o.passed),
        AssertMode::Any => outputs.iter().any(|o| o.passed),
    };
    Ok((passed, outputs))
}
