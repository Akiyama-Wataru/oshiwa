import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { describeFailureCause } from "@/lib/supabase/action-support";

describe("describeFailureCause", () => {
  it("names an Error by its kind and message", () => {
    expect(describeFailureCause(new TypeError("boom"))).toBe(
      "TypeError: boom",
    );
  });

  it("reads the fields these libraries carry the reason in", () => {
    expect(
      describeFailureCause({
        message: "Error sending confirmation email",
        status: 500,
        code: "unexpected_failure",
      }),
    ).toBe(
      "message=Error sending confirmation email code=unexpected_failure status=500",
    );
  });

  it("serialises a shape it does not recognise rather than writing {}", () => {
    // A log that says only "{}" tells the operator that something failed and
    // nothing else, which is the one thing it was there to prevent.
    expect(describeFailureCause({ reason: "unknown", attempt: 2 })).toBe(
      '{"reason":"unknown","attempt":2}',
    );
  });

  it("survives a cause that cannot be serialised", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(describeFailureCause(circular)).toBe("[unserialisable cause]");
  });

  it("reads a primitive cause as it is", () => {
    expect(describeFailureCause("refused")).toBe("refused");
    expect(describeFailureCause(null)).toBe("null");
  });
});
