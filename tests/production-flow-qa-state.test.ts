import { describe, expect, it } from "vitest";
import "@/scripts/qa/production-free-flow-aside.js";

type QaAttempt = { state: string; postCount: number; readingId: string | null };
type Harness = {
  newAttempt(): QaAttempt;
  advance(attempt: QaAttempt, event: { type: string; readingId?: string; eligible?: boolean }): QaAttempt;
  canSubmit(attempt: QaAttempt): boolean;
  run(input: string, options: Record<string, unknown>): Promise<Record<string, unknown>>;
};
const harness = (globalThis as typeof globalThis & { ProductionFreeFlowAsideHarness: Harness }).ProductionFreeFlowAsideHarness;

function advanceToFreeReady() {
  let attempt = harness.newAttempt();
  for (const type of ["submit_event", "post_started", "analysis_started", "free_generation_started", "free_ready"]) {
    attempt = harness.advance(attempt, { type });
  }
  return attempt;
}

function fakeBrowser({ post = true, postObserved = post, status = 201, finalUrl, offer = null, canPurchase = false, snapshots = [], timeoutMs = 3, initiallyEnabled = true, readingStatus = "free_ready", hasCompleteFreeTurn = true }: { post?: boolean; postObserved?: boolean; status?: number; finalUrl?: string; offer?: any; canPurchase?: boolean; snapshots?: string[]; timeoutMs?: number; initiallyEnabled?: boolean; readingStatus?: string; hasCompleteFreeTurn?: boolean } = {}) {
  let url = "http://127.0.0.1:3012/#dream-input";
  let clickCount = 0;
  let postCount = 0;
  let closeCount = 0;
  let snapshotIndex = 0;
  const calls: string[] = [];
  const listeners: Record<string, Array<(value: any) => void>> = { request: [], response: [] };
  let filled = false;
  const submitButton = {
    count: async () => 1,
    isEnabled: async () => initiallyEnabled || filled,
    click: async () => {
      clickCount += 1;
      if (post) {
        postCount += 1;
        if (postObserved) {
          for (const listener of listeners.request) listener({ url: () => "http://127.0.0.1:3012/api/readings", method: () => "POST" });
          for (const listener of listeners.response) listener({ url: () => "http://127.0.0.1:3012/api/readings", request: () => ({ method: () => "POST" }), status: () => status });
        }
      }
    }
  };
  const input = { count: async () => 1, fill: async () => { filled = true; } };
  const form = {
    count: async () => 1,
    locator: (selector: string) => {
      calls.push(`form:${selector}`);
      return selector === 'textarea[name="dream"]' ? input : selector === 'button[type="submit"]' ? submitButton : { count: async () => 0 };
    }
  };
  const page = {
    locator: (selector: string) => { calls.push(selector); return selector === "form#dream-input" ? form : { count: async () => 0 }; },
    on: (event: string, listener: (value: any) => void) => { listeners[event]?.push(listener); },
    url: async () => {
      if (finalUrl && snapshotIndex >= snapshots.length) url = finalUrl;
      return url;
    },
    close: async () => { closeCount += 1; }
  };
  const options = {
    openTab: async (target: string) => { calls.push(`open:${target}`); return page; },
    snapshot: async () => ({ tree: snapshots[Math.min(snapshotIndex++, Math.max(snapshots.length - 1, 0))] ?? "" }),
    sleep: async () => undefined,
    fetch: async () => ({ ok: true, json: async () => ({ reading: { status: readingStatus, timeline: hasCompleteFreeTurn ? [{ kind: "free", status: "complete" }] : [], paidOffer: offer, canPurchaseFullReading: canPurchase } }) }),
    baseUrl: "http://127.0.0.1:3012/",
    requestStartTimeoutMs: 1,
    timeoutMs
  };
  return { page, options, calls, counts: () => ({ clickCount, postCount, closeCount }), setUrl: (next: string) => { url = next; } };
}

