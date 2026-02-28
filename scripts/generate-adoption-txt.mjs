#!/usr/bin/env node

import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const ADOPTERS_PATH = join(ROOT, "_data", "adopters.json");
const OUTPUT_PATH = join(ROOT, "adoption.txt");

// ── Exported helpers for unit testing ──────────────────────────────────────

/**
 * Returns yesterday's date as YYYY-MM-DD in UTC.
 * Accepts an optional Date for deterministic testing.
 */
export function getYesterdayUTC(now = new Date()) {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Filter adopters to those added on a specific date.
 * Returns a new array sorted by stars descending.
 */
export function filterNewAdopters(adopters, dateStr) {
  if (!Array.isArray(adopters)) return [];
  return adopters
    .filter((a) => a && a.date_added === dateStr)
    .sort((a, b) => (b.stars || 0) - (a.stars || 0));
}

/**
 * Assign each adopter a UTC hour for celebration.
 * Distributes evenly across 08:00–20:00 UTC.
 *
 * @param {Array<{full_name: string, stars: number}>} adopters - sorted by stars desc
 * @returns {Array<{full_name: string, stars: number, hour: number}>}
 */
export const CELEBRATE_WINDOW_START = 8;
export const CELEBRATE_WINDOW_END = 20;

export function assignCelebrationHours(adopters) {
  if (!Array.isArray(adopters) || adopters.length === 0) return [];

  const windowSize = CELEBRATE_WINDOW_END - CELEBRATE_WINDOW_START;
  const step = windowSize / adopters.length;

  return adopters.map((a, i) => ({
    full_name: a.full_name,
    stars: a.stars,
    hour: CELEBRATE_WINDOW_START + Math.floor(step * (i + 0.5)),
  }));
}

/**
 * Format the adoption.txt output string.
 *
 * Output:
 *   count: 10
 *   yesterday: 2026-02-27
 *   new_yesterday: 2
 *   celebrate:
 *   - 11 owner/repoA (10★)
 *   - 17 owner/repoB (5★)
 */
export function formatAdoptionTxt(adopters, yesterday) {
  const total = Array.isArray(adopters) ? adopters.length : 0;
  const newYesterday = filterNewAdopters(adopters, yesterday);
  const scheduled = assignCelebrationHours(newYesterday);

  const lines = [
    `count: ${total}`,
    `yesterday: ${yesterday}`,
    `new_yesterday: ${scheduled.length}`,
    "celebrate:",
  ];

  for (const a of scheduled) {
    const hh = String(a.hour).padStart(2, "0");
    lines.push(`- ${hh} ${a.full_name} (${a.stars}★)`);
  }

  return lines.join("\n") + "\n";
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const data = readFileSync(ADOPTERS_PATH, "utf-8");
  const adopters = JSON.parse(data);
  const yesterday = getYesterdayUTC();
  const output = formatAdoptionTxt(adopters, yesterday);

  writeFileSync(OUTPUT_PATH, output);

  const newCount = filterNewAdopters(adopters, yesterday).length;
  console.log(
    `Wrote adoption.txt — ${adopters.length} total, yesterday=${yesterday}, new=${newCount}`,
  );
}

// Only run main() when executed directly (not imported for testing)
const isDirectRun =
  process.argv[1] &&
  fileURLToPath(import.meta.url).endsWith(
    process.argv[1].replace(/^.*[\\/]/, ""),
  );

if (isDirectRun) {
  main();
}
