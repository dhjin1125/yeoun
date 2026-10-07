import "server-only";

import { errorDetails } from "./http";
import {
  PROGRESS_MEDIA_TYPE,
  type OperationProgress,
  type ProgressReporter,
  type ProgressStreamEvent
} from "./progress";

export function acceptsProgressStream(request: Request) {
  return request.headers.get("accept")?.toLowerCase().includes(PROGRESS_MEDIA_TYPE) ?? false;
}

export function progressStreamResponse<T>(
  run: (report: ProgressReporter) => Promise<T>,
  init: { status?: number } = {}
) {
  const encoder = new TextEncoder();
  let cancelled = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let latestPercent = -1;
      const write = (event: ProgressStreamEvent<T>) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          cancelled = true;
        }
      };
      const report: ProgressReporter = (progress: OperationProgress) => {
        const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
        if (!Number.isFinite(progress.percent) || percent < latestPercent) return;
        latestPercent = percent;
        write({ type: "progress", progress: { ...progress, percent } });
      };

      try {
        const data = await run(report);
        write({ type: "result", data });
      } catch (error) {
        const details = errorDetails(error);
        write({
          type: "error",
          error: {
            code: details.body.error.code,
            message: details.body.error.message,
            status: details.status,
            ...(details.body.error.retryAfterSeconds ? { retryAfterSeconds: details.body.error.retryAfterSeconds } : {})
          }
        });
      } finally {
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
    }
  });

  return new Response(stream, {
    status: init.status ?? 200,
    headers: {
      "Content-Type": `${PROGRESS_MEDIA_TYPE}; charset=utf-8`,
      "Cache-Control": "no-store, private, no-transform",
      "X-Accel-Buffering": "no"
    }
  });
}
