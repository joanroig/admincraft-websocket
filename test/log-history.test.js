const test = require("node:test");
const assert = require("node:assert/strict");
const { trimVisibleLogHistory } = require("../log-history");

test("history trimming ignores state polling before applying visible limit", () => {
  const lines = [
    "2026-08-17T10:00:00Z Old useful line",
    "2026-08-17T10:00:01Z Daytime is 1000",
    "2026-08-17T10:00:02Z There are 0/10 players online:",
    "2026-08-17T10:00:03Z New useful line",
  ];

  assert.equal(
    trimVisibleLogHistory(lines.join("\n"), 2),
    [lines[0], lines[3]].join("\n"),
  );
});

test("history trimming returns only the requested meaningful tail", () => {
  const lines = [
    "2026-08-17T10:00:00Z First",
    "2026-08-17T10:00:01Z Second",
    "2026-08-17T10:00:02Z Third",
  ];

  assert.equal(trimVisibleLogHistory(lines.join("\n"), 2), lines.slice(1).join("\n"));
});
