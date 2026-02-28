import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  getYesterdayUTC,
  filterNewAdopters,
  assignCelebrationHours,
  CELEBRATE_WINDOW_START,
  CELEBRATE_WINDOW_END,
  formatAdoptionTxt,
} from "../scripts/generate-adoption-txt.mjs";

// ─── getYesterdayUTC ─────────────────────────────────────────────────────────

describe("getYesterdayUTC", () => {
  it("returns yesterday for a normal mid-day date", () => {
    assert.equal(
      getYesterdayUTC(new Date("2026-02-28T12:00:00Z")),
      "2026-02-27",
    );
  });

  it("handles month boundary — March 1 → Feb 28", () => {
    assert.equal(
      getYesterdayUTC(new Date("2026-03-01T00:30:00Z")),
      "2026-02-28",
    );
  });

  it("handles year boundary — Jan 1 → Dec 31", () => {
    assert.equal(
      getYesterdayUTC(new Date("2026-01-01T00:30:00Z")),
      "2025-12-31",
    );
  });

  it("handles leap year — March 1 2028 → Feb 29", () => {
    assert.equal(
      getYesterdayUTC(new Date("2028-03-01T00:30:00Z")),
      "2028-02-29",
    );
  });

  it("handles late UTC — 23:59:59", () => {
    assert.equal(
      getYesterdayUTC(new Date("2026-02-28T23:59:59Z")),
      "2026-02-27",
    );
  });

  it("handles early UTC — 00:01:00", () => {
    assert.equal(
      getYesterdayUTC(new Date("2026-02-28T00:01:00Z")),
      "2026-02-27",
    );
  });

  it("handles exactly midnight UTC", () => {
    assert.equal(
      getYesterdayUTC(new Date("2026-02-28T00:00:00Z")),
      "2026-02-27",
    );
  });

  it("returns YYYY-MM-DD format when called without arguments", () => {
    const result = getYesterdayUTC();
    assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
  });
});

// ─── filterNewAdopters ───────────────────────────────────────────────────────

describe("filterNewAdopters", () => {
  const adopters = [
    { full_name: "a/one", stars: 5, date_added: "2026-02-27" },
    { full_name: "b/two", stars: 50, date_added: "2026-02-27" },
    { full_name: "c/three", stars: 10, date_added: "2026-02-27" },
    { full_name: "d/old", stars: 100, date_added: "2026-02-20" },
  ];

  it("returns only adopters matching the given date", () => {
    const result = filterNewAdopters(adopters, "2026-02-27");
    assert.equal(result.length, 3);
    assert.ok(result.every((a) => a.date_added === "2026-02-27"));
  });

  it("sorts by stars descending", () => {
    const result = filterNewAdopters(adopters, "2026-02-27");
    assert.equal(result[0].full_name, "b/two"); // 50★
    assert.equal(result[1].full_name, "c/three"); // 10★
    assert.equal(result[2].full_name, "a/one"); // 5★
  });

  it("returns empty array when no adopters match", () => {
    assert.deepEqual(filterNewAdopters(adopters, "2099-01-01"), []);
  });

  it("returns empty array for empty input", () => {
    assert.deepEqual(filterNewAdopters([], "2026-02-27"), []);
  });

  it("returns empty array for null input", () => {
    assert.deepEqual(filterNewAdopters(null, "2026-02-27"), []);
  });

  it("returns empty array for undefined input", () => {
    assert.deepEqual(filterNewAdopters(undefined, "2026-02-27"), []);
  });

  it("excludes adopters with missing date_added", () => {
    const mixed = [
      { full_name: "a/b", stars: 5 },
      { full_name: "c/d", stars: 3, date_added: "2026-02-27" },
    ];
    const result = filterNewAdopters(mixed, "2026-02-27");
    assert.equal(result.length, 1);
    assert.equal(result[0].full_name, "c/d");
  });

  it("excludes adopters with null date_added", () => {
    const mixed = [
      { full_name: "a/b", stars: 5, date_added: null },
      { full_name: "c/d", stars: 3, date_added: "2026-02-27" },
    ];
    const result = filterNewAdopters(mixed, "2026-02-27");
    assert.equal(result.length, 1);
  });

  it("excludes null/undefined entries in the array", () => {
    const mixed = [
      null,
      undefined,
      { full_name: "c/d", stars: 3, date_added: "2026-02-27" },
    ];
    const result = filterNewAdopters(mixed, "2026-02-27");
    assert.equal(result.length, 1);
  });

  it("handles adopters with zero stars", () => {
    const data = [
      { full_name: "a/b", stars: 0, date_added: "2026-02-27" },
    ];
    const result = filterNewAdopters(data, "2026-02-27");
    assert.equal(result.length, 1);
    assert.equal(result[0].stars, 0);
  });

  it("does not mutate the original array", () => {
    const original = [...adopters];
    filterNewAdopters(adopters, "2026-02-27");
    assert.deepEqual(adopters, original);
  });
});

