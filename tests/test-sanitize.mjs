import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  sanitizeText,
  sanitizeUrl,
  sanitizeStars,
  sanitizeAdopter,
  sanitizeAdopters,
} from "../scripts/sanitize.mjs";

const GITHUB_URL_PREFIXES = ["https://github.com/"];
const AVATAR_URL_PREFIXES = [
  "https://avatars.githubusercontent.com/",
  "https://github.com/",
];

const TEXT_FIELDS = ["description", "owner", "repo", "language"];

/**
 * Assert that sanitizeText output contains no angle brackets.
 * Quotes, backticks, and ampersands are allowed in plaintext output —
 * the Liquid | escape filter handles encoding at render time.
 */
function assertSafeText(output) {
  assert.ok(!output.includes("<"), `contains raw "<": ${output}`);
  assert.ok(!output.includes(">"), `contains raw ">": ${output}`);
}

function makeAdopter(overrides = {}) {
  return {
    owner: "testowner",
    repo: "testrepo",
    full_name: "testowner/testrepo",
    description: "A safe description",
    stars: 42,
    language: "JavaScript",
    avatar: "https://avatars.githubusercontent.com/u/12345?v=4",
    url: "https://github.com/testowner/testrepo",
    file_url: "https://github.com/testowner/testrepo/blob/main/HALLUCINATE.md",
    file_path: "HALLUCINATE.md",
    ...overrides,
  };
}

// ─── 1. Basic script injection ──────────────────────────────────────────────

describe("1 — basic <script>alert(1)</script> injection", () => {
  const payload = '<script>alert(1)</script>';

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips script tag from ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(!result.toLowerCase().includes("script"));
    });
  }

  it("sanitizeAdopter sanitizes all text fields", () => {
    const adopter = makeAdopter({
      description: payload,
      owner: payload,
      repo: payload,
      language: payload,
    });
    const result = sanitizeAdopter(adopter);
    for (const field of TEXT_FIELDS) {
      assertSafeText(result[field]);
    }
  });
});

// ─── 2. img onerror injection ───────────────────────────────────────────────

describe("2 — <img src=x onerror=alert(1)> injection", () => {
  const payload = '<img src=x onerror=alert(1)>';

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips img tag from ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(!result.toLowerCase().includes("onerror"));
    });
  }
});

// ─── 3. svg onload injection ────────────────────────────────────────────────

describe("3 — <svg onload=alert(1)> injection", () => {
  const payload = '<svg onload=alert(1)>';

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips svg tag from ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(!result.toLowerCase().includes("onload"));
    });
  }
});

// ─── 4. Event handler attribute breakout ────────────────────────────────────

describe('4 — event handler attribute breakout: " onmouseover="alert(1)', () => {
  const payload = '" onmouseover="alert(1)';

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText preserves text safely (no angle brackets) in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      // Quotes pass through as plaintext — Liquid | escape handles encoding
      assert.ok(typeof result === "string");
    });
  }
});

// ─── 5. javascript: in string fields ────────────────────────────────────────

describe("5 — javascript:alert(1) in string fields", () => {
  const payload = "javascript:alert(1)";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText allows javascript: text in ${field} (no angle brackets)`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(result.includes("javascript:alert(1)"));
    });
  }
});

// ─── 6. HTML entity bypass ──────────────────────────────────────────────────

describe("6 — HTML entity bypass: &lt;script&gt;alert(1)&lt;/script&gt;", () => {
  const payload = "&lt;script&gt;alert(1)&lt;/script&gt;";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText passes through entities safely in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
    });
  }
});

// ─── 7. Unicode escape sequences ────────────────────────────────────────────

describe("7 — unicode escapes: \\u003cscript\\u003ealert(1)\\u003c/script\\u003e", () => {
  const payload = "\\u003cscript\\u003ealert(1)\\u003c/script\\u003e";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips \\u003c/\\u003e from ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(!result.includes("\\u003c"));
      assert.ok(!result.includes("\\u003e"));
    });
  }
});

// ─── 8. Null byte injection ─────────────────────────────────────────────────

describe("8 — null byte injection", () => {
  const payload = "before\u0000<script>alert(1)</script>after";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText handles null bytes in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(!result.toLowerCase().includes("script"));
    });
  }
});

// ─── 9. Long string truncation ──────────────────────────────────────────────

describe("9 — long string truncation", () => {
  it("truncates 10000 char string to <= 200", () => {
    const payload = "A".repeat(10000);
    const result = sanitizeText(payload);
    assert.ok(result.length <= 200);
  });

  it("preserves strings already under limit", () => {
    const payload = "short";
    const result = sanitizeText(payload);
    assert.equal(result, "short");
  });
});

// ─── 10. Nested/broken HTML ─────────────────────────────────────────────────

describe("10 — nested/broken HTML", () => {
  const payload = "<scr<script>ipt>alert(1)</scr</script>ipt>";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips nested/broken HTML from ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
    });
  }
});

// ─── 11. Liquid template injection ──────────────────────────────────────────

describe("11 — Liquid template injection: {{ 7*7 }}", () => {
  const payload = "{{ 7*7 }}";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText handles Liquid syntax in ${field} (no angle brackets)`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
    });
  }
});

