import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "@/lib/http";

describe("same-origin mutation guard", () => {
  it("accepts the browser-facing Host when Next normalizes request.url", () => {
    const request = new Request("http://localhost:3010/api/readings", {
      method: "POST",
      headers: {
        origin: "http://127.0.0.1:3010",
        host: "127.0.0.1:3010"
      }
    });

    expect(() => assertSameOrigin(request)).not.toThrow();
  });

  it("rejects a cross-site origin", () => {
    const request = new Request("https://dream.example/api/readings", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        host: "dream.example"
      }
    });

    expect(() => assertSameOrigin(request)).toThrowError(
      expect.objectContaining({ code: "ORIGIN_MISMATCH", status: 403 })
    );
  });
});
