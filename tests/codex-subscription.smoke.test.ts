import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as localProvider from "@/lib/ai/codex-local";
import { analyzeDreamInput, generateDetailedAssistant, generateFreeAssistant, prepareConsultation } from "@/lib/ai";
import { analyzeDreamContextLocally, applyClarificationsToContext } from "@/lib/local-engine";

const shouldRun = process.env.RUN_CODEX_SUBSCRIPTION_SMOKE === "true";
const originalEnvironment = {
  AI_MODE: process.env.AI_MODE,
  CODEX_LOCAL_ENABLED: process.env.CODEX_LOCAL_ENABLED,
  CODEX_CLI_PATH: process.env.CODEX_CLI_PATH,
  CODEX_LOCAL_MODEL: process.env.CODEX_LOCAL_MODEL,
  CODEX_LOCAL_REASONING_EFFORT: process.env.CODEX_LOCAL_REASONING_EFFORT,
  CODEX_LOCAL_TIMEOUT_MS: process.env.CODEX_LOCAL_TIMEOUT_MS,
  VERCEL: process.env.VERCEL
};

describe.runIf(shouldRun)("signed-in Codex subscription smoke test", () => {
  it("turns the consulting role clarification into a reviewed integrated report", async()=> {
    process.env.CODEX_LOCAL_REASONING_EFFORT="max";
    const provider=localProvider.generateWithLocalCodex;
    const outputs:unknown[]=[];
    const spy=vi.spyOn(localProvider,"generateWithLocalCodex").mockImplementation(async input=>{
      const result=await provider(input);
      outputs.push({schema:input.schemaName,result});
      if (process.env.CODEX_SMOKE_PRINT_OUTPUTS === "true") console.info(JSON.stringify({syntheticOutput:{schema:input.schemaName,result}}));
      return result;
    });
    try {
    const dream = "누가 쫒아오고 막 때리고 피나오고 그런꿈";
    const initial = analyzeDreamContextLocally(dream,null).context;
    const first = await generateFreeAssistant(initial,"consulting-live-smoke",dream);
    const userEvidence = {selectedEmotion:null,clarificationAnswers:[{questionId:"confirm-action-role",kind:"scene" as const,answer:"처음에는 무서워서 도망쳤고, 나중에는 내가 쫓아오던 사람을 때렸어. 피는 그 사람에게 났고, 끝에는 후련했어.",skipped:false}]};
    const context = applyClarificationsToContext(initial,userEvidence.clarificationAnswers);
    context.consultation = await prepareConsultation(context,dream,userEvidence,"consulting-live-smoke");
    expect(context.consultation.ready).toBe(true);
    expect(context.consultation.question).toBeNull();
    const detailed = await generateDetailedAssistant(context,"consulting-live-smoke","none",dream,userEvidence,undefined,first);
    expect(detailed.qualityVersion).toBe(2);
    expect(detailed.generationSource).toBe("codex");
    expect(detailed.interpretationChanges?.newlyLearned).toMatch(/후련|때렸|맞서/);
    const copy=JSON.stringify(detailed);
    expect(copy).toMatch(/쫓|도망/);
    expect(copy).toContain("피");
    expect(copy).not.toMatch(/장면 장면|꿈에서의 꿈에서|공간과 분위기|예고하지|전통 해몽/);
    } finally {
      if (process.env.CODEX_SMOKE_PRINT_OUTPUTS === "true") console.info(JSON.stringify({syntheticConsultationOutputs:outputs},null,2));
      spy.mockRestore();
    }
  },660_000);
  it("reads narrative differences beyond catalog symbols", async () => {
    const dreams = [
      "꿈에서 이름 모를 악기를 연주했어요. 소리가 멈추자 다시 연주하려고 애썼지만 안 돼서 마지막에는 답답했어요.",
      "꿈에서 이름 모를 악기를 연주했어요. 소리가 멈추자 악기를 내려놓았고 마지막에는 마음이 편안해졌어요.",
      "꿈에서 투명한 배달 상자를 운반했어요. 길이 막혔지만 다른 길을 찾아 목적지에 도착했고 뿌듯했어요."
    ];
    const answers = [];
    for (const dream of dreams) {
      const answer = await generateFreeAssistant(analyzeDreamContextLocally(dream,null).context, "narrative-smoke", dream);
      expect(answer.generationSource).toBe("codex");
      expect(answer.freeReadingMode).toBe("symbolic");
      const copy = [answer.directAnswer, ...answer.sections.flatMap(section=>section.paragraphs)].join("\n");
      expect(copy).not.toMatch(/예고하지|단정할 수 없/);
      answers.push(copy);
      console.log(JSON.stringify({ dream, copy }));
    }
    expect(answers[0]).not.toEqual(answers[1]);
    expect(answers[0]).toMatch(/답답|어려|막|좌절|이어가/);
    expect(answers[1]).toMatch(/편안|안도|내려놓|쉼|쉬|놓아|멈/);
    expect(answers[2]).toMatch(/도착|해결|다른 길|뿌듯|해냈|성취/);
  }, 360_000);
  beforeAll(() => {
    process.env.AI_MODE = "codex";
    process.env.CODEX_LOCAL_ENABLED = "true";
    process.env.CODEX_CLI_PATH = "codex";
    process.env.CODEX_LOCAL_MODEL = "gpt-5.6-luna";
    process.env.CODEX_LOCAL_REASONING_EFFORT = "max";
    process.env.CODEX_LOCAL_TIMEOUT_MS = "300000";
    delete process.env.VERCEL;
  });

  afterAll(() => {
    for (const [name, value] of Object.entries(originalEnvironment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it(
    "generates a schema-valid Korean dream reading through the local CLI",
    async () => {
      const dream =
        "저녁의 낯선 도서관에서 오래된 열쇠를 찾았어요. 창밖에는 비가 왔지만 무섭기보다 차분했고, 잠긴 문을 열자 아침 햇살이 들어왔어요.";
      const analysis = await analyzeDreamInput(
        dream,
        "기분 좋았어요",
        "local-codex-smoke"
      );
      const answer = await generateFreeAssistant(analysis.context, "local-codex-smoke", dream);
      const answerText = JSON.stringify(answer);

      expect(answer.generationSource).toBe("codex");
      expect(answer.freeReadingMode).toBe("symbolic");
      expect(answerText).toContain("도서관");
      expect(answerText).toContain("열쇠");
      expect(answerText).not.toMatch(/장면\s+장면|대상은 아직 비어/);
    },
    360_000
  );

  it(
    "carries a relieved ending from the free answer into a grounded detailed reading",
    async () => {
      const dream = "검은 뱀이 우리 집 창문으로 천천히 들어왔어요. 처음에는 무서웠지만 도망치지 않고 가만히 바라보다가 문을 열어 밖으로 내보냈고, 마지막에는 이상하게 마음이 편안해졌어요.";
      const analysis = await analyzeDreamInput(dream, null, "local-codex-emotion-arc-smoke");
      const free = await generateFreeAssistant(analysis.context, "local-codex-emotion-arc-smoke", dream);
      const detailed = await generateDetailedAssistant(analysis.context, "local-codex-emotion-arc-smoke", "none", dream);
      expect(free.generationSource).toBe("codex");
      expect(detailed.generationSource).toBe("codex");
      expect(free.freeReadingMode).toBe("symbolic");
      expect(free.directAnswer).toContain("뱀");
      expect(detailed.directAnswer).toMatch(/편안|안도/);
      expect(JSON.stringify(detailed)).not.toMatch(/얼굴이 보이지 않는 사람|두 번째 사람|외도 욕구/);
      if (process.env.CODEX_SMOKE_PRINT_OUTPUTS === "true") {
        console.info(JSON.stringify({ free, detailed }, null, 2));
      }
    },
    660_000
  );

  it(
    "keeps parallel health, relationship, and interview readings grounded and varied",
    async () => {
      const cases = [
        {
          id: "health",
          dream:
            "최근 몸 상태가 걱정돼 병원 건강검진 결과를 기다리고 있어요. 꿈에서는 흰 복도를 걸으며 검사표를 꼭 쥐고 있었고, 닫힌 문을 열기 직전에 깼어요. 불안했어요."
        },
        {
          id: "relationship",
          dream:
            "꿈에서 전 연인을 우연히 만났고, 그 사람이 결혼한다는 말을 들었어요. 현실에서는 결혼 소식을 들은 적이 없어요. 서로 말없이 바라보다가 깼고 슬프면서도 안도했어요. 전 연인의 현재 마음을 알 수 있는 꿈인지 궁금해요."
        },
        {
          id: "interview",
          dream:
            "곧 취업 면접을 앞두고 있어요. 꿈에서 면접장 문 앞에 섰는데 갑자기 제 이름이 떠오르지 않았어요. 숨이 찬 채로 문을 열고 들어갔고, 깬 뒤에도 답답함이 남았어요."
        }
      ] as const;

      const results = await Promise.all(
        cases.map(async ({ id, dream }) => {
          const sessionHash = `local-codex-${id}-parallel-smoke`;
          const analysis = await analyzeDreamInput(dream, null, sessionHash);
          const answer = await generateFreeAssistant(analysis.context, sessionHash, dream);
          return { id, answer, text: JSON.stringify(answer) };
        })
      );

      if (process.env.CODEX_SMOKE_PRINT_OUTPUTS === "true") {
        console.info(JSON.stringify(results, null, 2));
      }

      for (const { answer, text } of results) {
        expect(answer.freeReadingMode).toBe("symbolic");
        expect(text).not.toMatch(/느낌이었습니다\.[과와을를이가은는]|최근\s+앞둔|숨찬\s+채|긴장이\s+다시\s+켜/);
      }

      const health = results.find(({ id }) => id === "health")!;
      expect(health.text).not.toMatch(/물가|강가|바닷가|호숫가|해변|바다|강물|호수|연못/);

      const relationship = results.find(({ id }) => id === "relationship")!;
      expect(relationship.text).not.toMatch(/그의|그녀의|최근\s+들은?\s+결혼\s*소식|현실의\s+결혼\s*소식|결혼\s*소식보다/);

      const stockOpenings = results.filter(({ answer }) => /^이 꿈은/.test(answer.directAnswer.trim()));
      expect(stockOpenings).toHaveLength(0);
      expect(results.map(({ text }) => text).join(" ")).not.toMatch(/이 꿈은[^.!?]{0,100}꿈에 가까워요/);
    },
    360_000
  );
});
