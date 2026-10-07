import {
  PROGRESS_MEDIA_TYPE,
  type OperationProgress,
  type ProgressStreamEvent
} from "./progress";
import { normalizeNodeOffReviewPayload } from "./nodeoff-review";

type ApiErrorPayload = { error?: { code?: string; message?: string; status?: number; retryAfterSeconds?: number } };

export class ProgressRequestError extends Error {
  constructor(message: string, public readonly code: string, public readonly status?: number, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "ProgressRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseProgress(value: unknown): OperationProgress | null {
  if (!isRecord(value)) return null;
  const percent = value.percent;
  if (
    typeof value.stage !== "string" ||
    typeof value.label !== "string" ||
    typeof percent !== "number" ||
    !Number.isFinite(percent)
  ) {
    return null;
  }
  const activityState =
    value.activityState === "starting" ||
    value.activityState === "connected" ||
    value.activityState === "responding" ||
    value.activityState === "finalizing"
      ? value.activityState
      : undefined;
  const activityStartedAt =
    activityState &&
    typeof value.activityStartedAt === "string" &&
    Number.isFinite(Date.parse(value.activityStartedAt))
      ? value.activityStartedAt
      : undefined;
  return {
    stage: value.stage,
    label: value.label,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    ...(activityState ? { activityState } : {}),
    ...(activityStartedAt ? { activityStartedAt } : {})
  };
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & ApiErrorPayload;
  if (!response.ok) throw new ProgressRequestError(
    body.error?.message ?? "잠시 후 다시 시도해 주세요.",
    body.error?.code ?? "UNKNOWN_API_ERROR",
    body.error?.status ?? response.status,
    body.error?.retryAfterSeconds
  );
  return normalizeNodeOffReviewPayload(body);
}

export async function readProgressResponse<T>(
  response: Response,
  onProgress: (progress: OperationProgress) => void
): Promise<T> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes(PROGRESS_MEDIA_TYPE)) return readJsonResponse<T>(response);
  if (!response.body) throw new Error("진행 상황을 받아오지 못했어요. 다시 시도해 주세요.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;
  let receivedResult = false;
  let latestPercent = -1;

  function consumeLine(line: string) {
    if (!line.trim()) return;
    let event: ProgressStreamEvent<T>;
    try {
      event = JSON.parse(line) as ProgressStreamEvent<T>;
    } catch {
      throw new Error("진행 상황 응답을 읽지 못했어요. 다시 시도해 주세요.");
    }

    if (event.type === "progress") {
      const progress = parseProgress(event.progress);
      if (!progress || progress.percent < latestPercent) return;
      latestPercent = progress.percent;
      onProgress(progress);
      return;
    }
    if (event.type === "error") {
      throw new ProgressRequestError(
        event.error?.message || "잠시 후 다시 시도해 주세요.",
        event.error?.code || "UNKNOWN_API_ERROR",
        event.error?.status,
        event.error?.retryAfterSeconds
      );
    }
    if (event.type === "result") {
      result = normalizeNodeOffReviewPayload(event.data);
      receivedResult = true;
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) consumeLine(line);
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  if (!receivedResult) throw new Error("결과 응답이 끝까지 오지 않았어요. 다시 시도해 주세요.");
  return result as T;
}

export async function requestProgressJson<T>(
  url: string,
  init: RequestInit | undefined,
  onProgress: (progress: OperationProgress) => void
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: PROGRESS_MEDIA_TYPE,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers
    },
    cache: "no-store"
  });
  return readProgressResponse<T>(response, onProgress);
}
