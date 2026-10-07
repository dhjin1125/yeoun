import { defineConfig, devices } from "playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3010);
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure"
  },
  projects: [
    {
      name: "mobile-390",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true
      }
    },
    {
      name: "desktop-1440",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } }
    }
  ],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    env: {
      APP_PROFILE: process.env.APP_PROFILE ?? "",
      AI_MODE: "local",
      PAYMENTS_MODE: "mock",
      DREAM_REPOSITORY: "sqlite",
      DREAM_DATABASE_PATH: ".data/e2e.sqlite3",
      REVIEW_AUTH_IDENTIFIER: "test",
      REVIEW_AUTH_PASSWORD_HASH: "scrypt$eWVvdW4tcmV2aWV3LXRlc3QtMjAyNg$ZfTPl2DXSTkcJbHlqig0b-37fpqna4DegCIcZWWc4m8",
      REVIEW_AUTH_SECRET: "kkumgyeol-review-session-secret-for-e2e-2026",
      BUSINESS_NAME: "여운 테스트상점",
      BUSINESS_REPRESENTATIVE: "테스트 대표",
      BUSINESS_REGISTRATION_NUMBER: "123-45-67890",
      BUSINESS_ADDRESS: "서울특별시 테스트구 여운로 1",
      BUSINESS_PHONE: "02-1234-5678",
      BUSINESS_EMAIL: "support@yeoun.local",
      MAIL_ORDER_REGISTRATION_NUMBER: "제2026-서울테스트-0001호"
    },
    timeout: 120_000
  }
});
