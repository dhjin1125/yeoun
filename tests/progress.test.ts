import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/http";
import { PROGRESS_MEDIA_TYPE, type ProgressStreamEvent } from "@/lib/progress";
import { ProgressRequestError, readProgressResponse } from "@/lib/progress-client";
import { acceptsProgressStream, progressStreamResponse } from "@/lib/progress-server";

function streamResponse<T>(events: ProgressStreamEvent<T>[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const event = events.shift();
        if (!event) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      }
    }),
    { headers: { "Content-Type": `${PROGRESS_MEDIA_TYPE}; charset=utf-8` } }
  );
}

describe("actual operation progress protocol", () => {
  it("delivers server checkpoints in order and returns the final result", async () => {
    const seen: number[] = [];
    const response = streamResponse<{ ok: true }>([
      { type: "progress", progress: { stage: "accepted", percent: 8, label: "요청 확인" } },
      { type: "progress", progress: { stage: "generated", percent: 82, label: "답변 완성" } },
      { type: "progress", progress: { stage: "stale", percent: 50, label: "뒤늦은 단계" } },
      { type: "progress", progress: { stage: "ready", percent: 100, label: "결과 준비" } },
      { type: "result", data: { ok: true } }
    ]);

    await expect(readProgressResponse(response, (progress) => seen.push(progress.percent))).resolves.toEqual({ ok: true });
    expect(seen).toEqual([8, 82, 100]);
  });

  it("falls back to the unchanged JSON API contract", async () => {
    const response = Response.json({ reading: { id: "dream_1" } }, { status: 201 });
    await expect(readProgressResponse(response, () => undefined)).resolves.toEqual({ reading: { id: "dream_1" } });
  });

  it("preserves verified AI activity state and start time for elapsed-time UI", async () => {
    const startedAt = "2026-08-28T00:00:00.000Z";
    const seen: Array<{ state?: string; startedAt?: string }> = [];
    const response = streamResponse<{ ok: true }>([
      {
        type: "progress",
        progress: {
          stage: "ai_model_started",
          percent: 68,
          label: "AI 생성 중",
          activityState: "responding",
          activityStartedAt: startedAt
        }
      },
      { type: "result", data: { ok: true } }
    ]);

    await readProgressResponse(response, (progress) => {
      seen.push({ state: progress.activityState, startedAt: progress.activityStartedAt });
    });
    expect(seen).toEqual([{ state: "responding", startedAt }]);
  });

  it("streams sanitized application errors instead of exposing internals", async () => {
    const response = progressStreamResponse(async (report) => {
      report({ stage: "accepted", percent: 10, label: "요청 확인" });
      throw new AppError("READING_EXPIRED", "보관 기간이 지났어요.", 410);
    });

    await expect(readProgressResponse(response, () => undefined)).rejects.toThrow("보관 기간이 지났어요.");
  });

  it("preserves safe error codes for the Prompt Lab recovery UI", async () => {
    const response = progressStreamResponse(async () => {
      throw new AppError("FREE_READING_UNAVAILABLE", "풀이를 완성하지 못했어요. (생성 원인: LOCAL_CODEX_INVALID_OUTPUT; 1회 시도)", 503);
    });
    await expect(readProgressResponse(response, () => undefined)).rejects.toMatchObject({
      code: "FREE_READING_UNAVAILABLE",
      status: 503
    });
  });

  it("emits only monotonic server milestones", async () => {
    const response = progressStreamResponse(async (report) => {
      report({ stage: "accepted", percent: 10, label: "요청 확인" });
      report({ stage: "late", percent: 8, label: "뒤늦은 이벤트" });
      report({ stage: "saved", percent: 52.4, label: "저장 완료" });
      return { ok: true as const };
    });
    const lines = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ProgressStreamEvent<{ ok: true }>);

    expect(lines.filter((event) => event.type === "progress").map((event) => event.type === "progress" && event.progress.percent)).toEqual([10, 52]);
    expect(lines.at(-1)).toEqual({ type: "result", data: { ok: true } });
  });

  it("opts in only when the client requests the progress media type", () => {
    expect(acceptsProgressStream(new Request("https://dream.example", { headers: { Accept: PROGRESS_MEDIA_TYPE } }))).toBe(true);
    expect(acceptsProgressStream(new Request("https://dream.example", { headers: { Accept: "application/json" } }))).toBe(false);
  });
});
