#!/usr/bin/env node

import { writeFileSync, readFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { sanitizeAdopters } from "./sanitize.mjs";
import { ghExec, ghSearchCode, ghApiGet } from "./gh.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const OUTPUT = join(ROOT, "_data", "adopters.json");

const RESULT_CAP = 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Exported helpers for unit testing ──────────────────────────────────────

/**
 * The code search query. The REST API code search only supports code-specific
 * qualifiers (filename, extension, language, repo, org, user, path, size).
 * Repo qualifiers like stars: and fork: silently return 0 results.
 *
 * The API caps at 1000 results per query. If adoption exceeds that, we'll
 * need to split by language: or org: — but that's a bridge to cross later.
 */
export const SEARCH_QUERY = "filename:HALLUCINATE.md";

/**
 * The repo where "add-repo" issues are filed.
 */
export const ISSUES_REPO = "hallucinatemd/hallucinate.md";

export const COMMENT_VALID = (nameWithOwner) =>
  `✅ Verified! **${nameWithOwner}** has been added to the [HALLUCINATE.md adopter wall](https://hallucinate.md/#adopters). Please don't delete this issue — it keeps your repo on the wall until GitHub's search index catches up.`;

export const COMMENT_INVALID = (nameWithOwner) =>
  `❌ Could not find a \`HALLUCINATE.md\` file in **${nameWithOwner}**. Please add the file and open a new issue.`;

export const COMMENT_UNPARSEABLE =
  "❌ Could not extract a repository from this issue. Please use the format `owner/repo` or a full GitHub URL and open a new issue.";

/**
 * Parse an issue body to extract a GitHub repo + file path.
 *
 * Accepts two formats (tried in order):
 *  1. Full GitHub blob URL: https://github.com/owner/repo/blob/branch/path/HALLUCINATE.md
 *  2. Shorthand: owner/repo  →  defaults filePath to "HALLUCINATE.md"
 *
 * Returns { nameWithOwner, filePath } or null if nothing parseable is found.
 */
export function parseIssueBody(body) {
  if (!body || typeof body !== "string") return null;

  // 1. Full GitHub blob URL ending in hallucinate.md (case-insensitive)
  const urlMatch = body.match(
    /https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/blob\/[^/\s]+\/(\S+)/,
  );
  if (urlMatch) {
    const rawPath = urlMatch[3].replace(/[),;.'"]+$/, ""); // strip trailing punctuation
    const decoded = decodeURIComponent(rawPath);
    const fileName = decoded.split("/").pop();
    if (/^hallucinate\.md$/i.test(fileName)) {
      return {
        nameWithOwner: `${urlMatch[1]}/${urlMatch[2]}`,
        filePath: decoded,
      };
    }
  }

  // 2. owner/repo shorthand (strip URLs first to avoid false positives)
  const bodyWithoutUrls = body.replace(/https?:\/\/\S+/g, "");
  const repoMatch = bodyWithoutUrls.match(
    /\b([a-zA-Z0-9][-a-zA-Z0-9.]*)\/([a-zA-Z0-9][-a-zA-Z0-9.]*)\b/,
  );
  if (repoMatch) {
    return {
      nameWithOwner: `${repoMatch[1]}/${repoMatch[2]}`,
      filePath: "HALLUCINATE.md",
    };
  }

  return null;
}

/**
 * Merge two arrays of { nameWithOwner, filePath } objects.
 * First array (search results) wins on conflict.
 */
export function mergeResults(searchResults, issueResults) {
  const seen = new Set(searchResults.map((r) => r.nameWithOwner));
  const merged = [...searchResults];

  for (const result of issueResults) {
    if (!seen.has(result.nameWithOwner)) {
      seen.add(result.nameWithOwner);
      merged.push(result);
    }
  }

  return merged;
}

/**
 * Filter search results to exact HALLUCINATE.md filenames (case-insensitive)
 * and deduplicate by repository nameWithOwner.
 *
 * Spam protection: repos appearing more than MAX_FILES_PER_REPO times in
 * raw results are flagged (logged as warnings). They still get one entry
 * (dedup handles that), but the warning helps detect abuse.
 *
 * @param {Array<{path: string, repository: {nameWithOwner: string}}>} results
 * @returns {Array<{nameWithOwner: string, filePath: string}>}
 */
export const MAX_FILES_PER_REPO = 10;

export function filterAndDeduplicate(results) {
  if (!Array.isArray(results)) return [];

  const repoCounts = new Map();
  const seen = new Set();
  const unique = [];

  for (const result of results) {
    if (!result || !result.path || !result.repository?.nameWithOwner) continue;

    const fileName = result.path.split("/").pop();
    if (!/^hallucinate\.md$/i.test(fileName)) continue;

    const nameWithOwner = result.repository.nameWithOwner;

    // Count occurrences per repo for spam detection
    repoCounts.set(nameWithOwner, (repoCounts.get(nameWithOwner) || 0) + 1);

    if (seen.has(nameWithOwner)) continue;
    seen.add(nameWithOwner);

    unique.push({ nameWithOwner, filePath: result.path });
  }

  // Log suspicious repos that appear too many times (spam indicator)
  for (const [repo, count] of repoCounts) {
    if (count > MAX_FILES_PER_REPO) {
      console.warn(
        `  ⚠️  spam? ${repo} has ${count} HALLUCINATE.md files (>${MAX_FILES_PER_REPO} threshold)`,
      );
    }
  }

  return unique;
}

/**
 * Build an adopter entry from GitHub API repo data.
 *
 * @param {object} repo     - GitHub API response for a repo
 * @param {string} filePath - Path to HALLUCINATE.md within the repo
 * @returns {object|null}   - Adopter object, or null if data is invalid
 */
export function buildAdopterEntry(repo, filePath) {
  if (!repo || !repo.owner?.login || !repo.html_url) return null;

  return {
    owner: repo.owner.login,
    repo: repo.name,
    full_name: repo.full_name,
    description: repo.description,
    stars: repo.stargazers_count,
    language: repo.language,
    avatar: repo.owner.avatar_url,
    url: repo.html_url,
    default_branch: repo.default_branch,
    file_url: `${repo.html_url}/blob/${repo.default_branch}/${filePath}`,
    file_path: filePath,
  };
}

/**
 * Fetch all "add-repo" issues (open + closed), parse each body for a repo
 * reference, and verify the HALLUCINATE.md file exists via the contents API.
 *
 * Returns { verified, actions }:
 *  - verified: array of { nameWithOwner, filePath } for repos that pass verification
 *  - actions: array of housekeeping actions for open issues:
 *      { number, type: "close-valid", nameWithOwner }
 *      { number, type: "reject", nameWithOwner?, reason }
 */
export async function loadIssueSubmissions() {
  let issues;
  try {
    console.log(`Fetching "add-repo" issues from ${ISSUES_REPO}...`);
    issues = await ghApiGet(
      `repos/${ISSUES_REPO}/issues?labels=add-repo&state=all&per_page=100`,
    );
  } catch (err) {
    console.warn(`  ⚠️  failed to fetch issues: ${err.message}`);
    return { verified: [], actions: [] };
  }

  if (!Array.isArray(issues) || issues.length === 0) {
    console.log("  → no add-repo issues");
    return { verified: [], actions: [] };
  }

  const openCount = issues.filter((i) => i.state === "open").length;
  const closedCount = issues.length - openCount;
  console.log(`  → ${issues.length} issue(s) (${openCount} open, ${closedCount} closed)`);

  const verified = [];
  const actions = [];
  const seen = new Set();

  for (const issue of issues) {
    const isOpen = issue.state === "open";

    // Try title first, fall back to body if title fails verification
    const candidates = [parseIssueBody(issue.title), parseIssueBody(issue.body)].filter(Boolean);

    if (candidates.length === 0) {
      console.warn(`  ⚠️  issue #${issue.number}: no valid URL or owner/repo found`);
      if (isOpen) {
        actions.push({ number: issue.number, type: "reject", reason: "unparseable" });
      }
      continue;
    }

    let isVerified = false;
    let lastNameWithOwner = candidates[0].nameWithOwner;

    for (const parsed of candidates) {
      lastNameWithOwner = parsed.nameWithOwner;

      // Deduplicate within issue submissions
      if (seen.has(parsed.nameWithOwner)) {
        isVerified = true;
        break;
      }

      // Verify file exists
      try {
        await ghApiGet(`repos/${parsed.nameWithOwner}/contents/${parsed.filePath}`);
        seen.add(parsed.nameWithOwner);
        verified.push(parsed);
        console.log(`  ✓ issue #${issue.number}: ${parsed.nameWithOwner} (verified)`);
        isVerified = true;
        break;
      } catch {
        console.warn(
          `  ✗ issue #${issue.number}: ${parsed.nameWithOwner}/${parsed.filePath} — trying next`,
        );
      }

      await sleep(1000);
    }

    if (isVerified && isOpen) {
      actions.push({ number: issue.number, type: "close-valid", nameWithOwner: lastNameWithOwner });
    } else if (!isVerified) {
      console.warn(`  ✗ issue #${issue.number}: no valid submission found`);
      if (isOpen) {
        actions.push({ number: issue.number, type: "reject", nameWithOwner: lastNameWithOwner, reason: "not-found" });
      }
    }
  }

  return { verified, actions };
}

/**
 * Process housekeeping actions on issues: close valid ones, reject invalid ones.
 * Runs after the adopter list is written so wall updates are never blocked.
 *
 * @param {Array} actions - Actions from loadIssueSubmissions
 * @param {object} [options]
 * @param {Function} [options._ghExec] - Override ghExec for testing
 * @param {Function} [options._sleep]  - Override sleep for testing
 */
export async function processIssueActions(actions, options = {}) {
  if (!actions || actions.length === 0) return;

  const exec = options._ghExec ?? ghExec;
  const sleepFn = options._sleep ?? sleep;

  console.log(`Processing ${actions.length} issue action(s)...`);

  for (const action of actions) {
    try {
      if (action.type === "close-valid") {
        await exec([
          "issue", "comment", String(action.number),
          "--repo", ISSUES_REPO,
          "--body", COMMENT_VALID(action.nameWithOwner),
        ]);
        await exec([
          "issue", "close", String(action.number),
          "--repo", ISSUES_REPO,
        ]);
        console.log(`  ✓ issue #${action.number}: commented + closed`);
      } else if (action.type === "reject") {
        const comment = action.reason === "unparseable"
          ? COMMENT_UNPARSEABLE
          : COMMENT_INVALID(action.nameWithOwner);
        await exec([
          "issue", "comment", String(action.number),
          "--repo", ISSUES_REPO,
          "--body", comment,
        ]);
        await exec([
          "issue", "edit", String(action.number),
          "--repo", ISSUES_REPO,
          "--add-label", "rejected",
          "--remove-label", "add-repo",
        ]);
        await exec([
          "issue", "close", String(action.number),
          "--repo", ISSUES_REPO,
        ]);
        console.log(`  ✓ issue #${action.number}: rejected + closed`);
      }
    } catch (err) {
      console.warn(`  ⚠️  issue #${action.number}: action failed — ${err.message}`);
    }

    await sleepFn(1000);
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // ── 1. Search GitHub for HALLUCINATE.md files ──────────────────────────
  //    Single query — the REST API code search caps at 1000 results.
  //    stars:/fork: are repo qualifiers and break code search silently.
  let searchResults = [];

  try {
    console.log(`Searching: ${SEARCH_QUERY}`);
    const results = await ghSearchCode(SEARCH_QUERY, { limit: RESULT_CAP });
    console.log(`  → ${results.length} results`);
    searchResults = results;

    if (results.length >= RESULT_CAP) {
      console.warn(`  ⚠️  hit ${RESULT_CAP} result cap — some repos may be missing`);
    }
  } catch (err) {
    console.warn(`  → search failed after retries: ${err.message}`);
  }

  console.log(`Total raw results: ${searchResults.length}`);

  // ── 2. Filter and deduplicate search results ──────────────────────────
  const uniqueFromSearch = filterAndDeduplicate(searchResults);
  console.log(`Unique repos from search: ${uniqueFromSearch.length}`);

  // ── 3. Load issue-based submissions ───────────────────────────────────
  const { verified: uniqueFromIssues, actions: issueActions } = await loadIssueSubmissions();
  console.log(`Unique repos from issues: ${uniqueFromIssues.length}`);

  // ── 4. Merge (search wins on conflict) ────────────────────────────────
  const unique = mergeResults(uniqueFromSearch, uniqueFromIssues);
  console.log(`Total unique repos: ${unique.length}`);

  if (unique.length === 0) {
    console.error("No results from any source. Keeping existing adopters.json unchanged.");
    return;
  }

  // ── 5. Fetch repo details with retry + rate limit handling ────────────
  const adopters = [];
  let fetchedCount = 0;
  let failedCount = 0;

  for (const { nameWithOwner, filePath } of unique) {
    try {
      const repo = await ghApiGet(`repos/${nameWithOwner}`);
      const entry = buildAdopterEntry(repo, filePath);
      if (entry) {
        adopters.push(entry);
      }
      fetchedCount++;
    } catch (err) {
      failedCount++;
      console.warn(`  ✗ ${nameWithOwner}: ${err.message}`);
    }

    // Pause between API calls — GitHub's rate limit is 5000/hour for
    // authenticated requests. 1s delay = max ~3600 repos/hour, safe margin.
    await sleep(1000);
  }

  console.log(`Fetched: ${fetchedCount}, Failed: ${failedCount}`);

  // ── 6. Sanitize ──────────────────────────────────────────────────────
  const sanitized = sanitizeAdopters(adopters);

  // ── 7. Preserve date_added from existing data ───────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const existingDates = new Map();
  if (existsSync(OUTPUT)) {
    try {
      const existing = JSON.parse(readFileSync(OUTPUT, "utf-8"));
      for (const entry of existing) {
        if (entry.full_name && entry.date_added) {
          existingDates.set(entry.full_name, entry.date_added);
        }
      }
    } catch { /* first run or corrupt file — all entries get today */ }
  }
  let newCount = 0;
  for (const entry of sanitized) {
    entry.date_added = existingDates.get(entry.full_name) ?? today;
    if (!existingDates.has(entry.full_name)) newCount++;
  }
  if (newCount > 0) console.log(`New adopters: ${newCount} (date_added = ${today})`);

  // ── 8. Sort by stars descending ──────────────────────────────────────
  sanitized.sort((a, b) => b.stars - a.stars);

  // ── 9. Write output ──────────────────────────────────────────────────
  ensureDataDir();
  writeFileSync(OUTPUT, JSON.stringify(sanitized, null, 2) + "\n");

  // ── 10. Summary ───────────────────────────────────────────────────────
  console.log(`Wrote ${sanitized.length} adopters to _data/adopters.json`);

  // ── 11. Housekeep issues (after wall is updated) ──────────────────
  await processIssueActions(issueActions);
}

function ensureDataDir() {
  const dataDir = join(ROOT, "_data");
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}

// Only run main() when executed directly (not imported for testing)
const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(process.argv[1].replace(/^.*[\\/]/, ""));

if (isDirectRun) {
  main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  });
}