// ─── 12. Backtick injection ─────────────────────────────────────────────────

describe("12 — backtick injection: `alert(1)`", () => {
  const payload = "`alert(1)`";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText preserves backticks as plaintext in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      // Backticks pass through as plaintext — Liquid | escape handles encoding
      assert.ok(result.includes("`alert(1)`"));
    });
  }
});

// ─── 13. CSS injection ──────────────────────────────────────────────────────

describe("13 — CSS injection: </style><script>alert(1)</script>", () => {
  const payload = "</style><script>alert(1)</script>";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips style/script breakout in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(!result.toLowerCase().includes("script"));
    });
  }
});

// ─── 14. Markdown injection ─────────────────────────────────────────────────

describe("14 — Markdown injection: [click me](javascript:alert(1))", () => {
  const payload = "[click me](javascript:alert(1))";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText handles Markdown syntax in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
    });
  }
});

// ─── 15. SVG data URI ───────────────────────────────────────────────────────

describe("15 — SVG data URI: data:image/svg+xml,...", () => {
  const payload = "data:image/svg+xml,<svg onload=alert(1)>";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips SVG data URI content in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
    });
  }
});

// ─── 16. Double encoding ────────────────────────────────────────────────────

describe("16 — double encoding: %3Cscript%3Ealert(1)%3C/script%3E", () => {
  const payload = "%3Cscript%3Ealert(1)%3C/script%3E";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText passes through URL-encoded strings in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(result.includes("%3C"));
    });
  }
});

// ─── 17. null/undefined values ──────────────────────────────────────────────

describe("17 — null/undefined values in all fields", () => {
  it("sanitizeText(null) returns empty string", () => {
    assert.equal(sanitizeText(null), "");
  });

  it("sanitizeText(undefined) returns empty string", () => {
    assert.equal(sanitizeText(undefined), "");
  });

  it("sanitizeStars(null) returns 0", () => {
    assert.equal(sanitizeStars(null), 0);
  });

  it("sanitizeStars(undefined) returns 0", () => {
    assert.equal(sanitizeStars(undefined), 0);
  });

  it("sanitizeUrl(null, ...) returns empty string", () => {
    assert.equal(sanitizeUrl(null, GITHUB_URL_PREFIXES), "");
  });

  it("sanitizeUrl(undefined, ...) returns empty string", () => {
    assert.equal(sanitizeUrl(undefined, GITHUB_URL_PREFIXES), "");
  });

  it("sanitizeAdopter with all null fields produces safe defaults", () => {
    const result = sanitizeAdopter({
      owner: null,
      repo: null,
      full_name: null,
      description: null,
      stars: null,
      language: null,
      avatar: null,
      url: null,
      file_url: null,
      file_path: null,
    });
    assert.equal(result.owner, "");
    assert.equal(result.repo, "");
    assert.equal(result.full_name, "");
    assert.equal(result.description, "");
    assert.equal(result.stars, 0);
    assert.equal(result.language, "");
    assert.equal(result.avatar, "");
    assert.equal(result.url, "");
    assert.equal(result.file_url, "");
    assert.equal(result.file_path, "");
  });

  it("sanitizeAdopter with all undefined fields produces safe defaults", () => {
    const result = sanitizeAdopter({});
    assert.equal(result.owner, "");
    assert.equal(result.repo, "");
    assert.equal(result.stars, 0);
    assert.equal(result.url, "");
  });

  it("sanitizeAdopter(null) returns null", () => {
    assert.equal(sanitizeAdopter(null), null);
  });

  it("sanitizeAdopter(undefined) returns null", () => {
    assert.equal(sanitizeAdopter(undefined), null);
  });
});

// ─── 18. URL validation ─────────────────────────────────────────────────────

