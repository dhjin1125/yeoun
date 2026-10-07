import { describe, expect, it } from "vitest";
import { previewMasks } from "@/lib/preview-mask";

const hidden = (text: string) => previewMasks(text).map(range => text.slice(range.start, range.end));

describe("meaningful preview phrases", () => {
  it.each([
    "서로 손을 잡는 행동이어서, 더 직접적인 친밀함이 표현됐어요.",
    "그 기억을 가진 인물이 상대였다는 점이 꿈속 가까움을 구체적으로 만들어줘요.",
    "익숙한 현재의 가까움과 새로운 행동의 차이가 마음에 남는 대비로 보여요.",
    "잊고 지내던 인물을 떠올린 데서 끝나지 않고, 친밀함과 낯선 자극이 더해진 장면이에요.",
    "끝내 도착하지 못한 장면에 억눌린 불안감이 드러나요.",
    "이 장면에는 인정받고 싶은 마음이 반영돼 있어요.",
    "정리되지 않은 감정이 나타난 장면이에요.",
  ])("never fully exposes a psychological interpretation: %s", text => {
    const masks = hidden(text);
    expect(masks.length).toBeGreaterThan(0);
    expect(masks.join("").length).toBeLessThan(text.length);
  });
  it("conceals psychological concepts, not merely a random fragment of the setup", () => {
    expect(hidden("이 장면에는 인정받고 싶은 마음이 반영돼 있어요.")).toEqual(["인정받고 싶은 마음"]);
    expect(hidden("서로 손을 잡는 행동이어서, 더 직접적인 친밀함이 표현됐어요.")).toEqual(["직접적인 친밀함"]);
  });
  it("uses at most one whole interpretive sentence as fallback", () => {
    const text = "문이 닫혔어요. 두 장면을 연결하는 이유가 드러나요. 선택을 바꾼 계기가 드러나요.";
    expect(hidden(text)).toEqual(["두 장면을 연결하는 이유가 드러나요."]);
    expect(hidden("두 장면을 연결하는 이유가 드러나요.")).toEqual([]);
  });
  it("keeps both requested trigger phrases whole, including particles", () => {
    const text = "최근 다른 사람의 옛 연애 이야기를 들었거나, 영화·영상에서 연인 밖의 상대와 가까워지는 장면을 접했다면 그런 소재가 꿈에 나타났을 수 있어요.";
    expect(hidden(text)).toEqual(["다른 사람의 옛 연애 이야기를", "영화·영상에서 연인 밖의 상대와 가까워지는 장면을"]);
  });
  it("works with other topics without a phrase dictionary", () => {
    expect(hidden("요즘 동료의 새로운 이직 소식을 들었거나, 다큐멘터리에서 먼 도시로 떠나는 모습을 접했다면 기억에 남았을 수 있어요.")).toEqual(["동료의 새로운 이직 소식을", "다큐멘터리에서 먼 도시로 떠나는 모습을"]);
  });
  it("selects an interpretation rather than its setup or predicate", () => {
    expect(hidden("닫힌 문은 새로운 선택에 대한 망설임을 상징할 수 있어요.")).toEqual(["새로운 선택에 대한 망설임을"]);
    expect(hidden("낯선 길은 새로운 환경에 적응하는 과정으로 읽어볼 수 있어요.")).toEqual(["새로운 환경에 적응하는 과정으로"]);
  });
  it.each([
    "닫힌 문은 실제 실패를 뜻하지 않아요.",
    "이 꿈은 현재 관계의 불만을 뜻한다고 단정할 수 없어요.",
    "실제 사건이 일어날 가능성을 보장하는 것은 아니에요.",
    "결제 후 전체 해석을 읽을 수 있어요.",
    "창문 옆에 나무가 있었고 바람이 불었어요.",
  ])("leaves safeguards and unknown constructions visible: %s", text => {
    expect(hidden(text)).toEqual([]);
  });
  it("limits masks to two whole phrases without losing or changing source text", () => {
    const text = "붉은 꽃은 새로운 관계의 기대를 상징해요. 닫힌 문은 변화에 대한 망설임을 뜻해요. 긴 길은 적응의 과정으로 읽을 수 있어요.";
    const masks = previewMasks(text);
    expect(masks).toHaveLength(2);
    let cursor = 0;
    let rebuilt = "";
    for (const mask of masks) { rebuilt += text.slice(cursor, mask.start) + text.slice(mask.start, mask.end); cursor = mask.end; }
    expect(rebuilt + text.slice(cursor)).toBe(text);
  });
});
