export type PromptLabProposalFailureHelp = {
  title: string;
  explanation: string;
  nextStep: string;
  feedbackAddition?: string;
};

export function promptLabProposalFailureHelp(code: string): PromptLabProposalFailureHelp {
  switch (code) {
    case "INVALID_PROMPT_EDIT":
      return {
        title: "바꾸려는 문장을 현재 지침에서 찾지 못했어요",
        explanation: "수정안이 고른 문장이 현재 지침에 없거나 여러 번 나왔어요. 변경 전후 문구가 같아도 적용할 수 없어요.",
        nextStep: "현재 지침에 실제로 있는 짧은 문장을 정확히 골라 수정하도록 피드백에 안내를 추가해 보세요.",
        feedbackAddition: "수정 전 문구는 현재 지침에 실제로 있는 문장을 정확히 복사하고, 한 번만 나오는 짧은 범위로 골라 주세요."
      };
    case "OVERLAPPING_PROMPT_EDITS":
      return {
        title: "수정하려는 문장 구간이 서로 겹쳤어요",
        explanation: "두 수정안이 같은 지침 일부를 동시에 바꾸려고 해 하나로 적용할 수 없었어요.",
        nextStep: "겹치는 수정은 하나로 합치고, 서로 다른 문장만 바꾸도록 피드백에 안내를 추가해 보세요.",
        feedbackAddition: "같은 문장을 여러 번 고치지 말고, 겹치는 수정은 하나로 합쳐 서로 다른 짧은 문장만 수정해 주세요."
      };
    case "PROMPT_EDIT_TOO_LONG":
      return {
        title: "수정 후 지침이 글자 한도를 넘었어요",
        explanation: "수정안을 적용한 전체 지침이 40,000자 한도를 넘어 저장할 수 없었어요.",
        nextStep: "새 문장을 길게 추가하기보다 기존 규칙을 짧게 고치도록 요청해 보세요.",
        feedbackAddition: "새 규칙을 길게 덧붙이지 말고, 현재 지침의 관련 문장을 짧게 고쳐 전체 길이를 늘리지 말아 주세요."
      };
    case "LOCAL_CODEX_INVALID_OUTPUT":
    case "INVALID_PROPOSAL_SCHEMA":
    case "INVALID_PROPOSAL_JSON":
      return {
        title: "AI 답을 수정안으로 읽지 못했어요",
        explanation: "응답 형식이 맞지 않아 자동으로 한 번 더 요청했지만, 이번에도 수정안을 확인하지 못했어요. 입력한 내용과 기존 지침은 유지돼요.",
        nextStep: "같은 피드백으로 다시 요청하거나, 바라는 변화를 한 가지로 더 짧고 구체적으로 적어 보세요."
      };
    case "LOCAL_CODEX_TIMEOUT":
      return {
        title: "AI 응답이 제한 시간 안에 도착하지 않았어요",
        explanation: "이 오류는 지침이나 피드백이 잘못됐다는 뜻은 아니에요. 입력한 내용은 그대로 남아 있어요.",
        nextStep: "연결 상태를 확인한 뒤 같은 내용으로 다시 요청해 보세요."
      };
    case "LOCAL_CODEX_CLI_NOT_FOUND":
      return {
        title: "실험실에서 로컬 AI 실행기를 찾지 못했어요",
        explanation: "수정 요청을 보내기 전에 로컬 Codex 연결 단계에서 멈췄어요. 입력한 내용은 유지돼요.",
        nextStep: "로컬 AI 실행 환경을 확인한 뒤 다시 요청해 보세요."
      };
    case "LOCAL_CODEX_DISABLED":
    case "LOCAL_CODEX_BLOCKED_ON_VERCEL":
      return {
        title: "이 환경에서는 로컬 AI를 실행할 수 없어요",
        explanation: "현재 실행 환경이 Prompt Lab에서 사용하는 로컬 AI와 연결되지 않았어요. 입력한 내용은 유지돼요.",
        nextStep: "로컬 개발 환경에서 Prompt Lab을 열었는지 확인해 보세요."
      };
    case "LOCAL_CODEX_EXEC_FAILED":
      return {
        title: "로컬 AI 실행 중 오류가 발생했어요",
        explanation: "요청은 실행됐지만 로컬 AI가 완료하지 못했어요. 입력한 내용은 유지돼요.",
        nextStep: "로컬 실행 상태를 확인한 뒤 같은 내용으로 다시 요청해 보세요."
      };
    default:
      return {
        title: "수정안을 완성하지 못했어요",
        explanation: "입력한 내용과 기존 지침은 유지돼요. 오류 코드는 실험 기록에 함께 저장됐어요.",
        nextStep: "바라는 변화를 한 가지로 좁혀 다시 요청해 보세요."
      };
  }
}

