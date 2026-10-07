export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.PAID_GENERATION_JOBS === "true" && !process.env.VERCEL && process.env.NEXT_PHASE !== "phase-production-build") {
    const { startPaidWorker } = await import("./lib/paid-jobs/worker");
    startPaidWorker();
  }
}
