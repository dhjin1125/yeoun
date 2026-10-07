import { describe, expect, it } from "vitest";
import {
  aiGenerationDisabled,
  appProfile,
  effectiveAiMode,
  ephemeralMemoryAllowed,
  interpretationModeLabel,
  localCodexEnabled,
  reviewPurchaseLoginRequired
} from "@/lib/app-profile";

describe("application runtime profiles", () => {
  it("treats the operational AI stop as an explicit switch", () => {
    expect(aiGenerationDisabled({ AI_GENERATION_DISABLED: "true" })).toBe(true);
    expect(aiGenerationDisabled({ AI_GENERATION_DISABLED: "false" })).toBe(false);
  });
  it("turns the review profile into a rule-based, non-Codex runtime with a memory fallback", () => {
    const environment = {
      APP_PROFILE: "review",
      AI_MODE: "openai",
      CODEX_LOCAL_ENABLED: "true",
      ALLOW_EPHEMERAL_MEMORY: "false"
    } as const;

    expect(appProfile(environment)).toBe("review");
    expect(effectiveAiMode(environment)).toBe("local");
    expect(interpretationModeLabel(environment)).toBe("rule_based");
    expect(localCodexEnabled(environment)).toBe(false);
    expect(ephemeralMemoryAllowed(environment)).toBe(true);
    expect(reviewPurchaseLoginRequired(environment)).toBe(true);
  });

  it("enables the local Codex runtime with one local-ai switch", () => {
    const environment = { APP_PROFILE: "local-ai" } as const;

    expect(effectiveAiMode(environment)).toBe("codex");
    expect(localCodexEnabled(environment)).toBe(true);
    expect(ephemeralMemoryAllowed(environment)).toBe(false);
    expect(reviewPurchaseLoginRequired(environment)).toBe(false);
  });

  it("locks the production profile to OpenAI and persistent storage", () => {
    const environment = {
      APP_PROFILE: "production",
      AI_MODE: "local",
      CODEX_LOCAL_ENABLED: "true",
      ALLOW_EPHEMERAL_MEMORY: "true"
    } as const;

    expect(effectiveAiMode(environment)).toBe("openai");
    expect(localCodexEnabled(environment)).toBe(false);
    expect(ephemeralMemoryAllowed(environment)).toBe(false);
    expect(reviewPurchaseLoginRequired(environment)).toBe(false);
  });

  it("preserves the individual legacy switches when no profile is selected", () => {
    const environment = {
      AI_MODE: "codex",
      CODEX_LOCAL_ENABLED: "true",
      ALLOW_EPHEMERAL_MEMORY: "true"
    } as const;

    expect(appProfile(environment)).toBeNull();
    expect(effectiveAiMode(environment)).toBe("codex");
    expect(localCodexEnabled(environment)).toBe(true);
    expect(ephemeralMemoryAllowed(environment)).toBe(true);
  });

  it("fails closed on a misspelled profile", () => {
    expect(() => appProfile({ APP_PROFILE: "prodution" })).toThrow(/APP_PROFILE must be one of/);
  });
});
