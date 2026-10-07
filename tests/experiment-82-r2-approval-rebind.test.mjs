import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

process.env.EXPERIMENT_82_RUNNER_TEST_IMPORT = "1";
const {
  corpusDigest,
  inputDigest,
  isCurrentApprovalBinding,
  matchesCanonicalR2RunMapping,
  planDerivedCorpusApprovalBinding
} = await import("../tmp/experiment-82-r2-runner.mjs");

const categories = ["A", "B", "C", "D", "E", "F", "G", "H"];
const runMapping = [
  ["82-r2-A1", "A"], ["82-r2-A2", "A"], ["82-r2-A3", "A"],
  ["82-r2-B1", "B"], ["82-r2-C1", "C"], ["82-r2-D1", "D"],
  ["82-r2-E1", "E"], ["82-r2-E2", "E"], ["82-r2-F1", "F"],
  ["82-r2-G1", "G"], ["82-r2-G2", "G"], ["82-r2-H1", "H"]
].map(([runId, category]) => ({ runId, category }));

function fixture() {
  const corpus = Object.fromEntries(categories.map(category => [category, {
    dream: `synthetic evaluation input ${category}`,
    emotion: null,
    focus: null,
    inputSource: "synthetic-eval",
    sourceArchiveId: null
  }]));
  const categoryInputDigests = Object.fromEntries(categories.map(category => [category, inputDigest(corpus[category])]));
  const digest = corpusDigest(corpus);
  const baselineId = "baseline-r2-target";
  const baselineDigest = "baseline-digest-r2";
  const runnerSha256 = "runner-sha-r2";
  const sourceCorpusId = "corpus-c2-source";
  const sourceApprovalId = "approval-e-source";
  const sourceBaselineId = "baseline-r1-source";
  const baseline = {
    experimentId: 82,
    executionRevision: 2,
    evalCorpusRevision: 2,
    status: "FROZEN_BEFORE_QUALITY_RUNS",
    runMapping,
    evalCorpusSource: corpus,
    evalCorpusDigest: digest,
    r2Bootstrap: { approvedCorpusSourceArchiveId: sourceCorpusId }
  };
  const sourceCorpus = {
    id: sourceCorpusId,
    data: {
      evalCorpusManifest: true,
      status: "FROZEN_BEFORE_PREPARATION",
      evalCorpusRevision: 2,
      evalCorpusDigest: digest,
      productBaselineArchiveId: sourceBaselineId,
      corpusInputApprovalArchiveId: sourceApprovalId,
      categoryInputDigests,
      runMapping: runMapping.map(({ runId, category }) => ({ runId: runId.replace("82-r2-", "82-r1-"), category }))
    }
  };
  const sourceApproval = {
    id: sourceApprovalId,
    data: {
      corpusInputApproval: true,
      approvalDecision: "GO",
      evalCorpusRevision: 2,
      approvedInputSource: "synthetic-eval",
      productBaselineArchiveId: sourceBaselineId,
      approvedEInput: structuredClone(corpus.E),
      approvedEInputDigest: categoryInputDigests.E
    }
  };
  const runnerFreeze = {
    id: "runner-freeze-r2",
    data: {
      runnerIdentityFrozen: true,
      executionRevision: 2,
      evalCorpusRevision: 2,
      productBaselineArchiveId: baselineId,
      baselineDigest,
      evalRunnerSha256: runnerSha256
    }
  };
  const args = {
    baseline,
    baselineId,
    baselineDigest,
    runnerFreeze,
    sourceCorpus,
    sourceApproval,
    currentRunnerSha256: runnerSha256
  };
  return { args, baseline, baselineId, baselineDigest, runnerFreeze, runnerSha256, sourceApproval, sourceCorpus };
}

function plan(args, extra = {}) {
  return planDerivedCorpusApprovalBinding({ ...args, ...extra });
}

function assertRebindError(code, action) {
  assert.throws(action, error => error?.code === code);
}

test("accepts only the exact canonical r2 run mapping", () => {
  assert.equal(matchesCanonicalR2RunMapping(runMapping), true);
  assert.equal(matchesCanonicalR2RunMapping(runMapping.map(({ runId, category }) => ({ runId: runId.replace("82-r2-", "82-r1-"), category }))), false);
  assert.equal(matchesCanonicalR2RunMapping(runMapping.slice(1)), false);
});

test("creates a metadata-only inherited GO for an unchanged approved E and corpus", () => {
  const state = fixture();
  const result = plan(state.args);
  assert.equal(result.action, "create");
  assert.equal(result.data.recordType, "DERIVED_CORPUS_APPROVAL_BINDING");
  assert.equal(result.data.decision, "INHERITED_GO");
  assert.equal(result.data.reapprovalRequired, false);
  assert.equal(result.data.contentChanged, false);
  assert.equal(result.data.modelCalls, 0);
  assert.equal(result.data.approvedEInputDigest, state.sourceApproval.data.approvedEInputDigest);
  assert.equal(JSON.stringify(result.data).includes("synthetic evaluation input"), false);
});