// ─── assignCelebrationHours ──────────────────────────────────────────────────

describe("assignCelebrationHours", () => {
  it("returns empty array for empty input", () => {
    assert.deepEqual(assignCelebrationHours([]), []);
  });

  it("returns empty array for null input", () => {
    assert.deepEqual(assignCelebrationHours(null), []);
  });

  it("assigns hour 14 for 1 adopter", () => {
    const result = assignCelebrationHours([
      { full_name: "a/b", stars: 5 },
    ]);
    assert.equal(result.length, 1);
    assert.equal(result[0].hour, 14);
    assert.equal(result[0].full_name, "a/b");
    assert.equal(result[0].stars, 5);
  });

  it("assigns hours 11 and 17 for 2 adopters", () => {
    const result = assignCelebrationHours([
      { full_name: "a/b", stars: 10 },
      { full_name: "c/d", stars: 5 },
    ]);
    assert.deepEqual(
      result.map((r) => r.hour),
      [11, 17],
    );
  });

  it("assigns hours 10, 14, 18 for 3 adopters", () => {
    const result = assignCelebrationHours([
      { full_name: "a/b", stars: 30 },
      { full_name: "c/d", stars: 20 },
      { full_name: "e/f", stars: 10 },
    ]);
    assert.deepEqual(
      result.map((r) => r.hour),
      [10, 14, 18],
    );
  });

  it("assigns hours 09, 12, 15, 18 for 4 adopters", () => {
    const result = assignCelebrationHours([
      { full_name: "a/a", stars: 40 },
      { full_name: "b/b", stars: 30 },
      { full_name: "c/c", stars: 20 },
      { full_name: "d/d", stars: 10 },
    ]);
    assert.deepEqual(
      result.map((r) => r.hour),
      [9, 12, 15, 18],
    );
  });

  it("assigns one per hour for 12 adopters", () => {
    const adopters = Array.from({ length: 12 }, (_, i) => ({
      full_name: `owner/repo${i}`,
      stars: 12 - i,
    }));
    const result = assignCelebrationHours(adopters);
    const hours = result.map((r) => r.hour);
    assert.equal(hours.length, 12);
    // Each hour should be unique when n equals window size
    assert.equal(new Set(hours).size, 12);
    // All hours within window
    assert.ok(hours.every((h) => h >= CELEBRATE_WINDOW_START && h < CELEBRATE_WINDOW_END));
  });

  it("keeps hours within window for n > 12", () => {
    const adopters = Array.from({ length: 20 }, (_, i) => ({
      full_name: `owner/repo${i}`,
      stars: 20 - i,
    }));
    const result = assignCelebrationHours(adopters);
    assert.equal(result.length, 20);
    assert.ok(
      result.every(
        (r) => r.hour >= CELEBRATE_WINDOW_START && r.hour < CELEBRATE_WINDOW_END,
      ),
    );
  });

  it("preserves full_name and stars", () => {
    const result = assignCelebrationHours([
      { full_name: "test/repo", stars: 42 },
    ]);
    assert.equal(result[0].full_name, "test/repo");
    assert.equal(result[0].stars, 42);
  });
});

// ─── formatAdoptionTxt ───────────────────────────────────────────────────────

