import { describe, expect, it } from "vitest";
import { createRestoreToken, decryptDream, encryptDream, verifyRestoreToken } from "@/lib/crypto";

describe("sensitive dream storage", () => {
  it("encrypts the raw dream with reading-bound authenticated encryption", () => {
    const dream = "아무에게도 보여주고 싶지 않은 개인적인 꿈 내용입니다.";
    const encrypted = encryptDream(dream, "dream_one");

    expect(JSON.stringify(encrypted)).not.toContain(dream);
    expect(decryptDream(encrypted, "dream_one")).toBe(dream);
    expect(() => decryptDream(encrypted, "dream_other")).toThrow();
  });

  it("rejects tampered encrypted content", () => {
    const encrypted = encryptDream("바다가 크게 출렁이는 꿈을 꾸었어요.", "dream_tamper");
    const replacement = encrypted.ciphertext[0] === "A" ? "B" : "A";
    const tampered = { ...encrypted, ciphertext: `${replacement}${encrypted.ciphertext.slice(1)}` };

    expect(() => decryptDream(tampered, "dream_tamper")).toThrow();
  });

  it("accepts only unexpired restore tokens for the matching reading", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const token = createRestoreToken("dream_restore", future);

    expect(verifyRestoreToken(token, "dream_restore")).toBe(true);
    expect(verifyRestoreToken(token, "dream_other")).toBe(false);
    expect(verifyRestoreToken(token, "dream_restore", Date.now() + 120_000)).toBe(false);
    expect(verifyRestoreToken(`${token}x`, "dream_restore")).toBe(false);
  });
});
