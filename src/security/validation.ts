/**
 * Input validation utilities for the myExtBot management API.
 *
 * All functions return `null` on success or a human-readable error string on
 * failure, so callers can compose them easily:
 *
 *   const err = validateId(req.body.id);
 *   if (err) { res.status(400).json({ ok: false, error: `id: ${err}` }); return; }
 */

// ── Patterns ──────────────────────────────────────────────────────────────────

/**
 * Allowed pattern for resource slug IDs:
 *   - lowercase a-z, digits 0-9, hyphens allowed in the middle
 *   - must start and end with an alphanumeric character
 *   - handles both single characters (when the optional group is absent)
 *     and multi-character slugs
 */
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/**
 * Maximum allowed lengths for user-supplied strings.
 * Keeping these tight prevents abuse via oversized payloads and database bloat.
 */
export const MAX = {
  /** Resource slug IDs (agent IDs, scene IDs, plugin IDs) */
  id: 64,
  /** Display names */
  name: 128,
  /** Description text */
  description: 1000,
  /** Short skill / capability / constraint strings */
  shortText: 256,
  /** Maximum number of elements allowed in any string[] field */
  arrayLength: 25,
  /** Maximum length of a single URL (plugin manifest, homepage, etc.) */
  url: 2048,
} as const;

// ── Primitive validators ──────────────────────────────────────────────────────

/** Validates a resource slug ID (agent, scene, plugin). */
export function validateId(id: unknown): string | null {
  if (typeof id !== "string" || !id) return "must be a non-empty string";
  if (id.length > MAX.id) return `must be at most ${MAX.id} characters`;
  if (!SLUG_PATTERN.test(id)) {
    return 'must be a lowercase slug (a-z, 0-9, hyphens; cannot start or end with a hyphen)';
  }
  return null;
}

/** Validates a human-readable display name. */
export function validateName(name: unknown): string | null {
  if (typeof name !== "string" || !name.trim()) return "must be a non-empty string";
  if (name.length > MAX.name) return `must be at most ${MAX.name} characters`;
  return null;
}

/** Validates an optional description string. Absent values are accepted. */
export function validateDescription(desc: unknown): string | null {
  if (desc === undefined || desc === null || desc === "") return null;
  if (typeof desc !== "string") return "must be a string";
  if (desc.length > MAX.description) return `must be at most ${MAX.description} characters`;
  return null;
}

/**
 * Validates an optional string[] field (secondarySkills, capabilities,
 * constraints, allowedServices, canDelegateTo, serviceNames, …).
 *
 * @param arr        The value to validate (may be undefined/null — both are OK).
 * @param fieldName  Used in error messages.
 * @param maxItemLen Maximum character length per item (defaults to MAX.shortText).
 */
export function validateStringArray(
  arr: unknown,
  fieldName: string,
  maxItemLen: number = MAX.shortText,
): string | null {
  if (arr === undefined || arr === null) return null;
  if (!Array.isArray(arr)) return `${fieldName} must be an array`;
  if (arr.length > MAX.arrayLength) {
    return `${fieldName} must have at most ${MAX.arrayLength} items`;
  }
  for (let i = 0; i < arr.length; i++) {
    if (typeof arr[i] !== "string") {
      return `${fieldName}[${i}] must be a string`;
    }
    if ((arr[i] as string).length > maxItemLen) {
      return `${fieldName}[${i}] must be at most ${maxItemLen} characters`;
    }
  }
  return null;
}

/**
 * Validates an optional short text field (primarySkill, etc.).
 */
export function validateShortText(val: unknown, fieldName: string): string | null {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val !== "string") return `${fieldName} must be a string`;
  if (val.length > MAX.shortText) return `${fieldName} must be at most ${MAX.shortText} characters`;
  return null;
}

// ── URL / SSRF validation ─────────────────────────────────────────────────────