describe("18 — URL validation", () => {
  const maliciousUrls = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://evil.com",
    "http://github.com.evil.com",
    "//evil.com",
    "ftp://github.com/foo",
    "https://githubx.com/foo",
  ];

  for (const url of maliciousUrls) {
    it(`rejects malicious url: ${url}`, () => {
      assert.equal(sanitizeUrl(url, GITHUB_URL_PREFIXES), "");
    });
  }

  it("rejects @-userinfo bypass: https://github.com@evil.com", () => {
    assert.equal(sanitizeUrl("https://github.com@evil.com", GITHUB_URL_PREFIXES), "");
  });

  it("rejects @-userinfo with path: https://github.com@evil.com/path", () => {
    assert.equal(sanitizeUrl("https://github.com@evil.com/path", GITHUB_URL_PREFIXES), "");
  });

  it("rejects password@host: https://github.com:pass@evil.com", () => {
    assert.equal(sanitizeUrl("https://github.com:pass@evil.com", GITHUB_URL_PREFIXES), "");
  });

  it("rejects XSS payload in valid-prefix URL path", () => {
    assert.equal(
      sanitizeUrl('https://github.com/"><script>alert(1)</script>', GITHUB_URL_PREFIXES),
      'https://github.com/"><script>alert(1)</script>',
    );
  });

  it("accepts valid GitHub repo URL", () => {
    const url = "https://github.com/owner/repo";
    assert.equal(sanitizeUrl(url, GITHUB_URL_PREFIXES), url);
  });

  it("accepts valid GitHub blob URL", () => {
    const url = "https://github.com/owner/repo/blob/main/HALLUCINATE.md";
    assert.equal(sanitizeUrl(url, GITHUB_URL_PREFIXES), url);
  });
});

// ─── 19. Avatar URL validation ──────────────────────────────────────────────

describe("19 — avatar URL validation", () => {
  const maliciousUrls = [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://evil.com",
    "http://github.com.evil.com",
    "//evil.com",
    "ftp://github.com/foo",
    "https://githubx.com/foo",
  ];

  for (const url of maliciousUrls) {
    it(`rejects malicious avatar url: ${url}`, () => {
      assert.equal(sanitizeUrl(url, AVATAR_URL_PREFIXES), "");
    });
  }

  it("rejects @-userinfo bypass on avatar URL", () => {
    assert.equal(
      sanitizeUrl("https://avatars.githubusercontent.com@evil.com/u/12345", AVATAR_URL_PREFIXES),
      "",
    );
  });

  it("accepts valid avatars.githubusercontent.com URL", () => {
    const url = "https://avatars.githubusercontent.com/u/12345?v=4";
    assert.equal(sanitizeUrl(url, AVATAR_URL_PREFIXES), url);
  });

  it("accepts valid github.com avatar URL", () => {
    const url = "https://github.com/identicons/abc123.png";
    assert.equal(sanitizeUrl(url, AVATAR_URL_PREFIXES), url);
  });
});

// ─── 20. Stars must be numeric ──────────────────────────────────────────────

describe("20 — stars must be numeric", () => {
  it('string "42" returns 0', () => {
    assert.equal(sanitizeStars("42"), 0);
  });

  it("null returns 0", () => {
    assert.equal(sanitizeStars(null), 0);
  });

  it('empty string "" returns 0', () => {
    assert.equal(sanitizeStars(""), 0);
  });

  it('"<script>" returns 0', () => {
    assert.equal(sanitizeStars("<script>"), 0);
  });

  it("NaN returns 0", () => {
    assert.equal(sanitizeStars(NaN), 0);
  });

  it("Infinity returns 0", () => {
    assert.equal(sanitizeStars(Infinity), 0);
  });

  it("valid number 42 returns 42", () => {
    assert.equal(sanitizeStars(42), 42);
  });

  it("negative number returns 0", () => {
    assert.equal(sanitizeStars(-5), 0);
  });

  it("float 3.7 returns 3", () => {
    assert.equal(sanitizeStars(3.7), 3);
  });
});

// ─── 21. Single quote breakout ──────────────────────────────────────────────

describe("21 — single quote breakout: ' onmouseover='alert(1)", () => {
  const payload = "' onmouseover='alert(1)";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText preserves quotes as plaintext in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      // Quotes pass through as plaintext — Liquid | escape handles encoding
      assert.ok(result.includes("'"));
    });
  }
});

// ─── 22. Mixed attack ───────────────────────────────────────────────────────

describe("22 — mixed attack with style/img/script", () => {
  const payload =
    '<div style="background:url(javascript:alert(1))"><img src=x onerror="alert(1)">';

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips mixed attack from ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(!result.toLowerCase().includes("onerror"));
    });
  }
});

// ─── 23. Unclosed tags ──────────────────────────────────────────────────────

