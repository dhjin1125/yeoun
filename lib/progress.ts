export const PROGRESS_MEDIA_TYPE = "application/x-ndjson";

export type ProgressActivityState = "starting" | "connected" | "responding" | "finalizing";

export type OperationProgress = {
  stage: string;
  percent: number;
  label: string;
  activityState?: ProgressActivityState;
  activityStartedAt?: string;
};

export type ProgressReporter = (progress: OperationProgress) => void;

export type ProgressStreamEvent<T> =
  | { type: "progress"; progress: OperationProgress }
  | { type: "result"; data: T }
  | { type: "error"; error: { code: string; message: string; status: number; retryAfterSeconds?: number } };

export function initialProgress(label: string): OperationProgress {
  return { stage: "request_started", percent: 0, label };
}
