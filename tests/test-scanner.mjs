import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  SEARCH_QUERY,
  ISSUES_REPO,
  COMMENT_VALID,
  COMMENT_INVALID,
  COMMENT_UNPARSEABLE,
  filterAndDeduplicate,
  buildAdopterEntry,
  MAX_FILES_PER_REPO,
  parseIssueBody,
  mergeResults,
  processIssueActions,
} from "../scripts/scan-adopters.mjs";

// ─── SEARCH_QUERY ────────────────────────────────────────────────────────────

describe("SEARCH_QUERY", () => {
  it("uses filename: qualifier", () => {
    assert.ok(SEARCH_QUERY.includes("filename:HALLUCINATE.md"));
  });

  it("is a valid code search query (only code-search qualifiers)", () => {
    // The query should be a simple filename search — no repo-specific qualifiers
    assert.equal(SEARCH_QUERY, "filename:HALLUCINATE.md");
  });
});

// ─── filterAndDeduplicate ────────────────────────────────────────────────────

describe("filterAndDeduplicate", () => {
  it("returns empty array for null input", () => {
    assert.deepEqual(filterAndDeduplicate(null), []);
  });

  it("returns empty array for undefined input", () => {
    assert.deepEqual(filterAndDeduplicate(undefined), []);
  });

  it("returns empty array for non-array input", () => {
    assert.deepEqual(filterAndDeduplicate("string"), []);
    assert.deepEqual(filterAndDeduplicate(42), []);
    assert.deepEqual(filterAndDeduplicate({}), []);
  });

  it("returns empty array for empty array input", () => {
    assert.deepEqual(filterAndDeduplicate([]), []);
  });

  it("accepts exact HALLUCINATE.md at root", () => {
    const results = [
      { path: "HALLUCINATE.md", repository: { nameWithOwner: "owner/repo" } },
    ];
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 1);
    assert.equal(unique[0].nameWithOwner, "owner/repo");
    assert.equal(unique[0].filePath, "HALLUCINATE.md");
  });

  it("accepts HALLUCINATE.md in subdirectory", () => {
    const results = [
      { path: "docs/HALLUCINATE.md", repository: { nameWithOwner: "owner/repo" } },
    ];
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 1);
    assert.equal(unique[0].filePath, "docs/HALLUCINATE.md");
  });

  it("accepts case-insensitive filenames", () => {
    const results = [
      { path: "hallucinate.md", repository: { nameWithOwner: "a/b" } },
      { path: "Hallucinate.md", repository: { nameWithOwner: "c/d" } },
      { path: "HALLUCINATE.MD", repository: { nameWithOwner: "e/f" } },
    ];
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 3);
  });

  it("rejects files with hallucinate.md as substring", () => {
    const results = [
      { path: "_posts/2025-11-21-hallucinate.md", repository: { nameWithOwner: "a/b" } },
      { path: "why-language-models-hallucinate.md", repository: { nameWithOwner: "c/d" } },
      { path: "Do not Hallucinate.md", repository: { nameWithOwner: "e/f" } },
      { path: "facebookresearch.low-shot-shrink-hallucinate.md", repository: { nameWithOwner: "g/h" } },
    ];
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 0);
  });

  it("deduplicates by repository nameWithOwner", () => {
    const results = [
      { path: "HALLUCINATE.md", repository: { nameWithOwner: "owner/repo" } },
      { path: "docs/HALLUCINATE.md", repository: { nameWithOwner: "owner/repo" } },
      { path: "src/HALLUCINATE.md", repository: { nameWithOwner: "owner/repo" } },
    ];
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 1);
    // Keeps the first match
    assert.equal(unique[0].filePath, "HALLUCINATE.md");
  });

  it("keeps different repos as separate entries", () => {
    const results = [
      { path: "HALLUCINATE.md", repository: { nameWithOwner: "alice/repo1" } },
      { path: "HALLUCINATE.md", repository: { nameWithOwner: "bob/repo2" } },
      { path: "HALLUCINATE.md", repository: { nameWithOwner: "charlie/repo3" } },
    ];
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 3);
  });

  it("skips results with missing path", () => {
    const results = [
      { path: null, repository: { nameWithOwner: "a/b" } },
      { path: undefined, repository: { nameWithOwner: "c/d" } },
      { path: "", repository: { nameWithOwner: "e/f" } },
    ];
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 0);
  });

  it("skips results with missing repository", () => {
    const results = [
      { path: "HALLUCINATE.md", repository: null },
      { path: "HALLUCINATE.md", repository: {} },
      { path: "HALLUCINATE.md" },
      null,
      undefined,
    ];
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 0);
  });

  it("handles mixed valid and invalid results", () => {
    const results = [
      { path: "HALLUCINATE.md", repository: { nameWithOwner: "valid/repo" } },
      { path: "not-hallucinate.md", repository: { nameWithOwner: "skip/this" } },
      null,
      { path: "docs/HALLUCINATE.md", repository: { nameWithOwner: "also/valid" } },
      { path: "HALLUCINATE.md", repository: null },
    ];
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 2);
    assert.equal(unique[0].nameWithOwner, "valid/repo");
    assert.equal(unique[1].nameWithOwner, "also/valid");
  });

  it("handles large input arrays without blowing up", () => {
    const results = [];
    for (let i = 0; i < 10000; i++) {
      results.push({
        path: "HALLUCINATE.md",
        repository: { nameWithOwner: `owner${i}/repo${i}` },
      });
    }
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 10000);
  });

  it("handles large input with many duplicates", () => {
    const results = [];
    for (let i = 0; i < 6000; i++) {
      results.push({
        path: "HALLUCINATE.md",
        repository: { nameWithOwner: `owner${i % 100}/repo${i % 100}` },
      });
    }
    const unique = filterAndDeduplicate(results);
    assert.equal(unique.length, 100);
  });

  it("still produces one entry for a spammy repo with many files", () => {
    const results = [];
    // Spam repo: 500 HALLUCINATE.md files in different directories
    for (let i = 0; i < 500; i++) {
      results.push({
        path: `dir${i}/HALLUCINATE.md`,
        repository: { nameWithOwner: "spammer/spam-repo" },
      });
    }
    // Legitimate repos
    results.push({ path: "HALLUCINATE.md", repository: { nameWithOwner: "legit/repo1" } });
    results.push({ path: "HALLUCINATE.md", repository: { nameWithOwner: "legit/repo2" } });

    const unique = filterAndDeduplicate(results);
    // Spammer gets exactly 1 entry, not 500
    assert.equal(unique.length, 3);
    assert.equal(unique.filter((r) => r.nameWithOwner === "spammer/spam-repo").length, 1);
  });

  it("MAX_FILES_PER_REPO threshold is reasonable", () => {
    // It's reasonable to have a few HALLUCINATE.md files (root, docs, etc.)
    // but 10+ is suspicious
    assert.ok(MAX_FILES_PER_REPO >= 5, "threshold should allow a few files per repo");
    assert.ok(MAX_FILES_PER_REPO <= 50, "threshold should catch obvious spam");
  });
});