describe("production-flow Aside QA harness", () => {
  it("tracks a single eligible flow and pins the captured reading ID", async () => {
    const browser = fakeBrowser({
      finalUrl: "http://127.0.0.1:3012/reading/dream_test_1?token=opaque",
      snapshots: ["꿈을 읽고 있어요.", "꿈을 풀어보고 있어요."],
      offer: { promiseVersion: "paid-offer-v2", promiseSha256: "digest" },
      canPurchase: true
    });
    const result: any = await harness.run("synthetic input", browser.options);
    expect(result.attempt).toEqual({ state: "ELIGIBLE", postCount: 1, readingId: "dream_test_1" });
    expect(result.offerVersion).toBe("paid-offer-v2");
    expect(result.offerDigestPresent).toBe(true);
    expect(browser.counts()).toEqual({ clickCount: 1, postCount: 1, closeCount: 0 });
    expect(browser.calls).toContain("form#dream-input");
    expect(browser.calls).toContain('form:button[type="submit"]');
    expect(browser.calls.some(call => call.includes("getByRole"))).toBe(false);
  });

  it("allows the form submit to be disabled until the dream has been filled", async () => {
    const browser = fakeBrowser({
      initiallyEnabled: false,
      finalUrl: "http://127.0.0.1:3012/reading/dream_test_filled",
      snapshots: ["꿈을 읽고 있어요.", "꿈을 풀어보고 있어요."]
    });
    const result: any = await harness.run("synthetic input", browser.options);
    expect(result.attempt.state).toBe("INELIGIBLE");
    expect(browser.counts()).toEqual({ clickCount: 1, postCount: 1, closeCount: 0 });
  });

  it("does not treat a merely present preview as an eligible offer", async () => {
    const browser = fakeBrowser({
      finalUrl: "http://127.0.0.1:3012/reading/dream_test_2",
      snapshots: ["꿈을 읽고 있어요.", "꿈을 풀어보고 있어요."],
      offer: { promiseVersion: "paid-offer-v2", promiseSha256: "digest" },
      canPurchase: false
    });
    const result: any = await harness.run("synthetic input", browser.options);
    expect(result.attempt.state).toBe("INELIGIBLE");
    expect(browser.counts()).toEqual({ clickCount: 1, postCount: 1, closeCount: 0 });
  });

  it("does not call a click with no observed request an immediate submission failure", async () => {
    const browser = fakeBrowser({ post: false });
    const result: any = await harness.run("synthetic input", browser.options);
    expect(result.attempt.state).toBe("TIMED_OUT");
    expect(result.reason).toBe("SUBMITTED_NO_DURABLE_RESULT");
    expect(browser.counts()).toEqual({ clickCount: 1, postCount: 0, closeCount: 0 });
    expect(browser.calls).toContain("form#dream-input");
    expect(browser.calls).toContain('form:button[type="submit"]');
  });

  it("accepts durable free-result evidence when the browser misses POST telemetry", async () => {
    const browser = fakeBrowser({
      postObserved: false,
      finalUrl: "http://127.0.0.1:3012/reading/dream_telemetry_gap?token=opaque"
    });
    const result: any = await harness.run("synthetic input", browser.options);
    expect(result.attempt).toEqual({ state: "INELIGIBLE", postCount: 0, readingId: "dream_telemetry_gap" });
    expect(result).toMatchObject({ reason: null, postObservation: "missing" });
    expect(browser.counts()).toEqual({ clickCount: 1, postCount: 1, closeCount: 0 });
  });

  it("fails closed on a duplicate POST without clicking or posting again", async () => {
    const browser = fakeBrowser({ post: true });
    let extraPostAdded = false;
    const on = browser.page.on;
    browser.page.on = (event: string, listener: (value: any) => void) => on(event, value => {
      listener(value);
      if (event === "request" && !extraPostAdded) {
        extraPostAdded = true;
        listener({ url: () => "http://127.0.0.1:3012/api/readings", method: () => "POST" });
      }
    });
    const result: any = await harness.run("synthetic input", browser.options);
    expect(result.reason).toBe("DUPLICATE_POST");
    expect(result.attempt.postCount).toBe(2);
    expect(browser.counts()).toEqual({ clickCount: 1, postCount: 1, closeCount: 0 });
  });

  it("returns typed API failure for a non-2xx response", async () => {
    const browser = fakeBrowser({ status: 503 });
    const result: any = await harness.run("synthetic input", browser.options);
    expect(result.attempt.state).toBe("API_FAILED");
    expect(result.httpStatus).toBe(503);
    expect(browser.counts().clickCount).toBe(1);
  });

  it("records a POST timeout and leaves the page open without resubmitting", async () => {
    const browser = fakeBrowser({ timeoutMs: 1 });
    const result: any = await harness.run("synthetic input", browser.options);
    expect(result.attempt.state).toBe("TIMED_OUT");
    expect(result.attempt.postCount).toBe(1);
    expect(browser.counts()).toEqual({ clickCount: 1, postCount: 1, closeCount: 0 });
  });

  it("keeps timeout terminal after a POST and never auto-resubmits", () => {
    let attempt = harness.newAttempt();
    for (const type of ["submit_event", "post_started", "timed_out"]) attempt = harness.advance(attempt, { type });
    expect(attempt).toEqual({ state: "TIMED_OUT", postCount: 1, readingId: null });
    expect(harness.canSubmit(attempt)).toBe(false);
    expect(() => harness.advance(attempt, { type: "post_started" })).toThrow("terminal");
  });

  it("requires all observed Free stages before eligibility and protects the reading ID", () => {
    const freeReady = advanceToFreeReady();
    const captured = harness.advance(freeReady, { type: "reading_id_captured", readingId: "dream_test_1" });
    expect(() => harness.advance(captured, { type: "reading_id_captured", readingId: "dream_test_2" })).toThrow("Reading ID cannot change");
    expect(() => harness.advance(captured, { type: "eligible", eligible: true })).not.toThrow();
    expect(() => harness.advance(harness.newAttempt(), { type: "eligible", eligible: true })).toThrow("Invalid production flow transition");
  });
});