describe("formatAdoptionTxt", () => {
  it("produces correct output with 2 new adopters (with hours)", () => {
    const adopters = [
      { full_name: "a/one", stars: 10, date_added: "2026-02-27" },
      { full_name: "b/two", stars: 5, date_added: "2026-02-27" },
      { full_name: "c/old", stars: 100, date_added: "2026-02-20" },
    ];
    const result = formatAdoptionTxt(adopters, "2026-02-27");
    const expected = [
      "count: 3",
      "yesterday: 2026-02-27",
      "new_yesterday: 2",
      "celebrate:",
      "- 11 a/one (10★)",
      "- 17 b/two (5★)",
      "",
    ].join("\n");
    assert.equal(result, expected);
  });

  it("produces correct output with 0 new adopters", () => {
    const adopters = [
      { full_name: "c/old", stars: 100, date_added: "2026-02-20" },
    ];
    const result = formatAdoptionTxt(adopters, "2026-02-27");
    const expected = [
      "count: 1",
      "yesterday: 2026-02-27",
      "new_yesterday: 0",
      "celebrate:",
      "",
    ].join("\n");
    assert.equal(result, expected);
  });

  it("produces correct output with empty adopters array", () => {
    const result = formatAdoptionTxt([], "2026-02-27");
    assert.ok(result.includes("count: 0"));
    assert.ok(result.includes("new_yesterday: 0"));
  });

  it("ends with a newline", () => {
    const result = formatAdoptionTxt([], "2026-02-27");
    assert.ok(result.endsWith("\n"));
  });

  it("counts total adopters regardless of date", () => {
    const adopters = [
      { full_name: "a/b", stars: 5, date_added: "2026-02-20" },
      { full_name: "c/d", stars: 3, date_added: "2026-02-21" },
      { full_name: "e/f", stars: 1, date_added: "2026-02-27" },
    ];
    const result = formatAdoptionTxt(adopters, "2026-02-27");
    assert.ok(result.includes("count: 3"));
    assert.ok(result.includes("new_yesterday: 1"));
  });

  it("handles adopters with missing date_added gracefully", () => {
    const adopters = [
      { full_name: "a/b", stars: 5 },
      { full_name: "c/d", stars: 3, date_added: "2026-02-27" },
    ];
    const result = formatAdoptionTxt(adopters, "2026-02-27");
    assert.ok(result.includes("count: 2"));
    assert.ok(result.includes("new_yesterday: 1"));
    assert.ok(result.includes("c/d (3★)"));
    assert.ok(!result.includes("a/b"));
  });

  it("uses ★ unicode star symbol", () => {
    const adopters = [
      { full_name: "x/y", stars: 42, date_added: "2026-02-27" },
    ];
    const result = formatAdoptionTxt(adopters, "2026-02-27");
    assert.ok(result.includes("42★"));
  });

  it("zero-pads single-digit hours", () => {
    // 4 adopters → hours 09, 12, 15, 18
    const adopters = [
      { full_name: "a/a", stars: 40, date_added: "2026-02-27" },
      { full_name: "b/b", stars: 30, date_added: "2026-02-27" },
      { full_name: "c/c", stars: 20, date_added: "2026-02-27" },
      { full_name: "d/d", stars: 10, date_added: "2026-02-27" },
    ];
    const result = formatAdoptionTxt(adopters, "2026-02-27");
    assert.ok(result.includes("- 09 a/a (40★)"));
  });

  it("sorts celebrate list by stars descending", () => {
    const adopters = [
      { full_name: "a/low", stars: 1, date_added: "2026-02-27" },
      { full_name: "b/high", stars: 99, date_added: "2026-02-27" },
      { full_name: "c/mid", stars: 10, date_added: "2026-02-27" },
    ];
    const result = formatAdoptionTxt(adopters, "2026-02-27");
    const celebrateLines = result
      .split("\n")
      .filter((l) => l.startsWith("- "));
    assert.ok(celebrateLines[0].includes("b/high (99★)"));
    assert.ok(celebrateLines[1].includes("c/mid (10★)"));
    assert.ok(celebrateLines[2].includes("a/low (1★)"));
  });

  it("handles null adopters array", () => {
    const result = formatAdoptionTxt(null, "2026-02-27");
    assert.ok(result.includes("count: 0"));
    assert.ok(result.includes("new_yesterday: 0"));
  });
});