// ─── buildAdopterEntry ───────────────────────────────────────────────────────

describe("buildAdopterEntry", () => {
  const MOCK_REPO = {
    owner: { login: "testowner", avatar_url: "https://avatars.githubusercontent.com/u/123?v=4" },
    name: "testrepo",
    full_name: "testowner/testrepo",
    description: "A test repository",
    stargazers_count: 42,
    language: "JavaScript",
    html_url: "https://github.com/testowner/testrepo",
    default_branch: "main",
  };

  it("builds correct entry for root-level file", () => {
    const entry = buildAdopterEntry(MOCK_REPO, "HALLUCINATE.md");
    assert.equal(entry.owner, "testowner");
    assert.equal(entry.repo, "testrepo");
    assert.equal(entry.full_name, "testowner/testrepo");
    assert.equal(entry.description, "A test repository");
    assert.equal(entry.stars, 42);
    assert.equal(entry.language, "JavaScript");
    assert.equal(entry.avatar, "https://avatars.githubusercontent.com/u/123?v=4");
    assert.equal(entry.url, "https://github.com/testowner/testrepo");
    assert.equal(entry.default_branch, "main");
    assert.equal(entry.file_url, "https://github.com/testowner/testrepo/blob/main/HALLUCINATE.md");
    assert.equal(entry.file_path, "HALLUCINATE.md");
  });

  it("builds correct file_url for nested file", () => {
    const entry = buildAdopterEntry(MOCK_REPO, "docs/HALLUCINATE.md");
    assert.equal(entry.file_url, "https://github.com/testowner/testrepo/blob/main/docs/HALLUCINATE.md");
    assert.equal(entry.file_path, "docs/HALLUCINATE.md");
  });

  it("handles non-main default branch", () => {
    const repo = { ...MOCK_REPO, default_branch: "master" };
    const entry = buildAdopterEntry(repo, "HALLUCINATE.md");
    assert.equal(entry.file_url, "https://github.com/testowner/testrepo/blob/master/HALLUCINATE.md");
  });

  it("returns null for null input", () => {
    assert.equal(buildAdopterEntry(null, "HALLUCINATE.md"), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(buildAdopterEntry(undefined, "HALLUCINATE.md"), null);
  });

  it("returns null for repo missing owner", () => {
    const repo = { ...MOCK_REPO, owner: null };
    assert.equal(buildAdopterEntry(repo, "HALLUCINATE.md"), null);
  });

  it("returns null for repo missing owner.login", () => {
    const repo = { ...MOCK_REPO, owner: {} };
    assert.equal(buildAdopterEntry(repo, "HALLUCINATE.md"), null);
  });

  it("returns null for repo missing html_url", () => {
    const repo = { ...MOCK_REPO, html_url: null };
    assert.equal(buildAdopterEntry(repo, "HALLUCINATE.md"), null);
  });

  it("preserves null description", () => {
    const repo = { ...MOCK_REPO, description: null };
    const entry = buildAdopterEntry(repo, "HALLUCINATE.md");
    assert.equal(entry.description, null);
  });

  it("preserves null language", () => {
    const repo = { ...MOCK_REPO, language: null };
    const entry = buildAdopterEntry(repo, "HALLUCINATE.md");
    assert.equal(entry.language, null);
  });

  it("preserves zero stars", () => {
    const repo = { ...MOCK_REPO, stargazers_count: 0 };
    const entry = buildAdopterEntry(repo, "HALLUCINATE.md");
    assert.equal(entry.stars, 0);
  });
});

// ─── parseIssueBody ─────────────────────────────────────────────────────────

describe("parseIssueBody", () => {
  it("returns null for null input", () => {
    assert.equal(parseIssueBody(null), null);
  });

  it("returns null for undefined input", () => {
    assert.equal(parseIssueBody(undefined), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseIssueBody(""), null);
  });

  it("returns null for non-string input", () => {
    assert.equal(parseIssueBody(42), null);
    assert.equal(parseIssueBody({}), null);
  });

  it("returns null for body with no matching pattern", () => {
    assert.equal(parseIssueBody("hello world, please add my repo"), null);
  });

  // ── Full URL format ──

  it("parses full GitHub blob URL at root", () => {
    const body = "https://github.com/myorg/myrepo/blob/main/HALLUCINATE.md";
    const result = parseIssueBody(body);
    assert.deepEqual(result, {
      nameWithOwner: "myorg/myrepo",
      filePath: "HALLUCINATE.md",
    });
  });

  it("parses full GitHub blob URL in subdirectory", () => {
    const body = "https://github.com/alice/project/blob/main/docs/HALLUCINATE.md";
    const result = parseIssueBody(body);
    assert.deepEqual(result, {
      nameWithOwner: "alice/project",
      filePath: "docs/HALLUCINATE.md",
    });
  });

  it("parses URL with master branch", () => {
    const body = "https://github.com/bob/repo/blob/master/HALLUCINATE.md";
    const result = parseIssueBody(body);
    assert.deepEqual(result, {
      nameWithOwner: "bob/repo",
      filePath: "HALLUCINATE.md",
    });
  });

  it("parses URL with non-standard branch", () => {
    const body = "https://github.com/org/repo/blob/develop/HALLUCINATE.md";
    const result = parseIssueBody(body);
    assert.equal(result.nameWithOwner, "org/repo");
  });

  it("handles case-insensitive filename in URL", () => {
    const body = "https://github.com/a/b/blob/main/hallucinate.md";
    const result = parseIssueBody(body);
    assert.equal(result.nameWithOwner, "a/b");
    assert.equal(result.filePath, "hallucinate.md");
  });

  it("handles URL-encoded path", () => {
    const body = "https://github.com/a/b/blob/main/docs%2FHALLUCINATE.md";
    const result = parseIssueBody(body);
    assert.equal(result.nameWithOwner, "a/b");
    assert.equal(result.filePath, "docs/HALLUCINATE.md");
  });

  it("strips trailing punctuation from URL", () => {
    const body = "Check this: https://github.com/a/b/blob/main/HALLUCINATE.md.";
    // The period after .md is tricky — the regex captures it, but we strip trailing punctuation
    // .md. → after stripping trailing "." → .md — but filename check: "HALLUCINATE.md" ✓
    const result = parseIssueBody(body);
    assert.equal(result.nameWithOwner, "a/b");
  });

  it("ignores URL pointing to non-HALLUCINATE.md file", () => {
    const body = "https://github.com/a/b/blob/main/README.md";
    assert.equal(parseIssueBody(body), null);
  });

  it("extracts URL from surrounded text", () => {
    const body =
      "### Link to your HALLUCINATE.md file\n\nhttps://github.com/cool/project/blob/main/HALLUCINATE.md\n\nThanks!";
    const result = parseIssueBody(body);
    assert.equal(result.nameWithOwner, "cool/project");
  });

  // ── owner/repo shorthand ──

  it("parses simple owner/repo", () => {
    const body = "myorg/myrepo";
    const result = parseIssueBody(body);
    assert.deepEqual(result, {
      nameWithOwner: "myorg/myrepo",
      filePath: "HALLUCINATE.md",
    });
  });

  it("parses owner/repo with hyphens and dots", () => {
    const body = "my-org/my.repo";
    const result = parseIssueBody(body);
    assert.deepEqual(result, {
      nameWithOwner: "my-org/my.repo",
      filePath: "HALLUCINATE.md",
    });
  });

  it("parses owner/repo from surrounding text", () => {
    const body = "Please add cool-org/cool-repo to the list";
    const result = parseIssueBody(body);
    assert.equal(result.nameWithOwner, "cool-org/cool-repo");
    assert.equal(result.filePath, "HALLUCINATE.md");
  });

  it("does not match owner/repo from a URL (URL regex takes priority or URLs are stripped)", () => {
    // A non-HALLUCINATE.md URL is present, but no valid HALLUCINATE.md URL
    // owner/repo extraction should not pick up parts of the URL
    const body = "https://github.com/a/b/blob/main/README.md";
    // URL doesn't end in HALLUCINATE.md → null from URL check
    // URLs stripped → remaining text has no owner/repo
    assert.equal(parseIssueBody(body), null);
  });

  // ── Priority: URL wins over shorthand ──

  it("prefers full URL over shorthand when both present", () => {
    const body =
      "owner1/repo1\nhttps://github.com/owner2/repo2/blob/main/HALLUCINATE.md";
    const result = parseIssueBody(body);
    // URL is tried first
    assert.equal(result.nameWithOwner, "owner2/repo2");
    assert.equal(result.filePath, "HALLUCINATE.md");
  });
});

// ─── mergeResults ───────────────────────────────────────────────────────────

describe("mergeResults", () => {
  it("returns search results when no issue results", () => {
    const search = [{ nameWithOwner: "a/b", filePath: "HALLUCINATE.md" }];
    const merged = mergeResults(search, []);
    assert.deepEqual(merged, search);
  });

  it("returns issue results when no search results", () => {
    const issues = [{ nameWithOwner: "a/b", filePath: "HALLUCINATE.md" }];
    const merged = mergeResults([], issues);
    assert.deepEqual(merged, issues);
  });

  it("deduplicates by nameWithOwner (search wins)", () => {
    const search = [{ nameWithOwner: "a/b", filePath: "HALLUCINATE.md" }];
    const issues = [{ nameWithOwner: "a/b", filePath: "docs/HALLUCINATE.md" }];
    const merged = mergeResults(search, issues);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].filePath, "HALLUCINATE.md"); // search version
  });

  it("combines unique repos from both sources", () => {
    const search = [{ nameWithOwner: "a/b", filePath: "HALLUCINATE.md" }];
    const issues = [{ nameWithOwner: "c/d", filePath: "HALLUCINATE.md" }];
    const merged = mergeResults(search, issues);
    assert.equal(merged.length, 2);
  });

  it("handles empty inputs", () => {
    assert.deepEqual(mergeResults([], []), []);
  });

  it("does not modify original arrays", () => {
    const search = [{ nameWithOwner: "a/b", filePath: "HALLUCINATE.md" }];
    const issues = [{ nameWithOwner: "c/d", filePath: "HALLUCINATE.md" }];
    mergeResults(search, issues);
    assert.equal(search.length, 1);
    assert.equal(issues.length, 1);
  });
});

