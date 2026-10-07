import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialReadingOnce } from "@/lib/initial-reading-request";
import { TestRepository } from "./helpers/repository";
import type { ReadingRecord } from "@/lib/types";

const input = { dream: "합성 테스트 꿈", emotion: null };
const record = (sessionHash = "owner") => ({ id: "synthetic-reading", sessionHash, expiresAt: new Date(Date.now() + 3600000).toISOString() } as ReadingRecord);
afterEach(() => vi.restoreAllMocks());

describe("initial reading duplicate admission", () => {
  it("rejects concurrent requests before starting a second generation", async () => {
    const repository = new TestRepository();
    let finish!: (r: ReadingRecord) => void;
    const generate = vi.fn(() => new Promise<ReadingRecord>(resolve => { finish = resolve; }));
    const first = createInitialReadingOnce("owner", input, repository, generate);
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    await expect(createInitialReadingOnce("owner", input, repository, generate)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledOnce();
    finish(record());
    await first;
  });
  it("reuses a completed result for the same session and content", async () => {
    const repository = new TestRepository();
    const result = record();
    const generate = vi.fn(async () => { await repository.saveReading(result); return result; });
    await createInitialReadingOnce("owner", input, repository, generate);
    expect(await createInitialReadingOnce("owner", input, repository, generate)).toEqual(result);
    expect(generate).toHaveBeenCalledOnce();
  });
  it("does not reuse results across sessions or after deletion", async () => {
    const repository = new TestRepository();
    const generate = vi.fn(async () => { const result = record(); await repository.saveReading(result); return result; });
    await createInitialReadingOnce("owner", input, repository, generate);
    await createInitialReadingOnce("other", input, repository, async () => record("other"));
    await repository.deleteReading("synthetic-reading");
    await createInitialReadingOnce("owner", input, repository, generate);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it("releases the lease after failure so the user can retry", async () => {
    const repository = new TestRepository();
    await expect(createInitialReadingOnce("owner", input, repository, async () => { throw new Error("synthetic failure"); })).rejects.toThrow("synthetic failure");
    await expect(createInitialReadingOnce("owner", input, repository, async () => record())).resolves.toMatchObject({ id: "synthetic-reading" });
  });
  it("fails closed before generation if request storage is unavailable", async () => {
    const repository = new TestRepository();
    vi.spyOn(repository, "mutateConversationGuard").mockRejectedValue(new Error("synthetic storage failure"));
    const generate = vi.fn(async () => record());
    await expect(createInitialReadingOnce("owner", input, repository, generate)).rejects.toMatchObject({ status: 503 });
    expect(generate).not.toHaveBeenCalled();
  });
});
