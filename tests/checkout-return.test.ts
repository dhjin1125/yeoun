import { describe, expect, it } from "vitest";
import { checkoutReturnPath } from "@/lib/checkout-return";

describe("checkout return path", () => {
  it("preserves this reading's restore token when a restored link is used in another browser", () => {
    expect(checkoutReturnPath("/reading/reading_fixture?token=synthetic", "reading_fixture")).toBe("/reading/reading_fixture?token=synthetic");
  });
  it.each(["https://other.example/reading/reading_fixture", "//other.example/reading/reading_fixture", "/reading/another_reading?token=synthetic", "javascript:alert(1)"])("rejects unrelated or external return paths: %s", (saved) => {
    expect(checkoutReturnPath(saved, "reading_fixture")).toBe("/reading/reading_fixture");
  });
  it("works with no browser storage or malformed input", () => {
    expect(checkoutReturnPath(null, "reading_fixture")).toBe("/reading/reading_fixture");
    expect(checkoutReturnPath(null, "//evil.example")).toBe("/");
  });
});