export function promptLabReadingFailureHelp(code: string) {
  switch (code) {
    case "LOCAL_CODEX_INVALID_OUTPUT":
      return {
        title: "AI 응답을 풀이 결과로 읽지 못했어요",
        explanation: "응답 형식이 맞지 않아 이번 풀이는 비교 목록에 추가하지 않았어요. 꿈과 지침은 그대로 보존돼 있어요.",
        nextStep: "현재 꿈·지침으로 다시 시도하거나, 꿈을 바꿔 승인한 지침으로 새 실험을 시작할 수 있어요."
      };
    case "LOCAL_CODEX_TIMEOUT":
      return {
        title: "AI 응답이 제한 시간 안에 도착하지 않았어요",
        explanation: "풀이 내용이 틀렸다는 판정이 아니라, 응답 대기 시간이 끝난 경우예요. 꿈과 지침은 유지돼요.",
        nextStep: "연결 상태를 확인하고 같은 내용으로 다시 실험해 보세요."
      };
    case "AI_SYMBOL_UNGROUNDED":
    case "AI_SYMBOL_SUPERSEDED_OR_QUOTED":
      return {
        title: "풀이가 꿈에 적힌 장면을 벗어나 검수에서 멈췄어요",
        explanation: "응답은 만들어졌지만, 꿈에 없는 장면이나 근거가 맞지 않는 인용이 있어 결과로 저장하지 않았어요.",
        nextStep: "꿈에서 실제로 일어난 행동과 기억나는 장면을 더 분명히 적거나, 지침에서 입력에 없는 사실을 만들지 않도록 조정해 보세요."
      };
    case "AI_SYMBOL_MISSING_INTEGRATION":
    case "AI_SYMBOL_MISSING_BASE_MEANING":
      return {
        title: "상징 설명과 꿈 전체를 잇는 풀이가 빠졌어요",
        explanation: "필수 풀이 항목이 완성되지 않아 결과로 저장하지 않았어요.",
        nextStep: "지침에 각 상징의 뜻과 실제 장면을 연결한 통합 풀이를 모두 쓰도록 정리해 보세요."
      };
    case "LOCAL_CODEX_EXEC_FAILED":
      return {
        title: "로컬 AI 실행 중 오류가 발생했어요",
        explanation: "요청이 AI 실행 단계에서 끝나 풀이 결과를 받지 못했어요. 입력 내용은 유지돼요.",
        nextStep: "로컬 AI 실행 상태를 확인한 뒤 다시 실험해 보세요."
      };
    default:
      return {
        title: "풀이를 완성하지 못했어요",
        explanation: "실험 기록에 실패 단계와 안전한 오류 코드가 저장됐어요. 꿈과 지침은 유지돼요.",
        nextStep: "오류 코드와 기록을 확인하고, 필요하면 같은 내용으로 다시 실험해 보세요."
      };
  }
}

export function promptLabReadingOutputIssueText(issue: {kind:"empty_output"|"invalid_json"|"schema_mismatch";fields?:string[]} | undefined) {
  if (!issue) return null;
  if (issue.kind === "empty_output") return "로컬 AI가 응답 내용을 돌려주지 않았어요.";
  if (issue.kind === "invalid_json") return "로컬 AI 응답은 도착했지만 JSON 형식이 아니어서 풀이를 읽지 못했어요.";
  return `로컬 AI 응답의 풀이 항목 형식이 앱 기준과 달랐어요.${issue.fields?.length ? ` 확인할 항목: ${issue.fields.join(", ")}.` : ""}`;
}
