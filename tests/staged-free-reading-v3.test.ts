import { symbolicFreeByIdSchema } from "@/lib/ai/free-evidence";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { zodTextFormat } from "openai/helpers/zod";
import { analyzeDreamContextLocally } from "@/lib/local-engine";
import { buildConsultationPlan } from "@/lib/consultation";
import { generateDetailedAssistant, generateFreeAssistant, generateFreeAssistantV3, generatePaidCompositionV3, type FreeV3TraceSink } from "@/lib/ai";
import { generateWithLocalCodex, buildLocalCodexInstruction } from "@/lib/ai/codex-local";
import {
  stagedFreeReadingV3Error,
  stagedFreeReadingV3VisibleBodyCharacterCount,
  sha256GenerationInstruction
} from "@/lib/ai/staged-free-reading";
import { STAGED_FREE_READING_V3_CODEX_TRANSPORT_SCHEMA_VERSION, stagedFreeReadingV3CodexTransportSchema, stagedFreeReadingV3PayloadSchema, stagedFreeReadingV3Schema, symbolicFreeSchema } from "@/lib/ai/schemas";
import { STAGED_FREE_READING_V3_INSTRUCTION_VERSION, type StagedFreeReadingV3Content } from "@/lib/types";
import { STAGED_FREE_READING_V3_PROMPT } from "@/lib/ai/prompts";
import { createStagedPaidOfferV2 } from "@/lib/paid-reading-v3";
import type { StagedFreeReadingV3Payload } from "@/lib/types";
import { ObservedContextViolationError, observedContextFailureDisposition } from "@/lib/observed-context-grounding";

const correctionProjectionState = vi.hoisted(() => ({ calls: 0, lastEmotions: [] as string[] }));

vi.mock("@/lib/observed-context-grounding", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/observed-context-grounding")>();
  return {
    ...actual,
    applyObservedCorrectionState: (
      context: Parameters<typeof actual.applyObservedCorrectionState>[0],
      evidence: Parameters<typeof actual.applyObservedCorrectionState>[1]
    ) => {
      correctionProjectionState.calls += 1;
      const result = actual.applyObservedCorrectionState(context, evidence);
      correctionProjectionState.lastEmotions = [...context.emotions];
      return result;
    }
  };
});

vi.mock("@/lib/ai/codex-local", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/ai/codex-local")>(),
  localCodexConfigured: () => process.env.APP_PROFILE === "local-ai" || process.env.CODEX_LOCAL_ENABLED === "true",
  generateWithLocalCodex: vi.fn()
}));

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  correctionProjectionState.calls = 0;
  correctionProjectionState.lastEmotions = [];
});

// @ts-expect-error Promise-returning sinks are intentionally excluded from the synchronous trace contract.
const asyncTraceSink: FreeV3TraceSink = async () => {};
void asyncTraceSink;

const dream = "낡은 다리를 건너다가 중간에서 멈췄어요. 뒤에서 사람들이 다가와서 옆길로 내려갔고, 내려간 뒤에는 마음이 놓였어요.";

