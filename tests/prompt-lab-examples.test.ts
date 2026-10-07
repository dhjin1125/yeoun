import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { readFile, accessGatePassed } = vi.hoisted(() => ({
  readFile: vi.fn(),
  accessGatePassed: vi.fn(async () => true)
}));

vi.mock("node:fs/promises", () => ({ readFile }));
vi.mock("@/lib/access-gate", () => ({ accessGatePassed }));
vi.mock("@/lib/session", () => ({ getOrCreateDreamSession: vi.fn() }));

import { GET } from "@/app/api/prompt-lab/examples/route";

const fixture = {
  version: 2,
  examples: [
    { id: "favorite-6", label: "좋아한 실험 6", dream: "오래된 집과 낯선 복도를 오가는 꿈입니다.", emotion: "호기심", source: "favorite" },
    { id: "favorite-7", label: "좋아한 실험 7", dream: "친구와 물가를 걷다가 멈춰 선 꿈입니다.", emotion: "편안함", source: "favorite" },
    { id: "synthetic-three-card", label: "세 장면 합성 사례", dream: "방과 광장과 역이 이어지는 꿈입니다.", emotion: null, source: "synthetic" },
    { id: "synthetic-transition", label: "전환 장면 사례", dream: "익숙한 사람이 다른 장소에서 나타난 꿈입니다.", emotion: "당황스러움", source: "synthetic" },
    { id: "synthetic-reality", label: "현실 연결 사례", dream: "비와 신호등과 길을 함께 본 꿈입니다.", emotion: "긴장", source: "synthetic" }
  ]
};

function request(origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/prompt-lab/examples", { headers: { origin } });
}

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  readFile.mockResolvedValue(JSON.stringify(fixture));
  accessGatePassed.mockResolvedValue(true);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("paid Prompt Lab examples", () => {
  it("returns exactly five labeled examples with expected source categories", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.examples).toHaveLength(5);
    expect(body.examples.map((example: { id: string }) => example.id)).toEqual([
      "favorite-6", "favorite-7", "synthetic-three-card", "synthetic-transition", "synthetic-reality"
    ]);
    expect(body.examples.map((example: { label: string }) => example.label)).toEqual(fixture.examples.map(example => example.label));
    expect(body.examples.map((example: { source: string }) => example.source)).toEqual([
      "favorite", "favorite", "synthetic", "synthetic", "synthetic"
    ]);
    expect(body.examples.every((example: { dream: string }) => example.dream.length > 0)).toBe(true);
  });

  it("fails safely for a missing or malformed private manifest", async () => {
    readFile.mockRejectedValueOnce(new Error("missing private file"));
    expect((await GET(request())).status).toBe(503);

    readFile.mockResolvedValueOnce(JSON.stringify({ ...fixture, examples: fixture.examples.slice(0, 4) }));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("LAB_EXAMPLES_UNAVAILABLE");
  });

  it("enforces origin and Prompt Lab access gate before reading the manifest", async () => {
    expect((await GET(request("https://untrusted.test"))).status).toBe(403);
    expect(readFile).not.toHaveBeenCalled();

    accessGatePassed.mockResolvedValueOnce(false);
    expect((await GET(request())).status).toBe(403);
    expect(readFile).not.toHaveBeenCalled();
  });
});
