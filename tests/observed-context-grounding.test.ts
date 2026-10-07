import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DreamContext, DreamScene } from "@/lib/types";

const gateTestState = vi.hoisted(() => ({ injectUnsupportedPlaceDuringRebuild: false }));

vi.mock("@/lib/local-engine", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/local-engine")>();
  return {
    ...actual,
    analyzeDreamContextLocally: (...args: Parameters<typeof actual.analyzeDreamContextLocally>) => {
      const result = actual.analyzeDreamContextLocally(...args);
      if (gateTestState.injectUnsupportedPlaceDuringRebuild) result.context.places.push("병원");
      return result;
    }
  };
});

vi.mock("@/lib/ai/codex-local", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/ai/codex-local")>(),
  localCodexConfigured: () => true,
  generateWithLocalCodex: vi.fn()
}));

import { analyzeDreamContextLocally, extractObservedEmotionsFromRawDream } from "@/lib/local-engine";
import { buildConsultationPlan } from "@/lib/consultation";
import { applyObservedCorrectionState, archiveObservedContextIfGrounded, assertObservedContextGrounded, ObservedContextViolationError, observedContextFailureDisposition } from "@/lib/observed-context-grounding";
import { generateFreeAssistantV3 } from "@/lib/ai";
import { generateWithLocalCodex } from "@/lib/ai/codex-local";
import type { GenerationUserEvidence } from "@/lib/types";

afterEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  gateTestState.injectUnsupportedPlaceDuringRebuild = false;
});

function userEvidence(): GenerationUserEvidence {
  return { selectedEmotion: null, clarificationAnswers: [] };
}

function contextFor(text: string): DreamContext {
  return analyzeDreamContextLocally(text, null).context;
}

function expectViolation(run: () => void, path: string, code: string): ObservedContextViolationError {
  try {
    run();
    throw new Error("expected grounding violation");
  } catch (error) {
    expect(error).toBeInstanceOf(ObservedContextViolationError);
    expect((error as ObservedContextViolationError).issues).toContainEqual({ path, code });
    return error as ObservedContextViolationError;
  }
}

