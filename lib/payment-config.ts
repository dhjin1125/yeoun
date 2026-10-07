import { aiGenerationDisabled, appProfile } from "./app-profile";

export type PaymentMode = "disabled" | "mock" | "toss" | "portone";

type PaymentEnvironment = Partial<Pick<
  NodeJS.ProcessEnv,
  | "ALLOW_MOCK_PAYMENTS"
  | "AI_GENERATION_DISABLED"
  | "APP_PROFILE"
  | "NEXT_PUBLIC_TOSS_CLIENT_KEY"
  | "NODE_ENV"
  | "PAYMENTS_MODE"
  | "PORTONE_API_SECRET"
  | "PORTONE_STORE_ID"
  | "PORTONE_KCP_CHANNEL_KEY"
  | "PORTONE_WEBHOOK_SECRET"
  | "PUBLIC_DEMO_MODE"
  | "TOSS_SECRET_KEY"
  | "VERCEL"
  | "VERCEL_ENV"
>>;

export function paymentMode(environment: PaymentEnvironment = process.env): PaymentMode {
  const profile = appProfile(environment);
  if (profile === "review") return "mock";
  const configured = environment.PAYMENTS_MODE;
  if (configured === "portone" || configured === "toss" || configured === "disabled") {
    return configured;
  }
  if (configured === "mock") return profile === "production" ? "disabled" : "mock";
  if (configured) return "disabled";
  if (profile === "local-ai") return "mock";
  if (profile === "production") return "toss";
  return environment.NODE_ENV === "production" ? "disabled" : "mock";
}

export function mockPaymentsAllowed(environment: PaymentEnvironment = process.env) {
  const profile = appProfile(environment);
  if (profile === "review") return true;
  if (profile === "local-ai") return !environment.VERCEL && environment.ALLOW_MOCK_PAYMENTS !== "false";
  if (profile === "production") return false;

  if (environment.NODE_ENV !== "production") return true;
  if (environment.ALLOW_MOCK_PAYMENTS !== "true") return false;
  if (environment.VERCEL_ENV === "preview") return true;
  if (environment.PUBLIC_DEMO_MODE !== "true") return false;
  return environment.VERCEL_ENV === "production" || !environment.VERCEL_ENV;
}

export function purchasesEnabled(environment: PaymentEnvironment = process.env) {
  if (aiGenerationDisabled(environment)) return false;
  const mode = paymentMode(environment);
  if (mode === "mock") return mockPaymentsAllowed(environment);
  if (mode === "toss") {
    return Boolean(environment.NEXT_PUBLIC_TOSS_CLIENT_KEY && environment.TOSS_SECRET_KEY);
  }
  if (mode === "portone") {
    return Boolean(portoneCheckoutConfig(environment) && environment.PORTONE_API_SECRET?.trim() && environment.PORTONE_WEBHOOK_SECRET?.trim());
  }
  return false;
}

// Store/channel identifiers are public SDK inputs. Secrets never leave the server.
export function portoneCheckoutConfig(environment: PaymentEnvironment = process.env) {
  const storeId = environment.PORTONE_STORE_ID?.trim();
  const channelKey = environment.PORTONE_KCP_CHANNEL_KEY?.trim();
  return storeId && channelKey ? { storeId, channelKey } : null;
}
