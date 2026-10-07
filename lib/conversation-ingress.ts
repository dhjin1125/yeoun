import "server-only";
import { AppError } from "./http";

// Constant-size, process-wide shield before JSON parsing, auth or database work.
// Durable reading/principal limits enforce policy after access has been checked.
declare global {
  var __dreamConversationIngress: { tokens: number; at: number; readingBodies: number } | undefined;
}
const MAX_BODY_BYTES = 8192;
const BURST = 30;
const REQUESTS_PER_SECOND = 2;

export async function readConversationJson(request: Request): Promise<unknown> {
  const now = Date.now();
  const state = globalThis.__dreamConversationIngress ??= { tokens: BURST, at: now, readingBodies: 0 };
  state.tokens = Math.min(BURST, state.tokens + Math.max(0, now - state.at) / 1000 * REQUESTS_PER_SECOND);
  state.at = now;
  if (state.tokens < 1 || state.readingBodies >= 16) {
    throw new AppError("CONVERSATION_RATE_LIMITED", "요청이 많아요. 잠시 후 다시 보내주세요. 질문 횟수는 차감하지 않았어요.", 429, 1);
  }
  state.tokens -= 1;
  const declaredSize = Number(request.headers.get("content-length"));
  if (declaredSize > MAX_BODY_BYTES) throw new AppError("REQUEST_TOO_LARGE", "질문이 너무 길어요. 내용을 줄여서 다시 보내주세요.", 413);
  if (!request.body) throw new AppError("INVALID_JSON", "요청 형식이 올바르지 않아요.", 400);
  state.readingBodies += 1;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AppError("REQUEST_BODY_TIMEOUT", "내용을 받지 못했어요. 다시 보내주세요.", 408)), 5000);
  });
  let complete = false;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const next = await Promise.race([reader.read(), deadline]);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BODY_BYTES) throw new AppError("REQUEST_TOO_LARGE", "질문이 너무 길어요. 내용을 줄여서 다시 보내주세요.", 413);
      chunks.push(next.value);
    }
    complete = true;
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)); }
    catch { throw new AppError("INVALID_JSON", "요청 형식이 올바르지 않아요.", 400); }
  } finally {
    clearTimeout(timer);
    state.readingBodies -= 1;
    if (!complete) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
