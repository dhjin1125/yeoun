import "server-only";

import { accessGatePassed } from "./access-gate";
import { AppError } from "./http";

// Custom instructions are an operator tool, never a public production API.
export function promptLabAvailable() {
  return process.env.NODE_ENV === "development" && !process.env.VERCEL;
}

export async function assertPromptLabAccess() {
  if (!promptLabAvailable()) throw new AppError("LAB_UNAVAILABLE", "실험실은 로컬 개발 서버에서 열 수 있어요.", 404);
  if (!(await accessGatePassed())) throw new AppError("ACCESS_GATE_REQUIRED", "먼저 입장 비밀번호를 입력해 주세요.", 403);
}
