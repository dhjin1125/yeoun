import type { GoalAgreement,GoalMemory } from "@/lib/prompt-lab-goal";

export const goalAgreement:GoalAgreement={
  id:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",confirmedAt:"2026-09-23T00:00:00.000Z",
  draft:{wish:"질문에 직접 답하는 풀이",keep:"장면을 구체적으로 설명하는 점",avoid:"추상적인 같은 말 반복"},answers:[],
  reference:{runId:1,result:"함께 걷는 장면의 의미",instructions:"장면을 설명한다."},
  brief:{goal:"질문에 직접 답하기",keep:"구체적인 장면 설명",avoid:"추상적인 반복",successCriteria:["첫 문장에 질문의 답이 있다"],question:""}
};
export const goalMemory:GoalMemory={agreement:goalAgreement,decisions:[]};