/**
 * Private / reserved IP and hostname patterns used for SSRF prevention.
 *
 * Plugins are installed by fetching a remote HTTPS manifest.  If an attacker
 * can supply the URL, they could reach internal infrastructure (cloud metadata
 * endpoints, private databases, etc.).  This list blocks the most common
 * classes of SSRF targets.
 */
const PRIVATE_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127\./,                           // IPv4 loopback
  /^10\./,                            // RFC-1918 class A
  /^172\.(1[6-9]|2\d|3[01])\./,      // RFC-1918 class B
  /^192\.168\./,                      // RFC-1918 class C
  /^0\./,                             // this-network
  /^::1$/,                            // IPv6 loopback
  /^fc[\da-f]{2}:/i,                  // IPv6 unique local
  /^fe80:/i,                          // IPv6 link-local
  /^169\.254\./,                      // IPv4 link-local (APIPA)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,  // CGNAT (RFC-6598 100.64.0.0/10)
  /\.local$/i,                        // mDNS hostnames
  /\.internal$/i,                     // GCP / AWS internal
  /^metadata\.google(\.internal)?$/i, // GCP instance metadata
  /^169\.254\.169\.254$/,             // AWS/Azure/GCP instance metadata IPv4
  /^\[?::ffff:169\.254\.169\.254\]?$/, // same address, IPv6-mapped
];

/**
 * Validates a plugin manifest URL.
 *
 * Rules enforced:
 * 1. Must be a syntactically valid URL.
 * 2. Protocol must be `https:` — no plaintext HTTP.
 * 3. Hostname must not resolve to a private, loopback, link-local, or
 *    cloud-metadata address (SSRF prevention).
 *
 * @returns null on success, a human-readable error string on failure.
 */
export function validatePluginUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return "must be a non-empty string";
  if (url.length > MAX.url) return `must be at most ${MAX.url} characters`;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "must be a valid URL";
  }

  if (parsed.protocol !== "https:") {
    return 'must use HTTPS (http:// URLs are not allowed)';
  }

  const hostname = parsed.hostname.toLowerCase();
  for (const pattern of PRIVATE_HOSTNAME_PATTERNS) {
    if (pattern.test(hostname)) {
      return "URL resolves to a private or reserved address — not allowed (SSRF prevention)";
    }
  }

  return null;
}

// ── Composite helpers ─────────────────────────────────────────────────────────

/**
 * Validates all fields that are common to both agent creation and update.
 * Returns a map of fieldName → error string for every invalid field.
 * An empty map means all fields are valid.
 */
export function validateAgentFields(body: Record<string, unknown>): Record<string, string> {
  const errors: Record<string, string> = {};

  const nameErr = body.name !== undefined ? validateName(body.name) : null;
  if (nameErr) errors.name = nameErr;

  const descErr = validateDescription(body.description);
  if (descErr) errors.description = descErr;

  const sceneErr = body.sceneId !== undefined ? validateId(body.sceneId) : null;
  if (sceneErr) errors.sceneId = sceneErr;

  const svcErr = validateStringArray(body.allowedServices, "allowedServices", MAX.id);
  if (svcErr) errors.allowedServices = svcErr;

  const delErr = validateStringArray(body.canDelegateTo, "canDelegateTo", MAX.id);
  if (delErr) errors.canDelegateTo = delErr;

  const psErr = validateShortText(body.primarySkill, "primarySkill");
  if (psErr) errors.primarySkill = psErr;

  const ssErr = validateStringArray(body.secondarySkills, "secondarySkills");
  if (ssErr) errors.secondarySkills = ssErr;

  const capErr = validateStringArray(body.capabilities, "capabilities");
  if (capErr) errors.capabilities = capErr;

  const conErr = validateStringArray(body.constraints, "constraints");
  if (conErr) errors.constraints = conErr;

  return errors;
}

/**
 * Formats a validation error map into a compact, readable string suitable for
 * returning in a 400 response.
 */
export function formatValidationErrors(errors: Record<string, string>): string {
  return Object.entries(errors)
    .map(([field, msg]) => `${field}: ${msg}`)
    .join("; ");
}
