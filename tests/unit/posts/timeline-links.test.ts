import { describe, expect, it } from "vitest";

import { formatPostTimestamp } from "@/lib/posts/format";
import { timelineHref } from "@/lib/posts/timeline-links";

const basePath = "/groups/2b75e8eb-4965-4dcf-9c39-4d6ad37fbefd/posts";

describe("timelineHref", () => {
  it("returns the bare path when nothing is filtered", () => {
    expect(timelineHref(basePath, {})).toBe(basePath);
    expect(timelineHref(basePath, { oshi: null, tag: "", before: undefined })).toBe(
      basePath,
    );
  });

  it("carries the filters and the cursor together", () => {
    expect(
      timelineHref(basePath, {
        oshi: "7c308427-3f5d-4cab-a54c-d9b2eecdd4b4",
        tag: "尊い",
        before: "2026-07-27T11:00:00+00:00_7c308427-3f5d-4cab-a54c-d9b2eecdd4b4",
      }),
    ).toBe(
      `${basePath}?oshi=7c308427-3f5d-4cab-a54c-d9b2eecdd4b4&tag=%E5%B0%8A%E3%81%84&before=2026-07-27T11%3A00%3A00%2B00%3A00_7c308427-3f5d-4cab-a54c-d9b2eecdd4b4`,
    );
  });

  it("escapes a value that would otherwise start a new parameter", () => {
    expect(timelineHref(basePath, { tag: "a&oshi=b" })).toBe(
      `${basePath}?tag=a%26oshi%3Db`,
    );
  });
});

describe("formatPostTimestamp", () => {
  it("reads the same on the server and in the browser", () => {
    // 11:00 UTC is 20:00 in the zone the timeline is pinned to.
    expect(formatPostTimestamp("2026-07-27T11:00:00+00:00")).toBe(
      "2026年7月27日 20:00",
    );
  });

  it("leaves a value it cannot parse untouched rather than rendering NaN", () => {
    expect(formatPostTimestamp("yesterday")).toBe("yesterday");
  });
});