function validV3(): StagedFreeReadingV3Content {
  return {
    title: "다리 위에서 다른 길로 향한 꿈",
    primarySection: {
      heading: "건너던 길을 멈춘 순간",
      paragraphs: [
        "낡은 다리를 건너다 중간에서 멈춘 뒤, 뒤에서 사람들이 다가오자 옆길로 내려갔어요. 이 꿈의 중심은 끝까지 다리를 건너는 데 있지 않고, 압박이 다가오는 순간 진행하던 방향을 바꾼 데 있어요.",
        "멈춤은 실패라기보다 상황을 다시 읽는 지점에 가까워요. 다리 위에서 계속 앞으로 가야 한다고 밀어붙이지 않고 옆길을 택했다는 점에서, 이 장면은 끝까지 해내는 힘보다 지금의 부담을 알아차리고 다른 선택을 하는 판단을 더 선명하게 보여줘요."
      ],
    },
    secondarySection: {
      heading: "옆길 뒤에 찾아온 안도",
      paragraphs: [
        "옆길로 내려간 뒤 마음이 놓인 변화는 앞 장면과 분명히 달라요. 처음의 멈춤이 막막함만 뜻하는 게 아니라, 방향을 바꾼 뒤 부담이 풀리는 경험으로 이어졌어요. 그래서 꿈의 긴장은 다리를 건너지 못한 데서 끝나지 않고, 다른 길을 고른 뒤 편안해지는 쪽으로 움직여요."
      ]
    },
    coverage: {
      primary: {
        label: "다가오는 상황에서 진행 방향을 바꿈",
        evidenceQuotes: ["중간에서 멈췄어요", "뒤에서 사람들이 다가와서 옆길로 내려갔고"]
      },
      secondary: {
        label: "옆길을 택한 뒤 안도함",
        evidenceQuotes: ["내려간 뒤에는 마음이 놓였어요"]
      },
      reserved: []
    }
  };
}

function readyContext(text: string) {
  const context = analyzeDreamContextLocally(text, null).context;
  context.consultation = { ...buildConsultationPlan(context, []), ready: true, unresolved: [], question: null };
  return context;
}

