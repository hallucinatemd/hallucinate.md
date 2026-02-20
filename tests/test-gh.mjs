import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  ghExec,
  isRateLimitError,
  isNonRetryable,
  parseRetryAfter,
} from "../scripts/gh.mjs";

// Suppress console output during tests
const noop = () => {};
const hushConsole = { log: noop, warn: noop, error: noop };

/** No-op sleep so tests run instantly */
const instantSleep = () => Promise.resolve();

/** Create a mock exec that fails N times then succeeds */
function mockExec(failCount, { stderr = "transient error", stdout = "ok" } = {}) {
  let calls = 0;
  const fn = async () => {
    calls++;
    if (calls <= failCount) {
      const err = new Error(stderr);
      err.stderr = stderr;
      err.stdout = "";
      throw err;
    }
    return stdout;
  };
  fn.callCount = () => calls;
  return fn;
}

/** Create a mock exec that always fails with a specific error */
function alwaysFail(stderr) {
  let calls = 0;
  const fn = async () => {
    calls++;
    const err = new Error(stderr);
    err.stderr = stderr;
    err.stdout = "";
    throw err;
  };
  fn.callCount = () => calls;
  return fn;
}

// ─── isRateLimitError ────────────────────────────────────────────────────────

describe("isRateLimitError", () => {
  it("detects 'rate limit' in stderr", () => {
    assert.ok(isRateLimitError({ stderr: "API rate limit exceeded", message: "" }));
  });

  it("detects 'secondary rate limit'", () => {
    assert.ok(isRateLimitError({ stderr: "secondary rate limit", message: "" }));
  });

  it("detects 'abuse detection'", () => {
    assert.ok(isRateLimitError({ stderr: "abuse detection mechanism", message: "" }));
  });

  it("detects 'retry-after' header mention", () => {
    assert.ok(isRateLimitError({ stderr: "Retry-After: 60", message: "" }));
  });

  it("detects '403' status", () => {
    assert.ok(isRateLimitError({ stderr: "HTTP 403", message: "" }));
  });

  it("detects rate limit in message (not just stderr)", () => {
    assert.ok(isRateLimitError({ stderr: "", message: "API rate limit exceeded" }));
  });

  it("returns false for normal errors", () => {
    assert.ok(!isRateLimitError({ stderr: "something went wrong", message: "fail" }));
  });

  it("returns false for 404", () => {
    assert.ok(!isRateLimitError({ stderr: "HTTP 404", message: "" }));
  });

  it("handles missing stderr/message", () => {
    assert.ok(!isRateLimitError({}));
    assert.ok(!isRateLimitError({ stderr: undefined, message: undefined }));
  });
});

// ─── isNonRetryable ──────────────────────────────────────────────────────────

describe("isNonRetryable", () => {
  it("detects 404", () => {
    assert.ok(isNonRetryable({ stderr: "HTTP 404", message: "" }));
  });

  it("detects 'not found'", () => {
    assert.ok(isNonRetryable({ stderr: "Could not resolve to a Repository. Not Found", message: "" }));
  });

  it("detects 'authentication'", () => {
    assert.ok(isNonRetryable({ stderr: "authentication required", message: "" }));
  });

  it("detects 'bad credentials'", () => {
    assert.ok(isNonRetryable({ stderr: "Bad credentials", message: "" }));
  });

  it("detects 401", () => {
    assert.ok(isNonRetryable({ stderr: "HTTP 401", message: "" }));
  });

  it("returns false for transient errors", () => {
    assert.ok(!isNonRetryable({ stderr: "connection reset", message: "" }));
  });

  it("returns false for rate limits", () => {
    assert.ok(!isNonRetryable({ stderr: "rate limit exceeded", message: "" }));
  });

  it("handles missing stderr/message", () => {
    assert.ok(!isNonRetryable({}));
  });
});

// ─── parseRetryAfter ─────────────────────────────────────────────────────────

describe("parseRetryAfter", () => {
  it("parses 'Retry-After: 60' → 60000ms", () => {
    assert.equal(parseRetryAfter("Retry-After: 60"), 60000);
  });

  it("parses 'retry-after: 30' (lowercase) → 30000ms", () => {
    assert.equal(parseRetryAfter("retry-after: 30"), 30000);
  });

  it("parses 'Retry After 120' (no colon/hyphen variant)", () => {
    assert.equal(parseRetryAfter("Retry After 120"), 120000);
  });

  it("returns null for missing header", () => {
    assert.equal(parseRetryAfter("some other error"), null);
  });

  it("returns null for null input", () => {
    assert.equal(parseRetryAfter(null), null);
  });

  it("returns null for empty string", () => {
    assert.equal(parseRetryAfter(""), null);
  });

  it("returns null for undefined", () => {
    assert.equal(parseRetryAfter(undefined), null);
  });
});

// ─── ghExec retry behavior ──────────────────────────────────────────────────

describe("ghExec — retry on transient errors", () => {
  it("succeeds on first try with no retries needed", async () => {
    const exec = mockExec(0, { stdout: "success" });
    const result = await ghExec(["test"], {
      retries: 3, baseDelayMs: 1, _exec: exec, _sleep: instantSleep,
    });
    assert.equal(result, "success");
    assert.equal(exec.callCount(), 1);
  });

  it("retries once and succeeds on second attempt", async () => {
    const exec = mockExec(1, { stdout: "recovered" });
    const result = await ghExec(["test"], {
      retries: 3, baseDelayMs: 1, _exec: exec, _sleep: instantSleep,
    });
    assert.equal(result, "recovered");
    assert.equal(exec.callCount(), 2);
  });

  it("retries up to max retries then throws", async () => {
    const exec = alwaysFail("connection reset");
    await assert.rejects(
      () => ghExec(["test"], {
        retries: 2, baseDelayMs: 1, _exec: exec, _sleep: instantSleep,
      }),
      { message: "connection reset" },
    );
    // 1 initial + 2 retries = 3 total calls
    assert.equal(exec.callCount(), 3);
  });

  it("retries 5 times by default (6 total calls)", async () => {
    const exec = alwaysFail("server error");
    await assert.rejects(
      () => ghExec(["test"], {
        baseDelayMs: 1, _exec: exec, _sleep: instantSleep,
      }),
      { message: "server error" },
    );
    assert.equal(exec.callCount(), 6);
  });
});