test("rejects an E digest mismatch", () => {
  const state = fixture();
  state.args.sourceApproval.data.approvedEInputDigest = "different-e-digest";
  assertRebindError("APPROVAL_REBIND_MISMATCH", () => plan(state.args));
});

test("rejects a changed overall corpus digest", () => {
  const state = fixture();
  state.args.baseline.evalCorpusDigest = "different-corpus-digest";
  assertRebindError("APPROVAL_REBIND_MISMATCH", () => plan(state.args));
});

test("rejects a source approval that is not GO", () => {
  const state = fixture();
  state.args.sourceApproval.data.approvalDecision = "HOLD";
  assertRebindError("APPROVAL_REBIND_MISMATCH", () => plan(state.args));
});

test("rejects an approval from another evaluation corpus revision", () => {
  const state = fixture();
  state.args.sourceApproval.data.evalCorpusRevision = 1;
  assertRebindError("APPROVAL_REBIND_MISMATCH", () => plan(state.args));
});

test("rejects an approval whose source has been superseded or revoked", () => {
  const state = fixture();
  assertRebindError("APPROVAL_REBIND_MISMATCH", () => plan(state.args, { sourceApprovalSuperseded: true }));
});

test("does not treat a binding for another baseline as current", () => {
  const state = fixture();
  const data = {
    recordType: "DERIVED_CORPUS_APPROVAL_BINDING",
    executionRevision: 2,
    evalCorpusRevision: 2,
    evalRunnerVersion: "free-v3-eval-runner-4",
    productBaselineArchiveId: "another-baseline",
    baselineDigest: state.baselineDigest,
    runnerFreezeArchiveId: state.runnerFreeze.id,
    runnerFreezeDigest: state.runnerSha256
  };
  assert.equal(isCurrentApprovalBinding(data, state.baselineId, state.baselineDigest, state.runnerFreeze.id, state.runnerSha256), false);
});

test("does not treat a binding for another runner freeze as current", () => {
  const state = fixture();
  const data = {
    recordType: "DERIVED_CORPUS_APPROVAL_BINDING",
    executionRevision: 2,
    evalCorpusRevision: 2,
    evalRunnerVersion: "free-v3-eval-runner-4",
    productBaselineArchiveId: state.baselineId,
    baselineDigest: state.baselineDigest,
    runnerFreezeArchiveId: "another-freeze",
    runnerFreezeDigest: state.runnerSha256
  };
  assert.equal(isCurrentApprovalBinding(data, state.baselineId, state.baselineDigest, state.runnerFreeze.id, state.runnerSha256), false);
});

test("reuses an identical derived binding for the same anchor", () => {
  const state = fixture();
  const first = plan(state.args).data;
  const existing = { id: "derived-binding-1", data: first };
  const result = plan(state.args, { existingBindings: [existing] });
  assert.equal(result.action, "reuse");
  assert.equal(result.existing.id, existing.id);
});

test("rejects a different approval or digest on the same anchor", () => {
  const state = fixture();
  const existing = {
    id: "conflicting-derived-binding",
    data: {
      productBaselineArchiveId: state.baselineId,
      baselineDigest: state.baselineDigest,
      runnerFreezeArchiveId: state.runnerFreeze.id,
      runnerFreezeDigest: state.runnerSha256,
      sourceApprovalArchiveId: "different-approval",
      approvedEInputDigest: "different-e-digest",
      evalCorpusDigest: state.args.baseline.evalCorpusDigest
    }
  };
  assertRebindError("APPROVAL_REBIND_CONFLICT", () => plan(state.args, { existingBindings: [existing] }));
});

test("accepts a direct GO only when it is bound to this baseline and freeze", () => {
  const state = fixture();
  const data = {
    corpusInputApproval: true,
    approvalDecision: "GO",
    executionRevision: 2,
    evalCorpusRevision: 2,
    evalRunnerVersion: "free-v3-eval-runner-4",
    productBaselineArchiveId: state.baselineId,
    baselineDigest: state.baselineDigest,
    runnerFreezeArchiveId: state.runnerFreeze.id,
    runnerFreezeDigest: state.runnerSha256
  };
  assert.equal(isCurrentApprovalBinding(data, state.baselineId, state.baselineDigest, state.runnerFreeze.id, state.runnerSha256), true);
  assert.equal(isCurrentApprovalBinding(data, state.baselineId, state.baselineDigest, "another-freeze", state.runnerSha256), false);
});

test("digest fixture values are deterministic without retaining raw user input", () => {
  const state = fixture();
  const digest = createHash("sha256").update(state.sourceApproval.data.approvedEInputDigest).digest("hex");
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(inputDigest(state.sourceApproval.data.approvedEInput), state.sourceApproval.data.approvedEInputDigest);
});
