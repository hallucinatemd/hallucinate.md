/**
 * Integration tests — hit the real GitHub API.
 *
 * These verify the actual pipeline works end-to-end:
 *   search → filter → fetch repo → build entry → sanitize
 *
 * Requires: `gh` CLI authenticated.
 * Rate limits: GitHub code search allows 10 requests/minute.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ghSearchCode, ghApiGet } from "../scripts/gh.mjs";
import {
  SEARCH_QUERY,
  filterAndDeduplicate,
  buildAdopterEntry,
} from "../scripts/scan-adopters.mjs";
import { sanitizeAdopter } from "../scripts/sanitize.mjs";

// ─── Search ──────────────────────────────────────────────────────────────────

describe("GitHub code search (live)", () => {
  it("returns results for the search query", async () => {
    const results = await ghSearchCode(SEARCH_QUERY, { limit: 100 });
    assert.ok(Array.isArray(results), "results is an array");
    assert.ok(results.length > 0, "got at least one result");
  });

  it("every result has path and repository.nameWithOwner", async () => {
    const results = await ghSearchCode(SEARCH_QUERY, { limit: 20 });
    for (const r of results) {
      assert.ok(typeof r.path === "string" && r.path.length > 0, `path: ${r.path}`);
      assert.ok(
        typeof r.repository?.nameWithOwner === "string",
        `nameWithOwner: ${JSON.stringify(r.repository)}`,
      );
    }
  });

  it("results contain at least one exact hallucinate.md match", async () => {
    const results = await ghSearchCode(SEARCH_QUERY, { limit: 100 });
    const exact = results.filter((r) => /^hallucinate\.md$/i.test(r.path.split("/").pop()));
    assert.ok(exact.length > 0, `expected exact matches, got ${exact.length} out of ${results.length}`);
  });
});

// ─── Filter ──────────────────────────────────────────────────────────────────

describe("filterAndDeduplicate with real search results (live)", () => {
  it("filters real results to exact filename matches", async () => {
    const results = await ghSearchCode(SEARCH_QUERY, { limit: 100 });
    const unique = filterAndDeduplicate(results);

    assert.ok(unique.length > 0, "at least one repo after filtering");
    assert.ok(unique.length <= results.length, "filtering reduces or keeps count");

    for (const entry of unique) {
      const fileName = entry.filePath.split("/").pop();
      assert.ok(
        /^hallucinate\.md$/i.test(fileName),
        `expected exact filename, got: ${fileName}`,
      );
    }
  });

  it("known repo inclusivenaming/website is in filtered results", async () => {
    const results = await ghSearchCode(SEARCH_QUERY, { limit: 100 });
    const unique = filterAndDeduplicate(results);
    const found = unique.find((r) => r.nameWithOwner === "inclusivenaming/website");
    assert.ok(found, "inclusivenaming/website should be in results");
    assert.equal(found.filePath, "content/word-lists/tier-3/hallucinate.md");
  });
});

// ─── Repo fetch ──────────────────────────────────────────────────────────────

describe("ghApiGet repos (live)", () => {
  it("fetches a known repo and returns expected fields", async () => {
    const repo = await ghApiGet("repos/inclusivenaming/website");
    assert.equal(repo.full_name, "inclusivenaming/website");
    assert.equal(typeof repo.stargazers_count, "number");
    assert.ok(repo.owner.login);
    assert.ok(repo.html_url.startsWith("https://github.com/"));
    assert.ok(repo.default_branch);
  });
});

// ─── buildAdopterEntry with real data ────────────────────────────────────────

describe("buildAdopterEntry with real API data (live)", () => {
  it("builds a valid adopter entry from a real repo", async () => {
    const repo = await ghApiGet("repos/inclusivenaming/website");
    const entry = buildAdopterEntry(repo, "content/word-lists/tier-3/hallucinate.md");

    assert.equal(entry.owner, "inclusivenaming");
    assert.equal(entry.repo, "website");
    assert.equal(entry.full_name, "inclusivenaming/website");
    assert.equal(typeof entry.stars, "number");
    assert.ok(entry.url.startsWith("https://github.com/"));
    assert.ok(entry.file_url.includes("hallucinate.md"));
    assert.ok(entry.avatar.startsWith("https://"));
  });
});

// ─── Sanitize with real data ─────────────────────────────────────────────────

describe("sanitizeAdopter with real API data (live)", () => {
  it("sanitized entry preserves real data and has all required fields", async () => {
    const repo = await ghApiGet("repos/inclusivenaming/website");
    const entry = buildAdopterEntry(repo, "content/word-lists/tier-3/hallucinate.md");
    const sanitized = sanitizeAdopter(entry);

    assert.ok(sanitized, "sanitized entry is not null");
    assert.ok(sanitized.url.startsWith("https://github.com/"), `url: ${sanitized.url}`);
    assert.ok(sanitized.file_url.startsWith("https://github.com/"), `file_url: ${sanitized.file_url}`);
    assert.ok(sanitized.avatar.startsWith("https://"), `avatar: ${sanitized.avatar}`);
    assert.equal(typeof sanitized.stars, "number");
    assert.ok(sanitized.stars >= 0);
    assert.ok(sanitized.owner.length > 0);
    assert.ok(sanitized.repo.length > 0);
  });
});

// ─── Full pipeline ───────────────────────────────────────────────────────────

describe("full pipeline: search → filter → fetch → build → sanitize (live)", () => {
  it("produces at least one valid adopter end-to-end", async () => {
    // Search
    const results = await ghSearchCode(SEARCH_QUERY, { limit: 100 });
    assert.ok(results.length > 0);

    // Filter
    const unique = filterAndDeduplicate(results);
    assert.ok(unique.length > 0);

    // Fetch first repo + build entry
    const { nameWithOwner, filePath } = unique[0];
    const repo = await ghApiGet(`repos/${nameWithOwner}`);
    const entry = buildAdopterEntry(repo, filePath);
    assert.ok(entry);

    // Sanitize
    const sanitized = sanitizeAdopter(entry);
    assert.ok(sanitized);
    assert.ok(sanitized.url);
    assert.ok(sanitized.owner);
    assert.ok(sanitized.repo);
    assert.equal(typeof sanitized.stars, "number");
  });
});
