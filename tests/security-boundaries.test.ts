import { readFile } from "node:fs/promises";
import { glob } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { sanitizedAnalyticsContext } from "@/lib/repository";
import { ANALYTICS_EVENTS } from "@/lib/types";

describe("commercial runtime boundaries", () => {
  it("does not import research-only scraped datasets from product runtime code", async () => {
    const files: string[] = [];
    for await (const file of glob(["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"], {
      cwd: process.cwd()
    })) {
      files.push(file);
    }
    const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
    const joined = sources.join("\n");

    expect(files.length).toBeGreaterThan(10);
    expect(joined).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*data\/(?:curated|raw)/);
    expect(joined).not.toMatch(/(?:from\s*|import\s*\()["'][^"']*dream-interpretations\.(?:jsonl|csv)/);
  });

  it("drops dream, question, and answer text from analytics context", () => {
    const sanitized = sanitizedAnalyticsContext({
      source: "timeline_composer",
      model: "gpt-5.4-mini",
      success: "true",
      offerVariant: "contextual_questions_v1",
      riskClass: "sensitive",
      cardKey: "psychology",
      focus: "recent_context",
      dream: "민감한 꿈 원문",
      question: "민감한 후속 질문",
      answer: "민감한 AI 답변",
      email: "person@example.com"
    });

    expect(sanitized).toEqual({
      source: "timeline_composer",
      model: "gpt-5.4-mini",
      success: "true",
      offerVariant: "contextual_questions_v1",
      riskClass: "sensitive",
      cardKey: "psychology",
      focus: "recent_context"
    });
    expect(JSON.stringify(sanitized)).not.toContain("민감한");
    expect(JSON.stringify(sanitized)).not.toContain("example.com");
  });

  it("keeps the latest Supabase analytics constraint aligned with runtime events", async () => {
    const migrations: string[] = [];
    for await (const file of glob("supabase/migrations/*analytics.sql", { cwd: process.cwd() })) {
      migrations.push(file);
    }
    const latest = migrations.sort().at(-1);
    expect(latest).toBeTruthy();
    const sql = await readFile(latest!, "utf8");

    for (const event of ANALYTICS_EVENTS) expect(sql).toContain(`'${event}'`);
  });
});
