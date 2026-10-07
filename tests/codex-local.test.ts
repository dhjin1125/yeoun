import { afterEach, describe, expect, it } from "vitest";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { stagedFreeReadingV3CodexTransportSchema, stagedFreeReadingV3Schema } from "@/lib/ai/schemas";
import {
  generateWithLocalCodex,
  localCodexConfigured,
  localCodexModelLabel,
  localCodexProgressFromJsonLine,
  localCodexRequested,
  parseLocalCodexOutput
} from "@/lib/ai/codex-local";

const ENV_NAMES = [
  "AI_MODE",
  "CODEX_LOCAL_ENABLED",
  "CODEX_LOCAL_MODEL",
  "CODEX_LOCAL_FREE_MODEL",
  "CODEX_LOCAL_ANALYSIS_MODEL",
  "CODEX_LOCAL_REASONING_EFFORT",
  "CODEX_LOCAL_TIMEOUT_MS",
  "CODEX_CLI_PATH",
  "CODEX_BRIDGE_URL",
  "VERCEL"
] as const;
const originalEnvironment = Object.fromEntries(ENV_NAMES.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of ENV_NAMES) {
    const original = originalEnvironment[name];
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  }
});

describe("local Codex provider", () => {
  it("can publish a free-reading model without changing detailed or follow-up models", () => {
    process.env.CODEX_LOCAL_MODEL = "existing-model";
    process.env.CODEX_LOCAL_FREE_MODEL = "approved-free-model";
    process.env.CODEX_LOCAL_ANALYSIS_MODEL = "approved-analysis-model";
    expect(localCodexModelLabel("free")).toBe("approved-free-model");
    expect(localCodexModelLabel("analysis")).toBe("approved-analysis-model");
    expect(localCodexModelLabel("detailed")).toBe("existing-model");
    expect(localCodexModelLabel("followup")).toBe("existing-model");
  });
  it("maps only real Codex JSONL lifecycle events to public progress stages", () => {
    expect(localCodexProgressFromJsonLine('{"type":"thread.started","thread_id":"thread_1"}')).toBe("provider_session_started");
    expect(localCodexProgressFromJsonLine('{"type":"turn.started"}')).toBe("model_started");
    expect(localCodexProgressFromJsonLine('{"type":"item.completed","item":{"type":"reasoning","text":"hidden"}}')).toBeNull();
    expect(localCodexProgressFromJsonLine('{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}')).toBe("response_received");
    expect(localCodexProgressFromJsonLine('{"type":"turn.completed","usage":{"output_tokens":12}}')).toBe("provider_completed");
    expect(localCodexProgressFromJsonLine("not-json")).toBeNull();
  });

  it("classifies malformed output without exposing private diagnostics through serialization", () => {
    const schema = z.object({ answer: z.string().min(10) });
    expect(() => parseLocalCodexOutput("", schema)).toThrow(expect.objectContaining({
      code:"LOCAL_CODEX_INVALID_OUTPUT", outputIssue:{kind:"empty_output"}
    }));
    expect(() => parseLocalCodexOutput("not private response", schema)).toThrow(expect.objectContaining({
      code:"LOCAL_CODEX_INVALID_OUTPUT", outputIssue:{kind:"invalid_json"}
    }));
    try { parseLocalCodexOutput('{"answer":"short"}', schema); }
    catch (error) {
      expect(error).toMatchObject({code:"LOCAL_CODEX_INVALID_OUTPUT",outputIssue:{kind:"schema_mismatch",fields:["answer"]}});
      expect((error as Error).message).not.toContain("short");
      expect(JSON.stringify(error)).not.toContain("short");
      expect(Object.keys(error as object)).not.toContain("privateOutput");
    }
  });

  it("requires an explicit local opt-in", () => {
    process.env.AI_MODE = "codex";
    delete process.env.CODEX_LOCAL_ENABLED;
    delete process.env.VERCEL;

    expect(localCodexRequested()).toBe(true);
    expect(localCodexConfigured()).toBe(false);

    process.env.CODEX_LOCAL_ENABLED = "true";
    expect(localCodexConfigured()).toBe(true);
    expect(localCodexModelLabel()).toBe("codex-cli-default");
  });

  it("never enables the subscription-backed CLI on Vercel", () => {
    process.env.AI_MODE = "codex";
    process.env.CODEX_LOCAL_ENABLED = "true";
    process.env.VERCEL = "1";

    expect(localCodexConfigured()).toBe(false);
  });

  it("returns a stable error when the local CLI executable is missing", async () => {
    process.env.AI_MODE = "codex";
    process.env.CODEX_LOCAL_ENABLED = "true";
    process.env.CODEX_CLI_PATH = "/missing/yeoun-codex";
    delete process.env.VERCEL;

    await expect(
      generateWithLocalCodex({
        operation: "analysis",
        instructions: "문장을 분류한다.",
        inputJson: JSON.stringify({ text: "테스트" }),
        schema: z.object({ category: z.string() }),
        schemaName: "missing_cli_test"
      })
    ).rejects.toMatchObject({ code: "LOCAL_CODEX_CLI_NOT_FOUND" });
  });

  it("passes a real JSON Schema file to Codex CLI for enforced structured output", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yeoun-codex-schema-test-"));
    const executable = join(directory, "fake-codex.mjs");
    await writeFile(executable, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const schemaAt = args.indexOf("--output-schema");
const outputAt = args.indexOf("--output-last-message");
if (schemaAt < 0 || outputAt < 0) process.exit(42);
JSON.parse(readFileSync(args[schemaAt + 1], "utf8"));
writeFileSync(args[outputAt + 1], JSON.stringify({ answer: "구조화된 테스트 응답" }));
`, { encoding:"utf8", mode:0o700 });
    await chmod(executable, 0o700);
    process.env.AI_MODE = "codex";
    process.env.CODEX_LOCAL_ENABLED = "true";
    process.env.CODEX_CLI_PATH = executable;
    delete process.env.CODEX_BRIDGE_URL;
    delete process.env.VERCEL;
    try {
      await expect(generateWithLocalCodex({
        operation:"analysis", instructions:"테스트 응답을 만든다.", inputJson:"{}",
        schema:z.object({answer:z.string()}), schemaName:"schema_flag_test"
      })).resolves.toEqual({answer:"구조화된 테스트 응답"});
    } finally {
      await rm(directory,{recursive:true,force:true});
    }
  });

  it("uses the Codex transport schema but rejects an output that fails semantic V3 parsing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yeoun-codex-v3-transport-test-"));
    const executable = join(directory, "fake-codex.mjs");
    const candidate = {
      title: " x ",
      primarySection: {
        heading: "건너던 길을 멈춘 순간",
        paragraphs: [
          "낡은 다리를 건너다 중간에서 멈춘 뒤, 뒤에서 사람들이 다가오자 옆길로 내려갔어요. 이 꿈의 중심은 끝까지 다리를 건너는 데 있지 않고, 압박이 다가오는 순간 진행하던 방향을 바꾼 데 있어요.",
          "멈춤은 실패라기보다 상황을 다시 읽는 지점에 가까워요. 다리 위에서 계속 앞으로 가야 한다고 밀어붙이지 않고 옆길을 택했다는 점에서, 이 장면은 끝까지 해내는 힘보다 지금의 부담을 알아차리고 다른 선택을 하는 판단을 더 선명하게 보여줘요."
        ]
      },
      secondarySection: {
        heading: "옆길 뒤에 찾아온 안도",
        paragraphs: ["옆길로 내려간 뒤 마음이 놓인 변화는 앞 장면과 분명히 달라요. 처음의 멈춤이 막막함만 뜻하는 게 아니라, 방향을 바꾼 뒤 부담이 풀리는 경험으로 이어졌어요."]
      },
      coverage: {
        primary: { label: "다가오는 상황에서 진행 방향을 바꿈", evidenceQuotes: ["중간에서 멈췄어요", "뒤에서 사람들이 다가와서 옆길로 내려갔고"] },
        secondary: { label: "옆길을 택한 뒤 안도함", evidenceQuotes: ["내려간 뒤에는 마음이 놓였어요"] },
        reserved: []
      }
    };
    await writeFile(executable, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const schema = JSON.parse(readFileSync(args[args.indexOf("--output-schema") + 1], "utf8"));
const paragraphs = schema.properties.primarySection.properties.paragraphs;
const candidate = ${JSON.stringify(candidate)};
if (Array.isArray(paragraphs.items) || paragraphs.minItems !== 2 || paragraphs.maxItems !== 2) process.exit(43);
if (candidate.title.length < schema.properties.title.minLength) process.exit(44);
writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify(candidate));
`, { encoding:"utf8", mode:0o700 });
    await chmod(executable, 0o700);
    process.env.AI_MODE = "codex";
    process.env.CODEX_LOCAL_ENABLED = "true";
    process.env.CODEX_CLI_PATH = executable;
    delete process.env.CODEX_BRIDGE_URL;
    delete process.env.VERCEL;
    try {
      await expect(generateWithLocalCodex({
        operation:"free",
        instructions:"합성 테스트 입력으로 구조화 결과를 만든다.",
        inputJson:"{}",
        schema:stagedFreeReadingV3Schema,
        transportSchema:stagedFreeReadingV3CodexTransportSchema,
        schemaName:"dream_staged_free_reading_v3"
      })).rejects.toMatchObject({
        code:"LOCAL_CODEX_INVALID_OUTPUT",
        outputIssue:{kind:"schema_mismatch",fields:["title"]}
      });
    } finally {
      await rm(directory,{recursive:true,force:true});
    }
  });

  it("reports timeout when a terminated CLI handles SIGTERM and exits successfully", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paid-graceful-timeout-"));
    const executable = join(directory, "fake-codex.mjs");
    await writeFile(executable, `#!/usr/bin/env node
process.on("SIGTERM",()=>process.exit(0));
console.log(JSON.stringify({type:"turn.started"}));
setInterval(()=>{},1000);
`, {mode:0o700});
    process.env.AI_MODE="codex"; process.env.CODEX_LOCAL_ENABLED="true"; process.env.CODEX_CLI_PATH=executable;
    delete process.env.CODEX_BRIDGE_URL; delete process.env.VERCEL;
    try {
      await expect(generateWithLocalCodex({operation:"detailed",instructions:"Return JSON.",inputJson:"{}",schema:z.object({answer:z.string()}),schemaName:"graceful_timeout",timeoutCapMs:300})).rejects.toMatchObject({code:"LOCAL_CODEX_TIMEOUT"});
    } finally { await rm(directory,{recursive:true,force:true}); }
  });

  it("uses the final event when the CLI output file is empty", async () => {
    const directory = await mkdtemp(join(tmpdir(), "paid-empty-final-"));
    const executable = join(directory, "fake-codex.mjs");
    await writeFile(executable, `#!/usr/bin/env node
import {writeFileSync} from "node:fs";
const args=process.argv.slice(2);
writeFileSync(args[args.indexOf("--output-last-message")+1], "");
console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:JSON.stringify({answer:"complete"})}}));
`, {mode:0o700});
    process.env.AI_MODE="codex"; process.env.CODEX_LOCAL_ENABLED="true"; process.env.CODEX_CLI_PATH=executable;
    delete process.env.CODEX_BRIDGE_URL; delete process.env.VERCEL;
    try {
      await expect(generateWithLocalCodex({operation:"detailed",instructions:"Return JSON.",inputJson:"{}",schema:z.object({answer:z.string()}),schemaName:"empty_file_fallback"})).resolves.toEqual({answer:"complete"});
    } finally { await rm(directory,{recursive:true,force:true}); }
  });

  it("delivers edits beyond 32 KiB in a multibyte prompt to the CLI", async () => {
    const directory = await mkdtemp(join(tmpdir(), "yeoun-codex-long-prompt-test-"));
    const executable = join(directory, "fake-codex.mjs");
    await writeFile(executable, `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const args = process.argv.slice(2);
const document = readFileSync(join(args[args.indexOf("-C") + 1], "AGENTS.md"));
const configured = args.find(arg => arg.startsWith("project_doc_max_bytes="));
const limit = configured ? Number(configured.split("=")[1]) : 32768;
// Emulate the CLI's byte cap, including space consumed by global instructions.
const available = Math.max(0, limit - 4096);
const effective = document.subarray(0, available).toString("utf8");
writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify({
  receivedLastEdit: effective.includes("END_OF_OPERATOR_EDIT"),
  completeDocument: available >= document.length,
  exceedsDefaultBytes: document.length > 32768
}));
`, { encoding:"utf8", mode:0o700 });
    process.env.AI_MODE = "codex";
    process.env.CODEX_LOCAL_ENABLED = "true";
    process.env.CODEX_CLI_PATH = executable;
    delete process.env.CODEX_BRIDGE_URL;
    delete process.env.VERCEL;
    try {
      await expect(generateWithLocalCodex({
        operation:"free", instructions:"한글 지침을 유지한다.\n".repeat(1400) + "\nEND_OF_OPERATOR_EDIT", inputJson:"{}",
        schema:z.object({receivedLastEdit:z.boolean(),completeDocument:z.boolean(),exceedsDefaultBytes:z.boolean()}), schemaName:"long_prompt_test"
      })).resolves.toEqual({receivedLastEdit:true,completeDocument:true,exceedsDefaultBytes:true});
    } finally {
      await rm(directory,{recursive:true,force:true});
    }
  });
});