describe("ghExec — rate limit handling", () => {
  it("retries on rate limit error", async () => {
    const exec = mockExec(1, { stderr: "API rate limit exceeded", stdout: "ok" });
    const result = await ghExec(["test"], {
      retries: 3, baseDelayMs: 1, _exec: exec, _sleep: instantSleep,
    });
    assert.equal(result, "ok");
    assert.equal(exec.callCount(), 2);
  });

  it("retries on secondary rate limit", async () => {
    const exec = mockExec(1, { stderr: "secondary rate limit", stdout: "ok" });
    const result = await ghExec(["test"], {
      retries: 3, baseDelayMs: 1, _exec: exec, _sleep: instantSleep,
    });
    assert.equal(result, "ok");
  });

  it("retries on abuse detection", async () => {
    const exec = mockExec(1, { stderr: "abuse detection mechanism", stdout: "ok" });
    const result = await ghExec(["test"], {
      retries: 3, baseDelayMs: 1, _exec: exec, _sleep: instantSleep,
    });
    assert.equal(result, "ok");
  });

  it("calls sleep with rate limit wait time", async () => {
    const sleepCalls = [];
    const sleepSpy = (ms) => { sleepCalls.push(ms); return Promise.resolve(); };
    const exec = mockExec(1, { stderr: "API rate limit exceeded. Retry-After: 10", stdout: "ok" });

    await ghExec(["test"], {
      retries: 3, baseDelayMs: 100, _exec: exec, _sleep: sleepSpy,
    });

    // Should have called sleep with Retry-After value (10s = 10000ms)
    assert.ok(sleepCalls.some((ms) => ms === 10000), `expected 10000ms sleep, got: ${sleepCalls}`);
  });

  it("falls back to exponential delay when no Retry-After header", async () => {
    const sleepCalls = [];
    const sleepSpy = (ms) => { sleepCalls.push(ms); return Promise.resolve(); };
    const exec = mockExec(1, { stderr: "HTTP 403 rate limit", stdout: "ok" });

    await ghExec(["test"], {
      retries: 3, baseDelayMs: 100, _exec: exec, _sleep: sleepSpy,
    });

    // First rate limit wait: baseDelay * 2^0 = 100ms
    assert.ok(sleepCalls.some((ms) => ms === 100), `expected 100ms sleep, got: ${sleepCalls}`);
  });
});

describe("ghExec — non-retryable errors", () => {
  it("throws immediately on 404 (no retries)", async () => {
    const exec = alwaysFail("HTTP 404 Not Found");
    await assert.rejects(
      () => ghExec(["test"], {
        retries: 5, baseDelayMs: 1, _exec: exec, _sleep: instantSleep,
      }),
      { message: "HTTP 404 Not Found" },
    );
    // Only 1 call — no retries for 404
    assert.equal(exec.callCount(), 1);
  });

  it("throws immediately on 401 (no retries)", async () => {
    const exec = alwaysFail("HTTP 401 Bad credentials");
    await assert.rejects(
      () => ghExec(["test"], {
        retries: 5, baseDelayMs: 1, _exec: exec, _sleep: instantSleep,
      }),
    );
    assert.equal(exec.callCount(), 1);
  });

  it("throws immediately on authentication error", async () => {
    const exec = alwaysFail("authentication required");
    await assert.rejects(
      () => ghExec(["test"], {
        retries: 5, baseDelayMs: 1, _exec: exec, _sleep: instantSleep,
      }),
    );
    assert.equal(exec.callCount(), 1);
  });
});

describe("ghExec — exponential backoff timing", () => {
  it("delays increase exponentially between retries", async () => {
    const sleepCalls = [];
    const sleepSpy = (ms) => { sleepCalls.push(ms); return Promise.resolve(); };
    const exec = alwaysFail("server error");

    await assert.rejects(
      () => ghExec(["test"], {
        retries: 3, baseDelayMs: 1000, _exec: exec, _sleep: sleepSpy,
      }),
    );

    // 3 retries = 3 sleep calls (between retries, not before first attempt)
    assert.equal(sleepCalls.length, 3);

    // Delays should roughly follow: 1000, 2000, 4000 (plus jitter up to 500)
    assert.ok(sleepCalls[0] >= 1000 && sleepCalls[0] <= 1500, `retry 1: ${sleepCalls[0]}`);
    assert.ok(sleepCalls[1] >= 2000 && sleepCalls[1] <= 2500, `retry 2: ${sleepCalls[1]}`);
    assert.ok(sleepCalls[2] >= 4000 && sleepCalls[2] <= 4500, `retry 3: ${sleepCalls[2]}`);
  });

  it("no sleep on first attempt", async () => {
    const sleepCalls = [];
    const sleepSpy = (ms) => { sleepCalls.push(ms); return Promise.resolve(); };
    const exec = mockExec(0, { stdout: "ok" });

    await ghExec(["test"], {
      retries: 3, baseDelayMs: 1000, _exec: exec, _sleep: sleepSpy,
    });

    assert.equal(sleepCalls.length, 0);
  });
});