describe("observed context grounding", () => {
  it("preserves distinct explicit embarrassment and actual strangeness labels", () => {
    const flustered = contextFor("교실에 들어가자 당황했어요.");
    const strange = contextFor("교실이 낯설게 느껴졌어요.");
    expect(flustered.emotions).toContain("당황스러움");
    expect(flustered.emotions).not.toContain("낯섦");
    expect(strange.emotions).toContain("낯섦");
  });

  it("does not promote historical school references into scene places", () => {
    const context = contextFor("학교 다니던 때 만난 친구가 꿈에 나왔어요.");
    expect(context.places).not.toContain("학교");
    expect(contextFor("학교에 도착했을 때 문을 열었어요.").places).toContain("학교");
    expect(contextFor("예전에 다니던 학교에 들어갔어요.").places).toContain("학교");
    const workBackground = "회사 다니던 때 만난 친구가 꿈에 나왔어요.";
    expect(contextFor(workBackground).places).not.toContain("일터");
    expect(contextFor("회사에 들어갔어요.").places).toContain("일터");
    expect(contextFor("예전 회사에서 일하고 있었어요.").places).toContain("일터");
    expect(contextFor("회사 다니던 때 다시 회사에 들어갔어요.").places).toContain("일터");
    const fabricatedWorkplace = contextFor(workBackground);
    fabricatedWorkplace.places.push("일터");
    expectViolation(() => assertObservedContextGrounded(fabricatedWorkplace, { rawDream: workBackground, userEvidence: userEvidence() }), `places[${fabricatedWorkplace.places.length - 1}]`, "OBSERVED_PLACE_NOT_GROUNDED");
    expect(contextFor("예전 회사에 도착했어요.").places).toContain("일터");
  });

  it("keeps actual school and explicit home scenes while leaving a bare room unclassified", () => {
    expect(contextFor("학교에 들어갔어요.").places).toContain("학교");
    expect(contextFor("방에 들어갔어요.").places).not.toContain("집");
    expect(contextFor("집에서 쉬었어요.").places).toContain("집");
  });

  it("uses lexical place boundaries and accepts ordinary standalone road forms", () => {
    expect(contextFor("복도로 들어갔어요.").places).not.toContain("길");
    expect(contextFor("도로에서 뛰었어요.").places).toContain("길");
    expect(contextFor("도로를 걸었어요.").places).toContain("길");
    expect(contextFor("도로 위에 서 있었어요.").places).toContain("길");
    expect(contextFor("도로로는 계속 걸었어요.").places).toContain("길");
    expect(contextFor("강을 따라 걸었어요.").places).toContain("물가");
    expect(contextFor("현관문 앞에 서 있었어요.").places).toContain("집");
    expect(contextFor("집에서는 편하게 쉬었어요.").places).toContain("집");
  });

  it("keeps common explicit emotion inflections in the extractor and independent gate", () => {
    const cases = [
      ["기뻤어요.", "기쁨"],
      ["슬펐어요.", "슬픔"],
      ["두려웠어요.", "두려움"],
      ["편하게 쉬었어요.", "안도감"]
    ] as const;
    for (const [dream, emotion] of cases) {
      const context = contextFor(dream);
      expect(context.emotions).toContain(emotion);
      expect(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: userEvidence() })).not.toThrow();
    }
  });

  it("rejects manually fabricated top-level place, emotion, and person observations", () => {
    const place = contextFor("긴 복도에서 문을 열었어요.");
    place.places.push("병원");
    expectViolation(() => assertObservedContextGrounded(place, { rawDream: "긴 복도에서 문을 열었어요.", userEvidence: userEvidence() }), `places[${place.places.length - 1}]`, "OBSERVED_PLACE_NOT_GROUNDED");

    const emotion = contextFor("교실에 들어가 당황했어요.");
    emotion.emotions = ["낯섦"];
    expectViolation(() => assertObservedContextGrounded(emotion, { rawDream: "교실에 들어가 당황했어요.", userEvidence: userEvidence() }), "emotions[0]", "OBSERVED_EMOTION_NOT_GROUNDED");

    const person = contextFor("복도에서 문을 열었어요.");
    person.people.push("어머니");
    expectViolation(() => assertObservedContextGrounded(person, { rawDream: "복도에서 문을 열었어요.", userEvidence: userEvidence() }), `people[${person.people.length - 1}]`, "OBSERVED_PERSON_NOT_GROUNDED");
  });

  it("requires positive emotion, place, person, and dream evidence", () => {
    const explicitlyAbsentAnxiety = contextFor("불안감이 전혀 없었어요.");
    expect(explicitlyAbsentAnxiety.emotions).not.toContain("불안");
    expect(explicitlyAbsentAnxiety.scenes.every(scene => scene.emotion !== "불안")).toBe(true);
    expect(() => assertObservedContextGrounded(explicitlyAbsentAnxiety, {
      rawDream: "불안감이 전혀 없었어요.", userEvidence: userEvidence()
    })).not.toThrow();

    const negativeEmotions = [
      ["행복하지 않았어요.", "기쁨"],
      ["기쁘지 않았어요.", "기쁨"],
      ["슬프지 않았어요.", "슬픔"],
      ["두렵지는 않았어요.", "두려움"],
      ["편안하지 않았어요.", "안도감"],
      ["불안감은 없었어요.", "불안"],
      ["불안감이 전혀 없었어요.", "불안"],
      ["불안하지는 않았어요.", "불안"],
      ["안 무서웠어요.", "두려움"],
      ["당황하지는 않았어요.", "당황스러움"],
      ["당황하진 않았어요.", "당황스러움"]
    ] as const;
    for (const [dream, emotion] of negativeEmotions) {
      const context = contextFor(dream);
      context.emotions.push(emotion);
      expectViolation(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: userEvidence() }), `emotions[${context.emotions.length - 1}]`, "OBSERVED_EMOTION_NOT_GROUNDED");
    }

    const unsupportedNegation = "불안하지 않다고는 못했어요.";
    const ambiguousEmotion = contextFor(unsupportedNegation);
    ambiguousEmotion.emotions.push("불안");
    expectViolation(() => assertObservedContextGrounded(ambiguousEmotion, { rawDream: unsupportedNegation, userEvidence: userEvidence() }), `emotions[${ambiguousEmotion.emotions.length - 1}]`, "OBSERVED_EMOTION_POLARITY_AMBIGUOUS");

    const positiveEmotions = [
      ["불안했어요.", "불안"],
      ["당황했어요.", "당황스러움"],
      ["무서웠어요.", "두려움"]
    ] as const;
    for (const [dream, emotion] of positiveEmotions) {
      const context = contextFor(dream);
      context.emotions.push(emotion);
      expect(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: userEvidence() })).not.toThrow();
    }

    const negatedPlace = contextFor("학교에 가지 않았어요.");
    negatedPlace.places.push("학교");
    expectViolation(() => assertObservedContextGrounded(negatedPlace, { rawDream: "학교에 가지 않았어요.", userEvidence: userEvidence() }), `places[${negatedPlace.places.length - 1}]`, "OBSERVED_PLACE_NOT_GROUNDED");

    const absentPerson = contextFor("어머니는 꿈에 나오지 않았어요.");
    absentPerson.people.push("어머니");
    expectViolation(() => assertObservedContextGrounded(absentPerson, { rawDream: "어머니는 꿈에 나오지 않았어요.", userEvidence: userEvidence() }), `people[${absentPerson.people.length - 1}]`, "OBSERVED_PERSON_NOT_GROUNDED");

    const realityOnly = contextFor("복도에서 문을 열었어요. 현실에서는 불안했어요.");
    realityOnly.emotions.push("불안");
    expectViolation(() => assertObservedContextGrounded(realityOnly, { rawDream: "복도에서 문을 열었어요. 현실에서는 불안했어요.", userEvidence: userEvidence() }), `emotions[${realityOnly.emotions.length - 1}]`, "OBSERVED_EMOTION_NOT_GROUNDED");
  });

  it("limits emotion negation to the same predicate and fails closed on ambiguous polarity", () => {
    const cases = [
      "무서웠지만 도망가지는 않았어요.",
      "불안했지만 당황하지는 않았어요.",
      "불안했지만 아무도 오지 않았어요."
    ];

    for (const dream of cases) {
      const context = contextFor(dream);
      expect(context.emotions.length).toBeGreaterThan(0);
      expect(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: userEvidence() })).not.toThrow();
    }

    const intensifiedNegative = "전혀 무섭지 않았어요.";
    const negativeContext = contextFor(intensifiedNegative);
    negativeContext.emotions.push("두려움");
    expectViolation(() => assertObservedContextGrounded(negativeContext, {
      rawDream: intensifiedNegative,
      userEvidence: userEvidence()
    }), `emotions[${negativeContext.emotions.length - 1}]`, "OBSERVED_EMOTION_NOT_GROUNDED");

    const ambiguous = "불안하지 않다고는 못했어요.";
    const ambiguousContext = contextFor(ambiguous);
    expect(ambiguousContext.emotions).not.toContain("불안");
    expectViolation(() => assertObservedContextGrounded(ambiguousContext, {
      rawDream: ambiguous,
      userEvidence: userEvidence()
    }), "evidence.emotions[불안]", "OBSERVED_EMOTION_POLARITY_AMBIGUOUS");
    ambiguousContext.emotions.push("불안");
    expectViolation(() => assertObservedContextGrounded(ambiguousContext, {
      rawDream: ambiguous,
      userEvidence: userEvidence()
    }), `emotions[${ambiguousContext.emotions.length - 1}]`, "OBSERVED_EMOTION_POLARITY_AMBIGUOUS");
  });

  it("applies explicit clarification corrections and rejects unresolved correction slots", () => {
    const dream = "집에서 쉬었어요.";
    const correctedText = "집에서 쉬었어요. 집이 아니라 병원에 있었어요.";
    const corrected = contextFor(correctedText);
    const correctionEvidence = {
      selectedEmotion: null,
      clarificationAnswers: [{ questionId: "correction-location", kind: "scene" as const, answer: "집이 아니라 병원에 있었어요.", skipped: false }]
    };
    applyObservedCorrectionState(corrected, { rawDream: dream, userEvidence: correctionEvidence });
    expect(corrected.places).toContain("병원");
    expect(corrected.places).not.toContain("집");
    expect(corrected.scenes.every(scene => scene.place !== "집")).toBe(true);
    expect(() => assertObservedContextGrounded(corrected, { rawDream: dream, userEvidence: correctionEvidence })).not.toThrow();

    const stale = { ...corrected, places: [...corrected.places, "집"] };
    expectViolation(() => assertObservedContextGrounded(stale, { rawDream: dream, userEvidence: correctionEvidence }), `places[${stale.places.length - 1}]`, "OBSERVED_PLACE_NOT_GROUNDED");

    const ambiguousEvidence = {
      selectedEmotion: null,
      clarificationAnswers: [{ questionId: "correction-location", kind: "scene" as const, answer: "장소는 병원이었어요.", skipped: false }]
    };
    const ambiguous = contextFor("집에서 쉬었어요. 장소는 병원이었어요.");
    applyObservedCorrectionState(ambiguous, { rawDream: dream, userEvidence: ambiguousEvidence });
    expect(ambiguous.places).not.toContain("집");
    expect(ambiguous.scenes.every(scene => scene.place !== "집")).toBe(true);
    expectViolation(() => assertObservedContextGrounded(ambiguous, { rawDream: dream, userEvidence: ambiguousEvidence }), "clarificationAnswers[0]", "OBSERVED_CORRECTION_STATE_AMBIGUOUS");

    const invalidationWithoutReplacement = {
      selectedEmotion: null,
      clarificationAnswers: [{ questionId: "correction-location", kind: "scene" as const, answer: "집이 아니었어요.", skipped: false }]
    };
    const staleHome = contextFor(dream);
    applyObservedCorrectionState(staleHome, { rawDream: dream, userEvidence: invalidationWithoutReplacement });
    expect(staleHome.places).not.toContain("집");
    expect(staleHome.scenes.every(scene => scene.place !== "집")).toBe(true);
    const unresolved = expectViolation(() => assertObservedContextGrounded(staleHome, { rawDream: dream, userEvidence: invalidationWithoutReplacement }), "clarificationAnswers[0]", "OBSERVED_CORRECTION_STATE_AMBIGUOUS");
    expect(unresolved.issues).toEqual([{ path: "clarificationAnswers[0]", code: "OBSERVED_CORRECTION_STATE_AMBIGUOUS" }]);

    const unknownReplacementEvidence = {
      selectedEmotion: null,
      clarificationAnswers: [{ questionId: "correction-location", kind: "scene" as const, answer: "집이 아니라 다른 장소였어요.", skipped: false }]
    };
    const unknownReplacement = contextFor(dream);
    applyObservedCorrectionState(unknownReplacement, { rawDream: dream, userEvidence: unknownReplacementEvidence });
    expect(unknownReplacement.places).not.toContain("집");
    expect(unknownReplacement.scenes.every(scene => scene.place !== "집")).toBe(true);
    expectViolation(() => assertObservedContextGrounded(unknownReplacement, { rawDream: dream, userEvidence: unknownReplacementEvidence }), "clarificationAnswers[0]", "OBSERVED_CORRECTION_STATE_AMBIGUOUS");

    const schoolReplacementEvidence = {
      selectedEmotion: null,
      clarificationAnswers: [{ questionId: "correction-location", kind: "scene" as const, answer: "집이 아니라 학교였어요.", skipped: false }]
    };
    const correctedSchool = contextFor(dream);
    applyObservedCorrectionState(correctedSchool, { rawDream: dream, userEvidence: schoolReplacementEvidence });
    correctedSchool.places.push("학교");
    expect(correctedSchool.places).not.toContain("집");
    expect(() => assertObservedContextGrounded(correctedSchool, { rawDream: dream, userEvidence: schoolReplacementEvidence })).not.toThrow();

    const additiveEvidence = {
      selectedEmotion: null,
      clarificationAnswers: [{ questionId: "scene-2", kind: "scene" as const, answer: "학교에 들어갔어요.", skipped: false }]
    };
    const additive = contextFor("집에서 쉬었어요. 학교에 들어갔어요.");
    expect(() => assertObservedContextGrounded(additive, { rawDream: dream, userEvidence: additiveEvidence })).not.toThrow();
  });

  it("rejects unsupported scene assignments even when the same fact exists elsewhere", () => {
    const dream = "집에서 쉬었어요. 학교에 들어가 당황했어요.";
    const context = contextFor(dream);
    const second = context.scenes[1];
    expect(second).toBeDefined();
    expect(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: userEvidence() })).not.toThrow();
    second!.place = "집";
    expectViolation(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: userEvidence() }), "scenes[1].place", "OBSERVED_SCENE_ASSOCIATION_NOT_GROUNDED");

    const emotionDream = "회사 복도에서 문을 열고 무서웠어요. 학교에 들어가 기뻤어요.";
    const emotionContext = contextFor(emotionDream);
    const emotionScene = emotionContext.scenes[0];
    expect(emotionScene).toBeDefined();
    expect(() => assertObservedContextGrounded(emotionContext, { rawDream: emotionDream, userEvidence: userEvidence() })).not.toThrow();
    emotionScene!.emotion = "기쁨";
    expectViolation(() => assertObservedContextGrounded(emotionContext, { rawDream: emotionDream, userEvidence: userEvidence() }), "scenes[0].emotion", "OBSERVED_SCENE_ASSOCIATION_NOT_GROUNDED");
  });

  it("fails closed for a scene whose source span cannot be proven", () => {
    const dream = "집에서 쉬었어요.";
    const context = contextFor(dream);
    context.scenes[0] = { ...context.scenes[0], place: "집" } as DreamScene;
    expectViolation(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: userEvidence() }), "scenes[0]", "OBSERVED_PROVENANCE_MISSING");
  });

  it("allows empty optional observations and ordinary grounded scenes", () => {
    const empty = contextFor("문을 열었어요.");
    expect(() => assertObservedContextGrounded(empty, { rawDream: "문을 열었어요.", userEvidence: userEvidence() })).not.toThrow();

    const dream = "회사 복도에서 문을 찾았고 무서웠어요.";
    const ordinary = contextFor(dream);
    expect(() => assertObservedContextGrounded(ordinary, { rawDream: dream, userEvidence: userEvidence() })).not.toThrow();
  });

  it("grounds a rich multi-scene station dream before V3 free generation", () => {
    const dream = "꿈에서 오래된 기차역에 혼자 도착했는데 안내판 글자가 계속 바뀌었어요. 열차를 놓칠까 봐 뛰다가 빈 의자 밑에서 젖은 편지를 발견했어요. 역무원에게 물어보니 다른 승강장을 알려줬고, 그 길에서 예전에 헤어진 친구를 잠깐 만났어요. 친구는 말없이 낡은 표를 건넸고, 저는 열차를 타지 않고 플랫폼 끝에 남아 편지를 읽다가 깼어요. 깬 뒤 묘하게 후련하고 아쉬웠어요.";
    const context = contextFor(dream);
    context.emotions = [...new Set([...context.emotions, ...extractObservedEmotionsFromRawDream(dream)])];
    applyObservedCorrectionState(context, { rawDream: dream, userEvidence: userEvidence() });
    expect(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: userEvidence() })).not.toThrow();
  });

  it("grounds a disrupted-presentation and divergent-family-path dream before V3 free generation", () => {
    const dream = "회사 강당에서 많은 사람들 앞에 서서 발표를 시작했는데, 준비한 자료가 갑자기 화면에 나오지 않아 잠시 말을 멈췄어요. 뒤쪽에 앉아 있던 예전 동료가 말없이 종이 한 장을 건네줬고, 그걸 보고 발표를 끝까지 마쳤어요. 발표가 끝난 뒤에는 혼자 예전에 살던 집으로 갔는데 가구는 하나도 없고 창문만 열려 있었어요. 방을 둘러보다가 현관문을 잠그지 않은 채 밖으로 나왔고, 골목 끝에서 가족 한 명이 반대편 길로 걸어가는 모습을 봤어요. 저는 그 사람을 부르지 않고 다른 방향으로 걸어갔어요.";
    const context = contextFor(dream);
    context.emotions = [...new Set([...context.emotions, ...extractObservedEmotionsFromRawDream(dream)])];
    applyObservedCorrectionState(context, { rawDream: dream, userEvidence: userEvidence() });
    expect(context.scenes[3]?.place).toBe("길");
    expect(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: userEvidence() })).not.toThrow();
  });

  it("accepts an explicit global emotion but does not attach it to a scene without local evidence", () => {
    const dream = "복도에서 문을 열었어요.";
    const context = contextFor(dream);
    const evidence = { selectedEmotion: "무서웠어요" as const, clarificationAnswers: [] };
    context.emotions.push("두려움");
    expect(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: evidence })).not.toThrow();

    context.scenes[0]!.emotion = "두려움";
    expectViolation(() => assertObservedContextGrounded(context, { rawDream: dream, userEvidence: evidence }), "scenes[0].emotion", "OBSERVED_SCENE_ASSOCIATION_NOT_GROUNDED");
  });

  it("does not archive or freeze a prepared artifact when Boundary A fails", () => {
    const dream = "긴 복도에서 문을 열었어요.";
    const context = contextFor(dream);
    context.places.push("병원");
    const archivePreparedContext = vi.fn(async () => ({ id: "must-not-be-written" }));
    expect(() => archiveObservedContextIfGrounded(context, { rawDream: dream, userEvidence: userEvidence() }, archivePreparedContext))
      .toThrow(ObservedContextViolationError);
    expect(archivePreparedContext).not.toHaveBeenCalled();
  });

  it("does not leak evidence excerpts in typed violations", () => {
    const privatePhrase = "비공개표현에서 병원으로 갔어요.";
    const context = contextFor(privatePhrase);
    context.places.push("학교");
    try {
      assertObservedContextGrounded(context, { rawDream: privatePhrase, userEvidence: userEvidence() });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain(privatePhrase);
      expect((error as Error).message).not.toContain(privatePhrase);
    }
  });

  it("classifies Boundary B grounding failures without exposing dream evidence", () => {
    const error = new ObservedContextViolationError([{ path: "places[0]", code: "OBSERVED_PLACE_NOT_GROUNDED" }]);
    const disposition = observedContextFailureDisposition(error);
    expect(disposition).toEqual({
      status: "CONTEXT_PROTOCOL_FAILURE",
      protocolFailure: true,
      qualitySample: false,
      candidateProduced: false,
      errorCode: "V3_OBSERVED_CONTEXT_UNGROUNDED",
      issues: [{ path: "places[0]", code: "OBSERVED_PLACE_NOT_GROUNDED" }]
    });
    expect(observedContextFailureDisposition(new Error("transport"))).toBeNull();
  });

  it("blocks a fabricated observation rebuilt inside the V3 generation boundary before any provider call", async () => {
    vi.stubEnv("APP_PROFILE", "local-ai");
    const dream = "긴 복도에서 문을 열었어요.";
    const context = contextFor(dream);
    context.consultation = { ...buildConsultationPlan(context, []), ready: true, unresolved: [], question: null };
    gateTestState.injectUnsupportedPlaceDuringRebuild = true;

    await expect(generateFreeAssistantV3(context, "grounding-boundary-test", dream, userEvidence()))
      .rejects.toMatchObject({ code: "V3_OBSERVED_CONTEXT_UNGROUNDED" });
    expect(vi.mocked(generateWithLocalCodex)).not.toHaveBeenCalled();
  });
});