// ─── Comment templates ──────────────────────────────────────────────────────

describe("comment templates", () => {
  it("COMMENT_VALID includes repo name and adopter wall link", () => {
    const msg = COMMENT_VALID("alice/repo");
    assert.ok(msg.includes("alice/repo"));
    assert.ok(msg.includes("https://hallucinate.md/#adopters"));
    assert.ok(msg.includes("don't delete this issue"));
  });

  it("COMMENT_INVALID includes repo name", () => {
    const msg = COMMENT_INVALID("bob/missing");
    assert.ok(msg.includes("bob/missing"));
    assert.ok(msg.includes("HALLUCINATE.md"));
  });

  it("COMMENT_UNPARSEABLE is a string with instructions", () => {
    assert.equal(typeof COMMENT_UNPARSEABLE, "string");
    assert.ok(COMMENT_UNPARSEABLE.includes("owner/repo"));
  });
});

// ─── processIssueActions ────────────────────────────────────────────────────

describe("processIssueActions", () => {
  it("does nothing for empty actions", async () => {
    const calls = [];
    const mockExec = async (args) => calls.push(args);
    await processIssueActions([], { _ghExec: mockExec, _sleep: () => {} });
    assert.equal(calls.length, 0);
  });

  it("does nothing for null actions", async () => {
    const calls = [];
    const mockExec = async (args) => calls.push(args);
    await processIssueActions(null, { _ghExec: mockExec, _sleep: () => {} });
    assert.equal(calls.length, 0);
  });

  it("comments and closes valid issues", async () => {
    const calls = [];
    const mockExec = async (args) => calls.push(args);
    const actions = [{ number: 1, type: "close-valid", nameWithOwner: "alice/repo" }];

    await processIssueActions(actions, { _ghExec: mockExec, _sleep: () => {} });

    assert.equal(calls.length, 2);
    // First call: comment
    assert.deepEqual(calls[0].slice(0, 3), ["issue", "comment", "1"]);
    assert.ok(calls[0].includes("--repo"));
    assert.ok(calls[0].includes(ISSUES_REPO));
    // Body contains the valid comment
    const bodyIdx = calls[0].indexOf("--body");
    assert.ok(calls[0][bodyIdx + 1].includes("alice/repo"));

    // Second call: close
    assert.deepEqual(calls[1].slice(0, 3), ["issue", "close", "1"]);
  });

  it("comments, relabels, and closes rejected issues (not-found)", async () => {
    const calls = [];
    const mockExec = async (args) => calls.push(args);
    const actions = [{ number: 5, type: "reject", nameWithOwner: "bob/gone", reason: "not-found" }];

    await processIssueActions(actions, { _ghExec: mockExec, _sleep: () => {} });

    assert.equal(calls.length, 3);
    // Comment with invalid message
    assert.deepEqual(calls[0].slice(0, 3), ["issue", "comment", "5"]);
    const bodyIdx = calls[0].indexOf("--body");
    assert.ok(calls[0][bodyIdx + 1].includes("bob/gone"));

    // Relabel
    assert.deepEqual(calls[1].slice(0, 3), ["issue", "edit", "5"]);
    assert.ok(calls[1].includes("--add-label"));
    assert.ok(calls[1].includes("rejected"));
    assert.ok(calls[1].includes("--remove-label"));
    assert.ok(calls[1].includes("add-repo"));

    // Close
    assert.deepEqual(calls[2].slice(0, 3), ["issue", "close", "5"]);
  });

  it("uses unparseable comment for unparseable rejections", async () => {
    const calls = [];
    const mockExec = async (args) => calls.push(args);
    const actions = [{ number: 9, type: "reject", reason: "unparseable" }];

    await processIssueActions(actions, { _ghExec: mockExec, _sleep: () => {} });

    assert.equal(calls.length, 3);
    const bodyIdx = calls[0].indexOf("--body");
    assert.equal(calls[0][bodyIdx + 1], COMMENT_UNPARSEABLE);
  });

  it("continues processing after a failed action", async () => {
    let callCount = 0;
    const mockExec = async () => {
      callCount++;
      if (callCount === 1) throw new Error("network error");
    };
    const actions = [
      { number: 1, type: "close-valid", nameWithOwner: "a/b" },
      { number: 2, type: "close-valid", nameWithOwner: "c/d" },
    ];

    await processIssueActions(actions, { _ghExec: mockExec, _sleep: () => {} });
    // First action fails on comment (call 1), second action succeeds (calls 2-3)
    assert.equal(callCount, 3);
  });

  it("processes multiple actions in sequence", async () => {
    const calls = [];
    const mockExec = async (args) => calls.push(args);
    const actions = [
      { number: 1, type: "close-valid", nameWithOwner: "a/b" },
      { number: 2, type: "reject", nameWithOwner: "c/d", reason: "not-found" },
    ];

    await processIssueActions(actions, { _ghExec: mockExec, _sleep: () => {} });

    // 2 calls for close-valid + 3 calls for reject = 5
    assert.equal(calls.length, 5);
  });
});
