import "server-only";
import { hashToken, opaqueToken } from "./crypto";
import { AppError } from "./http";
import type { ConversationGuardCommand, ConversationGuardResult } from "./conversation-guard";
import type { DreamRepository } from "./repository";
import type { ReadingRecord } from "./types";

export function assertConversationAdmission(result: ConversationGuardResult) {
  if (result.status === "limited") throw new AppError("CONVERSATION_RATE_LIMITED",
    `요청이 많아 잠시 쉬어갈게요. ${result.retryAfterSeconds}초 후 다시 보내주세요. 질문 횟수는 차감하지 않았어요.`, 429, result.retryAfterSeconds);
  if (result.status === "busy") throw new AppError("MESSAGE_IN_PROGRESS", "진행 중인 요청이 끝난 뒤 다시 보내주세요. 질문 횟수는 차감하지 않았어요.", 409);
  if (result.status === "stale") throw new AppError("CONVERSATION_REQUEST_EXPIRED", "요청 대기가 끝났어요. 다시 보내주세요. 질문 횟수는 차감하지 않았어요.", 409);
}

export async function admitConversation(reading: ReadingRecord, repository: DreamRepository) {
  const lease = opaqueToken();
  const key = `reading:${reading.id}`;
  const expiresAt = Date.parse(reading.expiresAt);
  const mutate = async (guardKey: string, command: ConversationGuardCommand, expiry: number) => {
    try { return await repository.mutateConversationGuard(guardKey, command, expiry); }
    catch { throw new AppError("CONVERSATION_GUARD_UNAVAILABLE", "요청을 확인할 수 없어 잠시 멈췄어요. 질문 횟수는 차감하지 않았어요. 잠시 후 다시 시도해 주세요.", 503); }
  };
  // Use server-owned identities, never a request body, IP header or fresh session cookie.
  const identities = [`session:${reading.sessionHash}`, ...(reading.ownerUserId ? [`owner:${reading.ownerUserId}`] : [])];
  for (const identity of identities) {
    assertConversationAdmission(await mutate(`principal:${hashToken(identity)}`, { kind: "admit", scope: "principal", lease }, Date.now() + 86_400_000));
  }
  assertConversationAdmission(await mutate(key, { kind: "admit", scope: "reading", lease }, expiresAt));
  let heartbeatFailed = false;
  const heartbeat = setInterval(() => {
    void mutate(key, { kind: "heartbeat", lease }, expiresAt).then(result => {
      if (result.status !== "allowed") heartbeatFailed = true;
    }).catch(() => { heartbeatFailed = true; });
  }, 60_000);
  heartbeat.unref?.();
  return {
    async assertActive() {
      if (heartbeatFailed) throw new AppError("CONVERSATION_GUARD_UNAVAILABLE", "요청 연결을 확인하지 못했어요. 잠시 후 다시 보내주세요. 질문 횟수는 차감하지 않았어요.", 503);
      assertConversationAdmission(await mutate(key, { kind: "heartbeat", lease }, expiresAt));
    },
    async reject(requestKey: string, offTopic: boolean) {
      const result = await mutate(key, { kind: "reject", lease, requestKey, offTopic }, expiresAt);
      assertConversationAdmission(result);
      if (!offTopic) throw new AppError("CONVERSATION_SCOPE_UNCLEAR", "지금 꿈의 어떤 장면이나 풀이에 관한 이야기인지 조금만 더 적어주세요. 질문 횟수는 차감하지 않았어요.", 422);
      if (result.retryAfterSeconds) throw new AppError("CONVERSATION_RATE_LIMITED", "꿈과 무관한 요청이 반복되어 잠시 전송을 쉬어갈게요. 60초 후 지금 꿈에 관한 질문으로 다시 보내주세요. 질문 횟수는 차감하지 않았어요.", 429, result.retryAfterSeconds);
      throw new AppError(result.grace ? "CONVERSATION_SCOPE_GRACE" : "CONVERSATION_OFF_TOPIC",
        result.grace
          ? "이어 묻기는 지금 기록한 꿈과 풀이에 관한 질문을 도와드려요. 이번에는 질문 횟수를 사용하지 않았어요. 같은 꿈에서 재작성 안내는 한 번 제공해요. 지금 꿈과 관련된 질문으로 다시 적어주세요."
          : "지금 꿈과 관련된 질문으로 다시 적어주세요. 꿈과 무관한 요청은 답변을 만들지 않으며, 반복해서 보내면 잠시 전송이 제한돼요. 질문 횟수는 차감하지 않았어요.", 422);
    },
    async release() {
      clearInterval(heartbeat);
      // Do not turn a delivered/charged answer into an apparent failed request.
      try { await mutate(key, { kind: "release", lease }, expiresAt); }
      catch { console.error(JSON.stringify({ event: "conversation_guard_release_failed" })); }
    }
  };
}
