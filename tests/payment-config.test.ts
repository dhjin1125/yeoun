import { describe, expect, it } from "vitest";
import { mockPaymentsAllowed, paymentMode, purchasesEnabled } from "@/lib/payment-config";

describe("payment environment guard", () => {
  it("blocks new checkout while operational AI generation is stopped", () => {
    expect(purchasesEnabled({ APP_PROFILE: "local-ai", PAYMENTS_MODE: "mock", AI_GENERATION_DISABLED: "true" })).toBe(false);
  });
  it("opens only mock payment with the single review profile switch", () => {
    const environment = {
      APP_PROFILE: "review",
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      VERCEL: "1"
    } as const;
    expect(paymentMode(environment)).toBe("mock");
    expect(mockPaymentsAllowed(environment)).toBe(true);
    expect(purchasesEnabled(environment)).toBe(true);
  });

  it("keeps a local-ai profile off Vercel and forces production onto live payment", () => {
    const local = { APP_PROFILE: "local-ai", NODE_ENV: "production" } as const;
    const vercel = { ...local, VERCEL: "1" } as const;
    const production = {
      APP_PROFILE: "production",
      NODE_ENV: "production",
      NEXT_PUBLIC_TOSS_CLIENT_KEY: "client",
      TOSS_SECRET_KEY: "secret"
    } as const;

    expect(paymentMode(local)).toBe("mock");
    expect(mockPaymentsAllowed(local)).toBe(true);
    expect(mockPaymentsAllowed(vercel)).toBe(false);
    expect(paymentMode(production)).toBe("toss");
    expect(mockPaymentsAllowed(production)).toBe(false);
    expect(purchasesEnabled(production)).toBe(true);
  });

  it("keeps mock payments available in local and test environments", () => {
    const environment = { NODE_ENV: "test", PAYMENTS_MODE: "mock" } as const;
    expect(paymentMode(environment)).toBe("mock");
    expect(mockPaymentsAllowed(environment)).toBe(true);
    expect(purchasesEnabled(environment)).toBe(true);
  });

  it("honors explicit PortOne payments without changing the local-ai profile", () => {
    const environment = {
      APP_PROFILE: "local-ai", NODE_ENV: "production", PAYMENTS_MODE: "portone",
      ALLOW_MOCK_PAYMENTS: "false", PORTONE_STORE_ID: "store-test",
      PORTONE_KCP_CHANNEL_KEY: "channel-test", PORTONE_API_SECRET: "test-secret",
      PORTONE_WEBHOOK_SECRET: "test-webhook-secret"
    } as const;
    expect(paymentMode(environment)).toBe("portone");
    expect(mockPaymentsAllowed(environment)).toBe(false);
    expect(purchasesEnabled(environment)).toBe(true);
    for (const name of ["PORTONE_STORE_ID", "PORTONE_KCP_CHANNEL_KEY", "PORTONE_API_SECRET", "PORTONE_WEBHOOK_SECRET"]) {
      expect(purchasesEnabled({ ...environment, [name]: "" })).toBe(false);
    }
    expect(paymentMode({ ...environment, APP_PROFILE: "review" })).toBe("mock");
    expect(paymentMode({ ...environment, PAYMENTS_MODE: "disabled" })).toBe("disabled");
    expect(paymentMode({ ...environment, PAYMENTS_MODE: "typo" })).toBe("disabled");
  });

  it("never falls back to mock payment for a production profile", () => {
    expect(paymentMode({ APP_PROFILE: "production", PAYMENTS_MODE: "mock" })).toBe("disabled");
    expect(paymentMode({ APP_PROFILE: "production", PAYMENTS_MODE: "portone" })).toBe("portone");
  });

  it("allows mock payments in production builds only on an explicitly enabled Vercel Preview", () => {
    const preview = {
      NODE_ENV: "production",
      VERCEL_ENV: "preview",
      PAYMENTS_MODE: "mock",
      ALLOW_MOCK_PAYMENTS: "true"
    } as const;
    expect(mockPaymentsAllowed(preview)).toBe(true);
    expect(purchasesEnabled(preview)).toBe(true);
  });

  it("keeps mock purchases closed on Vercel Production without the separate public demo flag", () => {
    const production = {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      PAYMENTS_MODE: "mock",
      ALLOW_MOCK_PAYMENTS: "true"
    } as const;
    expect(mockPaymentsAllowed(production)).toBe(false);
    expect(purchasesEnabled(production)).toBe(false);
  });

  it("allows a clearly marked non-charging walkthrough in an explicitly enabled public demo", () => {
    const publicDemo = {
      NODE_ENV: "production",
      VERCEL_ENV: "production",
      PAYMENTS_MODE: "mock",
      ALLOW_MOCK_PAYMENTS: "true",
      PUBLIC_DEMO_MODE: "true"
    } as const;
    expect(mockPaymentsAllowed(publicDemo)).toBe(true);
    expect(purchasesEnabled(publicDemo)).toBe(true);
  });

  it("supports the same explicitly enabled public demo on a self-hosted production server", () => {
    const selfHostedDemo = {
      NODE_ENV: "production",
      PAYMENTS_MODE: "mock",
      ALLOW_MOCK_PAYMENTS: "true",
      PUBLIC_DEMO_MODE: "true"
    } as const;
    expect(mockPaymentsAllowed(selfHostedDemo)).toBe(true);
    expect(purchasesEnabled(selfHostedDemo)).toBe(true);
  });
});