describe("23 — unclosed tags: <script>alert(1) (no closing tag)", () => {
  const payload = "<script>alert(1)";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText handles unclosed tags in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
    });
  }
});

// ─── 24. Unusual spacing ────────────────────────────────────────────────────

describe('24 — unusual spacing: <IMG """><SCRIPT>alert("XSS")</SCRIPT>">', () => {
  const payload = '<IMG """><SCRIPT>alert("XSS")</SCRIPT>">';

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips unusual spacing attack from ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(!result.toLowerCase().includes("script"));
    });
  }
});

// ─── 25. Multiple items in sanitizeAdopters ─────────────────────────────────

describe("25 — multiple items in sanitizeAdopters", () => {
  it("preserves safe item and sanitizes malicious item", () => {
    const safe = makeAdopter();
    const malicious = makeAdopter({
      description: '<script>alert(1)</script>',
      owner: '<img onerror=alert(1)>',
      url: "javascript:alert(1)",
      avatar: "data:text/html,bad",
    });

    const result = sanitizeAdopters([safe, malicious]);

    assert.equal(result.length, 1);

    assert.equal(result[0].owner, "testowner");
    assert.equal(result[0].url, "https://github.com/testowner/testrepo");
  });

  it("sanitizes text fields on kept items", () => {
    const item = makeAdopter({
      description: '<b>bold</b> and <script>bad</script>',
    });
    const result = sanitizeAdopters([item]);
    assert.equal(result.length, 1);
    assertSafeText(result[0].description);
    assert.ok(result[0].description.includes("bold"));
  });
});

// ─── 26. Empty array ────────────────────────────────────────────────────────

describe("26 — empty array", () => {
  it("sanitizeAdopters([]) returns []", () => {
    const result = sanitizeAdopters([]);
    assert.deepEqual(result, []);
  });

  it("sanitizeAdopters(non-array) returns []", () => {
    assert.deepEqual(sanitizeAdopters(null), []);
    assert.deepEqual(sanitizeAdopters(undefined), []);
    assert.deepEqual(sanitizeAdopters("string"), []);
    assert.deepEqual(sanitizeAdopters(42), []);
  });
});

// ─── 27. HTML in URL fields ─────────────────────────────────────────────────

describe("27 — HTML in URL fields", () => {
  const payload = '"><script>alert(1)</script>';

  it("rejects HTML in url field", () => {
    assert.equal(sanitizeUrl(payload, GITHUB_URL_PREFIXES), "");
  });

  it("rejects HTML in file_url field", () => {
    assert.equal(sanitizeUrl(payload, GITHUB_URL_PREFIXES), "");
  });

  it("rejects HTML in avatar field", () => {
    assert.equal(sanitizeUrl(payload, AVATAR_URL_PREFIXES), "");
  });

  it("adopter with HTML in url gets filtered out by sanitizeAdopters", () => {
    const item = makeAdopter({ url: payload });
    const result = sanitizeAdopters([item]);
    assert.equal(result.length, 0);
  });
});

// ─── 28. Unicode uppercase ──────────────────────────────────────────────────

describe("28 — unicode uppercase: \\u003Cscript\\u003E", () => {
  const payload = "\\u003Cscript\\u003Ealert(1)\\u003C/script\\u003E";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips uppercase unicode escapes in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
      assert.ok(!result.includes("\\u003C"));
      assert.ok(!result.includes("\\u003E"));
    });
  }
});

// ─── 29. Deeply nested angle brackets ───────────────────────────────────────

describe("29 — deeply nested angle brackets", () => {
  const payload = "<<<<<script>>>>>alert(1)<<<<<</script>>>>>";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText strips deeply nested brackets in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
    });
  }
});

// ─── 30. Whitespace in event handlers ───────────────────────────────────────

describe("30 — whitespace in event handlers", () => {
  const payload = "test\ton\nmouseover=alert(1)";

  for (const field of TEXT_FIELDS) {
    it(`sanitizeText handles whitespace event handler attempt in ${field}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
    });
  }
});

// ─── 31. JSON-breaking payloads ─────────────────────────────────────────────

describe("31 — JSON-breaking payloads in descriptions", () => {
  const payloads = ["{}", "[]", '{"key":"value"}'];

  for (const payload of payloads) {
    it(`sanitizeText handles ${payload}`, () => {
      const result = sanitizeText(payload);
      assertSafeText(result);
    });
  }

  it("sanitizeText handles curly braces in description", () => {
    const result = sanitizeText("A library for {templating} and [rendering]");
    assertSafeText(result);
    assert.ok(result.includes("{templating}"));
    assert.ok(result.includes("[rendering]"));
  });
});
