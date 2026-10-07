import { afterEach, describe, expect, it } from "vitest";
import { readConversationJson } from "@/lib/conversation-ingress";
import { AppError, errorResponse } from "@/lib/http";
import { progressStreamResponse } from "@/lib/progress-server";
import { readProgressResponse } from "@/lib/progress-client";

afterEach(() => { globalThis.__dreamConversationIngress = undefined; });
const request = (text: string) => new Request("https://dream.test/api/readings/example/messages", { method: "POST", body: text });

describe("conversation ingress", () => {
  it("caps actual body bytes even when Content-Length is absent", async () => {
    await expect(readConversationJson(request(JSON.stringify({ message: "가".repeat(3000) })))).rejects.toMatchObject({ status: 413 });
    await expect(readConversationJson(request('{"message":"꿈에 대해 물어볼게요"}'))).resolves.toEqual({ message: "꿈에 대해 물어볼게요" });
  });
  it("counts malformed requests and bounds the process-wide ingress before auth or AI", async () => {
    for (let index = 0; index < 30; index += 1) await readConversationJson(request("{")).catch(() => undefined);
    await expect(readConversationJson(request("{}"))).rejects.toMatchObject({ status: 429, retryAfterSeconds: 1 });
  });
  it("carries cooldown through both JSON and streaming error responses", async () => {
    const error = new AppError("CONVERSATION_RATE_LIMITED", "잠시 후 다시 보내주세요.", 429, 60);
    const json = errorResponse(error);
    expect(json.status).toBe(429);
    expect(json.headers.get("Retry-After")).toBe("60");
    await expect(readProgressResponse(json, () => {})).rejects.toMatchObject({ code: error.code, retryAfterSeconds: 60 });
    const stream = progressStreamResponse(async () => { throw error; });
    await expect(readProgressResponse(stream, () => {})).rejects.toMatchObject({ code: error.code, status: 429, retryAfterSeconds: 60 });
  });
});