describe("staged free reading V3 contract", () => {
  it("keeps the discovered axis singular and reserves only distinct, grounded unexplained candidates", () => {
    expect(STAGED_FREE_READING_V3_PROMPT).toContain("secondary에는 마지막에서 방향만 짚은 축 하나만 기록한다");
    expect(STAGED_FREE_READING_V3_PROMPT).toContain("서로 독립적인 행동·인물·장소의 흐름을 한꺼번에 합치지 않는다");
    expect(STAGED_FREE_READING_V3_PROMPT).toContain("visible prose에서 실질적 의미를 설명하지 않은 별도 후보만 기록한다");
    expect(STAGED_FREE_READING_V3_PROMPT).toContain("중복 후보는 넣지 않는다");
  });

  it("keeps the semantic schema fixed while exposing a Codex-compatible two-item array schema", () => {
    const schemaName = "dream_staged_free_reading_v3";
    const semanticJson = JSON.stringify(zodTextFormat(stagedFreeReadingV3Schema, schemaName).schema);
    const transportJson = zodTextFormat(stagedFreeReadingV3CodexTransportSchema, schemaName).schema as unknown as {
      properties: { primarySection: { properties: { paragraphs: { items: unknown; minItems?: number; maxItems?: number } } } };
    };
    const transportParagraphs = transportJson.properties.primarySection.properties.paragraphs;
    const semanticParagraphs = zodTextFormat(stagedFreeReadingV3Schema, schemaName).schema as unknown as {
      properties: { primarySection: { properties: { paragraphs: { items: unknown } } } };
    };

    expect(STAGED_FREE_READING_V3_CODEX_TRANSPORT_SCHEMA_VERSION).toBe(1);
    expect(Array.isArray(transportParagraphs.items)).toBe(false);
    expect(transportParagraphs.items).toMatchObject({ type: "string" });
    expect(transportParagraphs.minItems).toBe(2);
    expect(transportParagraphs.maxItems).toBe(2);
    expect(Array.isArray(semanticParagraphs.properties.primarySection.properties.paragraphs.items)).toBe(true);
    expect(createHash("sha256").update(semanticJson).digest("hex"))
      .toBe("969737336435fdb9ac39703837a04ce250f313b430ee5bf4b0c3f3ebd0aed76a");

    const reading = validV3();
    expect(stagedFreeReadingV3Schema.safeParse(reading).success).toBe(true);
    expect(stagedFreeReadingV3Schema.safeParse({
      ...reading,
      primarySection: { ...reading.primarySection, paragraphs: reading.primarySection.paragraphs.slice(0, 1) }
    }).success).toBe(false);
    expect(stagedFreeReadingV3Schema.safeParse({
      ...reading,
      primarySection: { ...reading.primarySection, paragraphs: [...reading.primarySection.paragraphs, "세 번째 문단도 충분히 길게 작성한 검증용 문장입니다."] }
    }).success).toBe(false);
  });

  it("keeps the existing V2 symbolic transport schema unchanged", () => {
    const schema = JSON.stringify(zodTextFormat(symbolicFreeSchema, "dream_symbol_meanings").schema);
    expect(createHash("sha256").update(schema).digest("hex"))
      .toBe("114e10897a3f23abc9e7f61994f25a66ee7652229be5453d0350392553d38809");
  });

  it("keeps an empty reserved list valid and counts only visible paragraph body code points", () => {
    const reading = validV3();
    expect(stagedFreeReadingV3Schema.safeParse(reading).success).toBe(true);
    expect(stagedFreeReadingV3Error(reading, dream)).toBeNull();
    expect(stagedFreeReadingV3VisibleBodyCharacterCount(reading)).toBeGreaterThanOrEqual(350);
    expect(stagedFreeReadingV3VisibleBodyCharacterCount(reading)).toBeLessThanOrEqual(550);
  });

  it("rejects evidence that is not an exact whitespace-normalized quote from the dream", () => {
    const reading = validV3();
    reading.coverage.primary.evidenceQuotes = ["집에서 안전함을 느꼈다"];
    expect(stagedFreeReadingV3Error(reading, dream)).toBe("AI_STAGED_FREE_V3_UNGROUNDED_EVIDENCE");

    const secondary = validV3();
    secondary.coverage.secondary.evidenceQuotes = ["마음이 놓였어요"];
    expect(stagedFreeReadingV3Error(secondary, dream)).toBeNull();

    const reserved = validV3();
    reserved.coverage.reserved = [{ label: "꿈에 없는 근거", evidenceQuotes: ["꿈에서 울었어요"] }];
    expect(stagedFreeReadingV3Error(reserved, dream)).toBe("AI_STAGED_FREE_V3_UNGROUNDED_EVIDENCE");
  });

  it("rejects a duplicated primary and secondary coverage axis", () => {
    const reading = validV3();
    reading.coverage.secondary = structuredClone(reading.coverage.primary);
    expect(stagedFreeReadingV3Error(reading, dream)).toBe("AI_STAGED_FREE_V3_DUPLICATE_COVERAGE");
  });

  it("rejects duplicated title/section headings and question-like teaser copy", () => {
    const duplicate = validV3();
    duplicate.secondarySection.heading = duplicate.title;
    expect(stagedFreeReadingV3Error(duplicate, dream)).toBe("AI_STAGED_FREE_V3_DUPLICATE_HEADING");

    const teaser = validV3();
    teaser.secondarySection.paragraphs[0] += " 어떤 의미였을까요";
    expect(stagedFreeReadingV3Error(teaser, dream)).toBe("AI_STAGED_FREE_V3_CTA");
  });

  it("rejects a body outside the general-input length target and rejects V2-only fields", () => {
    const short = validV3();
    short.primarySection.paragraphs[0] = short.primarySection.paragraphs[0].slice(0, 35);
    expect(stagedFreeReadingV3Error(short, dream)).toBe("AI_STAGED_FREE_V3_BODY_LENGTH");

    expect(stagedFreeReadingV3Error({ ...validV3(), nextQuestion: null }, dream)).toBe("AI_STAGED_FREE_V3_SCHEMA");
  });

  it("round-trips the V3 content, coverage and separate provenance fields", () => {
    const hash = "a".repeat(64);
    const payload = {
      ...validV3(),
      freeCompositionVersion: 3 as const,
      contentContractVersion: 1 as const,
      contentContract: {
        delivered: validV3().coverage.primary,
        discovered: validV3().coverage.secondary,
        reserved: validV3().coverage.reserved,
        offerEligibility: { eligible: false, perspectives: [] }
      },
      instructionVersion: STAGED_FREE_READING_V3_INSTRUCTION_VERSION,
      generationInstructionSha256: hash,
      appInstructionsSha256: hash,
      generationSource: "codex" as const
    };
    const restored = stagedFreeReadingV3PayloadSchema.parse(JSON.parse(JSON.stringify(payload)));
    expect(restored).toEqual(payload);
    expect(restored.coverage.reserved).toEqual([]);
  });

  it("uses an explicit V3 generator without routing through the V2 symbols contract", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const content = validV3();
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(content);

    const result = await generateFreeAssistantV3(readyContext(dream), "staged-free-v3-test", dream);
    const call = vi.mocked(generateWithLocalCodex).mock.calls[0][0];
    const schema = zodTextFormat(stagedFreeReadingV3CodexTransportSchema, "dream_staged_free_reading_v3").schema;
    const expectedInstruction = buildLocalCodexInstruction("free", STAGED_FREE_READING_V3_PROMPT, schema, "staged-free-v3");

    expect(result.freeCompositionVersion).toBe(3);
    expect(result.generationSource).toBe("codex");
    expect(result.generationInstructionSha256).toBe(sha256GenerationInstruction(expectedInstruction));
    expect(result.appInstructionsSha256).toBe(sha256GenerationInstruction(STAGED_FREE_READING_V3_PROMPT));
    expect(call.instructionMode).toBe("staged-free-v3");
    expect(call.preparedInstructions).toBe(expectedInstruction);
    expect(call.transportSchema).toBe(stagedFreeReadingV3CodexTransportSchema);
    expect(result.generationInstructionSha256).toBe(sha256GenerationInstruction(call.preparedInstructions!));
    expect(call.instructions).toBe(STAGED_FREE_READING_V3_PROMPT);
    expect(Object.keys((call.schema as typeof stagedFreeReadingV3Schema).shape)).not.toContain("symbols");
    expect(result).not.toHaveProperty("nextQuestion");
    expect(correctionProjectionState.calls).toBe(1);
  });

  it("preserves a later positive V3 emotion after the legacy normalizer erases the shared clause", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const syntheticDream = "처음에는 무섭지 않았지만 마지막 장면은 무서웠어요.";
    expect(readyContext(syntheticDream).emotions).not.toContain("두려움");
    const content = validV3();
    content.coverage.primary.evidenceQuotes = ["처음에는 무섭지 않았지만", "마지막 장면은 무서웠어요"];
    content.coverage.secondary.evidenceQuotes = ["마지막 장면은 무서웠어요"];
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(content);

    await generateFreeAssistantV3(readyContext(syntheticDream), "staged-free-v3-raw-emotion", syntheticDream);

    expect(correctionProjectionState.calls).toBe(1);
    expect(correctionProjectionState.lastEmotions).toContain("두려움");
    expect(vi.mocked(generateWithLocalCodex)).toHaveBeenCalledTimes(1);
  });

  it("blocks omitted ambiguous raw emotion claims before provider and permits a supported polarity control", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const ambiguousDream = "불안하지 않다고는 못했어요.";
    const ambiguousContext = readyContext(ambiguousDream);
    expect(ambiguousContext.emotions).not.toContain("불안");

    let failure: unknown;
    try {
      await generateFreeAssistantV3(ambiguousContext, "staged-free-v3-raw-ambiguity", ambiguousDream);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(ObservedContextViolationError);
    const disposition = observedContextFailureDisposition(failure);
    expect(disposition).toMatchObject({
      status: "CONTEXT_PROTOCOL_FAILURE",
      qualitySample: false,
      candidateProduced: false,
      issues: [{ path: "evidence.emotions[불안]", code: "OBSERVED_EMOTION_POLARITY_AMBIGUOUS" }]
    });
    expect(correctionProjectionState.calls).toBe(1);
    expect(correctionProjectionState.lastEmotions).not.toContain("불안");
    expect(generateWithLocalCodex).not.toHaveBeenCalled();
    expect(JSON.stringify(disposition)).not.toContain(ambiguousDream);

    correctionProjectionState.calls = 0;
    const positiveDream = "저는 낡은 복도를 걷다가 문을 열었어요. 불안했지만 싫지는 않았어요.";
    const positiveReading = validV3();
    positiveReading.coverage.primary.evidenceQuotes = ["낡은 복도를 걷다가 문을 열었어요", "불안했지만 싫지는 않았어요"];
    positiveReading.coverage.secondary.evidenceQuotes = ["불안했지만 싫지는 않았어요"];
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(positiveReading);

    await generateFreeAssistantV3(readyContext(positiveDream), "staged-free-v3-polarity-control", positiveDream);

    expect(correctionProjectionState.calls).toBe(1);
    expect(correctionProjectionState.lastEmotions).toContain("불안");
    expect(generateWithLocalCodex).toHaveBeenCalledTimes(1);
  });

  it("projects and grounds corrections once on each V3 path before any provider call", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const originalDream = "집에서 쉬었어요.";
    const userEvidence = {
      selectedEmotion: null,
      clarificationAnswers: [{ questionId: "correction-location", kind: "scene" as const, answer: "집이 아니었어요.", skipped: false }]
    };
    const context = readyContext(originalDream);

    await expect(generateFreeAssistantV3(context, "staged-free-v3-invalid-correction", originalDream, userEvidence))
      .rejects.toMatchObject({ name: "ObservedContextViolationError" });
    expect(correctionProjectionState.calls).toBe(1);
    expect(generateWithLocalCodex).not.toHaveBeenCalled();

    correctionProjectionState.calls = 0;
    await expect(generatePaidCompositionV3({
      context,
      originalDream,
      userEvidence,
      sourceFreePayload: validV3() as unknown as StagedFreeReadingV3Payload,
      purchasePromise: createStagedPaidOfferV2(),
      sessionHash: "staged-paid-v3-invalid-correction"
    })).rejects.toMatchObject({ name: "ObservedContextViolationError" });
    expect(correctionProjectionState.calls).toBe(1);
    expect(generateWithLocalCodex).not.toHaveBeenCalled();
  });

  it("keeps a successful first-pass generation identical with trace on or off", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(validV3()).mockResolvedValueOnce(validV3());
    const events: Array<{ type: string; attempt?: number; error?: string | null }> = [];
    const context = readyContext(dream);

    const withoutTrace = await generateFreeAssistantV3(context, "staged-free-v3-trace-parity", dream);
    const withTrace = await generateFreeAssistantV3(
      context,
      "staged-free-v3-trace-parity",
      dream,
      undefined,
      undefined,
      event => {
        events.push(event);
        return undefined;
      }
    );

    expect(withTrace).toEqual(withoutTrace);
    expect(vi.mocked(generateWithLocalCodex)).toHaveBeenCalledTimes(2);
    const [withoutTraceCall, withTraceCall] = vi.mocked(generateWithLocalCodex).mock.calls.map(([call]) => call);
    expect(withTraceCall.preparedInstructions).toBe(withoutTraceCall.preparedInstructions);
    expect(withTraceCall.inputJson).toBe(withoutTraceCall.inputJson);
    expect(withTrace.generationInstructionSha256).toBe(withoutTrace.generationInstructionSha256);
    expect(events.map(({ type, attempt }) => [type, attempt])).toEqual([["candidate", 1], ["validation", 1]]);
    expect(events[1].error).toBeNull();
  });

  it("traces a repair while preserving the same calls and outputs as trace-off", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const rejectedWithoutTrace = validV3();
    rejectedWithoutTrace.primarySection.paragraphs[0] = rejectedWithoutTrace.primarySection.paragraphs[0].slice(0, 35);
    const rejectedWithTrace = validV3();
    rejectedWithTrace.primarySection.paragraphs[0] = rejectedWithTrace.primarySection.paragraphs[0].slice(0, 35);
    const acceptedWithoutTrace = validV3();
    const acceptedWithTrace = validV3();
    vi.mocked(generateWithLocalCodex)
      .mockResolvedValueOnce(rejectedWithoutTrace)
      .mockResolvedValueOnce(acceptedWithoutTrace)
      .mockResolvedValueOnce(rejectedWithTrace)
      .mockResolvedValueOnce(acceptedWithTrace);
    const events: Array<{ type: string; attempt?: number; error?: string | null; validatorError?: string }> = [];
    const context = readyContext(dream);

    const withoutTrace = await generateFreeAssistantV3(context, "staged-free-v3-trace-repair-parity", dream);
    const withTrace = await generateFreeAssistantV3(
      context,
      "staged-free-v3-trace-repair-parity",
      dream,
      undefined,
      undefined,
      event => {
        events.push(event);
        if (event.type === "candidate" && event.attempt === 1) event.rawOutput.title = "trace mutation";
        return undefined;
      }
    );

    expect(withTrace).toEqual(withoutTrace);
    expect(vi.mocked(generateWithLocalCodex)).toHaveBeenCalledTimes(4);
    const calls = vi.mocked(generateWithLocalCodex).mock.calls.map(([call]) => call);
    expect(calls[2].preparedInstructions).toBe(calls[0].preparedInstructions);
    expect(calls[3].preparedInstructions).toBe(calls[1].preparedInstructions);
    expect(calls[2].inputJson).toBe(calls[0].inputJson);
    expect(calls[3].inputJson).toBe(calls[1].inputJson);
    expect(JSON.parse(calls[3].inputJson).previousReading.title).toBe(rejectedWithTrace.title);
    expect(withTrace.generationInstructionSha256).toBe(withoutTrace.generationInstructionSha256);
    expect(events.map(({ type, attempt }) => [type, attempt])).toEqual([
      ["candidate", 1],
      ["validation", 1],
      ["repair_requested", 1],
      ["candidate", 2],
      ["validation", 2]
    ]);
    expect(events[1].error).toBe("AI_STAGED_FREE_V3_BODY_LENGTH");
    expect(events[2]).toMatchObject({ type: "repair_requested", attempt: 1, validatorError: "AI_STAGED_FREE_V3_BODY_LENGTH" });
    expect((events[2] as { repairInstructionSha256?: string }).repairInstructionSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(events[4].error).toBeNull();
  });

  it("preserves final validator failure with trace on or off", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const invalid = () => {
      const content = validV3();
      content.primarySection.paragraphs[0] = content.primarySection.paragraphs[0].slice(0, 35);
      return content;
    };
    vi.mocked(generateWithLocalCodex)
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid())
      .mockResolvedValueOnce(invalid());
    const events: Array<{ type: string; attempt?: number; error?: string | null; validatorError?: string }> = [];
    const context = readyContext(dream);

    const withoutTrace = generateFreeAssistantV3(context, "staged-free-v3-trace-failure-parity", dream);
    const withTrace = generateFreeAssistantV3(
      context,
      "staged-free-v3-trace-failure-parity",
      dream,
      undefined,
      undefined,
      event => {
        events.push(event);
        return undefined;
      }
    );
    const [offError, onError] = await Promise.all([
      withoutTrace.then(() => null, error => error),
      withTrace.then(() => null, error => error)
    ]);

    expect(offError).toMatchObject({ code: "FREE_READING_UNAVAILABLE" });
    expect(onError).toMatchObject({ code: offError.code, message: offError.message });
    expect(vi.mocked(generateWithLocalCodex)).toHaveBeenCalledTimes(4);
    const calls = vi.mocked(generateWithLocalCodex).mock.calls.map(([call]) => call);
    expect(calls[0].inputJson).toBe(calls[1].inputJson);
    expect(calls[2].inputJson).toBe(calls[3].inputJson);
    expect(events.map(({ type, attempt }) => [type, attempt])).toEqual([
      ["candidate", 1],
      ["validation", 1],
      ["repair_requested", 1],
      ["candidate", 2],
      ["validation", 2],
      ["generation_failure", 2]
    ]);
    expect(events[4].error).toBe("AI_STAGED_FREE_V3_BODY_LENGTH");
  });

  it("ignores trace sink failures so diagnostics cannot fail generation", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce(validV3());

    const result = await generateFreeAssistantV3(
      readyContext(dream),
      "staged-free-v3-trace-error-test",
      dream,
      undefined,
      undefined,
      () => { throw new Error("trace sink failed"); }
    );

    expect(result.title).toBe(validV3().title);
    expect(result.freeCompositionVersion).toBe(3);
  });

  it("changes the instruction identity when one application-instruction character changes", () => {
    const schema = zodTextFormat(stagedFreeReadingV3Schema, "dream_staged_free_reading_v3").schema;
    const first = buildLocalCodexInstruction("free", "V3 prompt", schema, "staged-free-v3");
    const changed = buildLocalCodexInstruction("free", "V3 prompt ", schema, "staged-free-v3");
    expect(sha256GenerationInstruction(first)).not.toBe(sha256GenerationInstruction(changed));
    expect(first).not.toContain("600~900자");
    expect(first).not.toContain("상징 자체를 먼저 풀고");
  });

  it("leaves unspecified product generation on the V2 symbolic contract", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    vi.mocked(generateWithLocalCodex).mockResolvedValueOnce({
      symbols: [{
        title: "연을 날리는 장면",
        evidenceRef: { startId: "E2", endId: "E3" },
        meaning: "연을 띄워 올린 행동은 마음을 바깥으로 표현하고 싶은 흐름을 떠올리게 해요. 바람에 맡긴 채 바라보는 모습은 결과를 직접 쥐기보다 상황이 이어지는 모습을 지켜보는 태도와 맞닿아 있어요.",
        referenceIds: []
      }],
      integratedReading: {
        title: "연을 따라 이어진 꿈",
        paragraphs: ["꿈에서 연을 날린 장면은 표현을 밖으로 보내는 행동에 먼저 시선이 가요. 연은 손에 잡혀 있지만 하늘의 바람을 함께 받아야 움직여서, 내 뜻과 주변 상황이 함께 작용하는 모습으로 읽을 수 있어요."],
        evidenceRefs: [{ startId: "E2", endId: "E3" }]
      },
      nextQuestion: null
    }).mockResolvedValueOnce({severity:"pass",confidence:"high",verdict:"pass",reasonCodes:[],reason:"통과",findings:[],offerEligibility:{eligible:false,perspectives:[]}});

    const result = await generateFreeAssistant(readyContext("꿈에서 연을 날렸어요."), "staged-free-v2-default", "꿈에서 연을 날렸어요.");
    const call = vi.mocked(generateWithLocalCodex).mock.calls[0][0];
    expect(result.freeCompositionVersion).toBe(2);
    expect(call.schema).toBe(symbolicFreeByIdSchema);
    expect(call.instructionMode).toBeUndefined();
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
    expect(result).not.toHaveProperty("instructionVersion");
    expect(result).not.toHaveProperty("generationInstructionSha256");
  });

  it("keeps correction projection out of both legacy V2 generation paths", async () => {
    vi.stubEnv("APP_PROFILE", "review");
    const context = readyContext(dream);

    await generateFreeAssistant(context, "v2-free-no-correction-projection", dream);
    await generateDetailedAssistant(context, "v2-paid-no-correction-projection", "none", dream);

    expect(correctionProjectionState.calls).toBe(0);
  });
});
