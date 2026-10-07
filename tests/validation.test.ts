import { describe, expect, it } from "vitest";
import { INTERPRETATION_FOCUS_VALUES } from "@/lib/interpretation-focus";
import { analyticsSchema, createReadingSchema } from "@/lib/validation";

const dream = "검은 뱀이 창문으로 들어와서 무섭지만 가만히 바라보는 꿈을 꾸었어요.";

describe("interpretation focus validation", () => {
  it("accepts every public focus plus null and omission", () => {
    for (const focus of INTERPRETATION_FOCUS_VALUES) {
      expect(createReadingSchema.safeParse({ dream, focus }).success).toBe(true);
    }
    expect(createReadingSchema.safeParse({ dream, focus: null }).success).toBe(true);
    expect(createReadingSchema.safeParse({ dream }).success).toBe(true);
  });

  it("rejects arbitrary focus values", () => {
    expect(createReadingSchema.safeParse({ dream, focus: "money_luck" }).success).toBe(false);
  });

  it("allows only predefined focus values in analytics", () => {
    expect(
      analyticsSchema.safeParse({
        event: "focus_selected",
        context: { source: "home", focus: "relationship" }
      }).success
    ).toBe(true);
    expect(
      analyticsSchema.safeParse({
        event: "focus_selected",
        context: { source: "home", focus: "private_dream_text" }
      }).success
    ).toBe(false);
  });
});
