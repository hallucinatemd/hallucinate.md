import { execFile } from "node:child_process";

const DEFAULT_RETRIES = 5;
const DEFAULT_BASE_DELAY_MS = 2000;
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Run a `gh` CLI command with exponential backoff retry.
 *
 * Retries on:
 *  - exit code != 0 (rate limit, network, transient server errors)
 *  - stderr contains "rate limit", "secondary rate limit", "abuse detection"
 *
 * @param {string[]} args        - Arguments passed to `gh`
 * @param {object}   [options]
 * @param {number}   [options.retries=5]          - Max retry attempts
 * @param {number}   [options.baseDelayMs=2000]   - Base delay (doubled each retry)
 * @param {number}   [options.timeoutMs=30000]    - Per-invocation timeout
 * @param {Function} [options._exec]              - Override exec for testing
 * @param {Function} [options._sleep]             - Override sleep for testing
 * @returns {Promise<string>} stdout
 */
export async function ghExec(args, options = {}) {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseDelay = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const exec = options._exec ?? execGh;
  const sleepFn = options._sleep ?? sleep;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = baseDelay * Math.pow(2, attempt - 1) + jitter(500);
      console.log(`  ⏳ retry ${attempt}/${retries} in ${Math.round(delay)}ms...`);
      await sleepFn(delay);
    }

    try {
      const stdout = await exec(args, timeout);
      return stdout;
    } catch (err) {
      lastError = err;

      if (isRateLimitError(err)) {
        const waitMs = parseRetryAfter(err.stderr) ?? baseDelay * Math.pow(2, attempt);
        console.warn(`  ⚠️  rate limited, waiting ${Math.round(waitMs)}ms...`);
        await sleepFn(waitMs);
        continue;
      }

      // Non-retryable errors: bad args, auth failure, 404
      if (isNonRetryable(err)) {
        throw err;
      }

      // Transient errors: retry
      continue;
    }
  }

  throw lastError;
}

/**
 * Convenience: `gh search code <query> --json repository,path --limit <n>`
 */
export async function ghSearchCode(query, { limit = 1000, ...opts } = {}) {
  const raw = await ghExec(
    ["search", "code", query, "--json", "repository,path", "--limit", String(limit)],
    opts,
  );
  return JSON.parse(raw);
}

/**
 * Convenience: `gh api <endpoint>`
 */
export async function ghApiGet(endpoint, opts = {}) {
  const raw = await ghExec(["api", endpoint], opts);
  return JSON.parse(raw);
}

// ── Internal helpers (exported for testing) ──────────────────────────────────

export function execGh(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile("gh", args, { encoding: "utf-8", timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr || "";
        err.stdout = stdout || "";
        reject(err);
      } else {
        resolve(stdout);
      }
    });
  });
}

export function isRateLimitError(err) {
  const msg = ((err.stderr || "") + (err.message || "")).toLowerCase();
  return (
    msg.includes("rate limit") ||
    msg.includes("secondary rate limit") ||
    msg.includes("abuse detection") ||
    msg.includes("retry-after") ||
    msg.includes("403") ||
    msg.includes("429")
  );
}

export function isNonRetryable(err) {
  const msg = ((err.stderr || "") + (err.message || "")).toLowerCase();
  return (
    msg.includes("404") ||
    msg.includes("not found") ||
    msg.includes("authentication") ||
    msg.includes("bad credentials") ||
    msg.includes("401")
  );
}

export function parseRetryAfter(stderr) {
  if (!stderr) return null;
  const match = stderr.match(/retry[- ]after[:\s]+(\d+)/i);
  if (match) return parseInt(match[1], 10) * 1000;
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(maxMs) {
  return Math.random() * maxMs;
}
