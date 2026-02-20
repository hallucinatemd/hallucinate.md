import sanitizeHtml from "sanitize-html";

const MAX_TEXT_LENGTH = 200;

const GITHUB_URL_PREFIXES = ["https://github.com/"];
const AVATAR_URL_PREFIXES = [
  "https://avatars.githubusercontent.com/",
  "https://github.com/",
];

/**
 * Strip all HTML tags (via sanitize-html parser), remove unicode escape
 * sequences for angle brackets, strip dangerous characters, and truncate.
 *
 * Entity encoding is NOT done here — that is the responsibility of the
 * Liquid template layer (| escape). This avoids double/triple encoding
 * issues (sanitize-html already encodes &, and | escape would encode again).
 *
 * null/undefined → ""
 */
export function sanitizeText(str) {
  if (str == null) return "";
  if (typeof str !== "string") str = String(str);

  // 1. Strip all HTML tags using sanitize-html (parser-based, not regex).
  //    Default mode discards script/style tags AND their contents.
  //    Output is entity-encoded text (& → &amp;, etc.) — this is the ONLY
  //    encoding layer. The Liquid template must NOT add | escape on top.
  str = sanitizeHtml(str, { allowedTags: [], allowedAttributes: {} });

  // 2. Remove unicode escape sequences for angle brackets (\u003c, \u003e)
  str = str.replace(/\\u003[cC]/g, "");
  str = str.replace(/\\u003[eE]/g, "");

  // 3. Strip any remaining angle brackets (belt and suspenders)
  str = str.replace(/[<>]/g, "");

  // 4. Truncate
  str = str.slice(0, MAX_TEXT_LENGTH);

  return str;
}

/** Allowed hostnames for URL validation */
const ALLOWED_HOSTNAMES = new Set([
  "github.com",
  "avatars.githubusercontent.com",
]);

/**
 * Validate a URL against allowed prefixes AND verify the hostname
 * via URL parsing to prevent userinfo bypass (e.g., github.com@evil.com).
 *
 * null/undefined/non-string → ""
 */
export function sanitizeUrl(str, allowedPrefixes) {
  if (str == null || typeof str !== "string") return "";

  // Prefix check first (fast path rejection)
  const hasPrefix = allowedPrefixes.some((p) => str.startsWith(p));
  if (!hasPrefix) return "";

  // Parse URL and verify hostname to block @-bypass attacks
  try {
    const parsed = new URL(str);
    if (parsed.protocol !== "https:") return "";
    if (!ALLOWED_HOSTNAMES.has(parsed.hostname)) return "";
    if (parsed.username || parsed.password) return "";
  } catch {
    return "";
  }

  return str;
}

/**
 * Ensure stars is a non-negative integer. Fallback to 0.
 */
export function sanitizeStars(val) {
  if (typeof val === "number" && Number.isFinite(val)) {
    return Math.max(0, Math.floor(val));
  }
  return 0;
}

/**
 * Sanitize a single adopter object. Returns a new object with all
 * fields sanitized.
 */
export function sanitizeAdopter(obj) {
  if (!obj || typeof obj !== "object") return null;

  return {
    owner: sanitizeText(obj.owner),
    repo: sanitizeText(obj.repo),
    full_name: sanitizeText(obj.full_name),
    description: sanitizeText(obj.description),
    stars: sanitizeStars(obj.stars),
    language: sanitizeText(obj.language),
    avatar: sanitizeUrl(obj.avatar, AVATAR_URL_PREFIXES),
    url: sanitizeUrl(obj.url, GITHUB_URL_PREFIXES),
    file_url: sanitizeUrl(obj.file_url, GITHUB_URL_PREFIXES),
    file_path: sanitizeText(obj.file_path),
  };
}

/**
 * Sanitize an array of adopter objects. Filters out entries with
 * empty url (indicates invalid/rejected data).
 */
export function sanitizeAdopters(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(sanitizeAdopter).filter((a) => a !== null && a.url !== "");
}
