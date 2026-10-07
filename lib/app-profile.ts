export const APP_PROFILES = ["review", "local-ai", "production"] as const;

export type AppProfile = (typeof APP_PROFILES)[number];
export type AiMode = "local" | "codex" | "openai";

type AppProfileEnvironment = {
  AI_MODE?: string;
  ALLOW_EPHEMERAL_MEMORY?: string;
  APP_PROFILE?: string;
  CODEX_LOCAL_ENABLED?: string;
  [key: string]: string | undefined;
};

export function appProfile(environment: AppProfileEnvironment = process.env): AppProfile | null {
  const configured = environment.APP_PROFILE?.trim().toLowerCase();
  if (!configured) return null;
  if ((APP_PROFILES as readonly string[]).includes(configured)) return configured as AppProfile;
  throw new Error(`APP_PROFILE must be one of: ${APP_PROFILES.join(", ")}.`);
}

export function effectiveAiMode(environment: AppProfileEnvironment = process.env): AiMode {
  const profile = appProfile(environment);
  if (profile === "review") return "local";
  if (profile === "local-ai") return "codex";
  if (profile === "production") return "openai";

  const configured = environment.AI_MODE?.trim().toLowerCase();
  if (configured === "codex" || configured === "openai" || configured === "local") {
    return configured;
  }
  return "local";
}

export function localCodexEnabled(environment: AppProfileEnvironment = process.env) {
  const profile = appProfile(environment);
  if (profile) return profile === "local-ai";
  return environment.CODEX_LOCAL_ENABLED === "true";
}

/** Operational stop: keep stored readings available without starting new model work. */
export function aiGenerationDisabled(environment: AppProfileEnvironment = process.env) {
  return environment.AI_GENERATION_DISABLED === "true";
}

export function ephemeralMemoryAllowed(environment: AppProfileEnvironment = process.env) {
  const profile = appProfile(environment);
  if (profile) return profile === "review";
  return environment.ALLOW_EPHEMERAL_MEMORY === "true";
}

export function reviewPurchaseLoginRequired(environment: AppProfileEnvironment = process.env) {
  return appProfile(environment) === "review";
}

export function interpretationModeLabel(environment: AppProfileEnvironment = process.env) {
  const mode = effectiveAiMode(environment);
  if (mode === "local") return "rule_based" as const;
  if (mode === "codex") return "local_codex" as const;
  return "openai" as const;
}
