import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceTurnOutcome } from "@interview/schemas";
import { recoverSelectedSourceExcerpt } from "./source-extractive-recovery";
import { askControlledRagForSurveyInterviewerTurn } from "./controlled-rag-service";
import type { ControlledRagChunk } from "./controlled-rag-source-packs";

const mocks = vi.hoisted(() => ({ select: vi.fn(), compose: vi.fn(), query: vi.fn(), catalog: [
  { id: "direct", surveySlug: "nubeqa", title: "Relationship source", url: "https://example.test/direct", description: "", text: "Do not coadminister X. Only when condition A is met, assess symptoms at 1.5 weeks.", tags: [], assets: [] },
  { id: "context", surveySlug: "nubeqa", title: "General workflow resource", url: "https://example.test/context", description: "", text: "Which patients require assessment? Only patients meeting condition A need assessment at 1.5 weeks; this is general workflow guidance.", tags: [], assets: [{ title: "Context figure", url: "https://example.test/context.svg", description: null, assetKind: "IMAGE", tags: [], priority: 1 }] },
] }));
vi.mock("./controlled-rag-source-packs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./controlled-rag-source-packs")>();
  return { ...actual, CONTROLLED_RAG_CHUNKS: [...actual.CONTROLLED_RAG_CHUNKS, ...mocks.catalog] };
});
vi.mock("./prisma", () => ({ prisma: { $queryRaw: mocks.query } }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => ({ selectModeratorEvidence: mocks.select, composeControlledRagAnswer: mocks.compose }) }));
const direct: ControlledRagChunk = { ...mocks.catalog[0], surveySlug: "nubeqa", contribution: "answer", evidenceRole: "direct" };
const context: ControlledRagChunk = { ...mocks.catalog[1], surveySlug: "nubeqa", contribution: "requested_context", evidenceRole: "contextual" };
const rejected: SourceTurnOutcome = { version: 1, status: "grounding_rejected", attempts: [{ stage: "grounding", code: "unsupported_claims", responseId: "review-1", model: "fixture" }] };

describe("source-owned extractive recovery", () => {
  it("preserves the whole contextual excerpt and truthful failed-review audit", () => {
    const result = recoverSelectedSourceExcerpt([direct, context], rejected, true)!;
    expect(result.answer).toBe(`The source summary for ${context.title} states:\n\n“${context.text}” [1]`);
    expect(result.outcome).toEqual({ ...rejected, status: "extractive_recovery", recovery: { method: "verbatim_curated_source_card", sourceId: context.id, cause: "grounding_rejected" } });
    expect(result.answer).not.toContain(direct.text);
  });
  it.each(["rate_limited", "authentication_failed", "provider_timeout", "composition_unavailable", "invalid_schema", "missing_structured_output", "invalid_grounding_verdict"])("does not mask %s after an earlier rejected draft", (code) => {
    expect(recoverSelectedSourceExcerpt([direct, context], { ...rejected, attempts: [...rejected.attempts, { stage: "composition", code, responseId: null, model: null }] }, true)).toBeNull();
  });
  it("recovers a local format failure without claiming a grounding verdict", () => {
    const result = recoverSelectedSourceExcerpt([direct], { version: 1, status: "composition_failure", attempts: [{ stage: "composition", code: "word_budget_exceeded", responseId: "draft", model: "fixture" }] }, false)!;
    expect(result.outcome).toMatchObject({ status: "extractive_recovery", recovery: { cause: "composition_validation" } });
  });
  it("requires substantive selected provenance and the requested practical context", () => {
    expect(recoverSelectedSourceExcerpt([direct], rejected, true)).toBeNull();
    expect(recoverSelectedSourceExcerpt([{ ...direct, contribution: undefined }], rejected, false)).toBeNull();
    expect(recoverSelectedSourceExcerpt([{ ...direct, contribution: "contrast_or_limit_only" }], rejected, false)).toBeNull();
    expect(recoverSelectedSourceExcerpt([direct], { version: 1, status: "no_evidence", attempts: [] }, false)).toBeNull();
    expect(recoverSelectedSourceExcerpt([direct, { ...context, contribution: "essential_qualification" }], rejected, false)).toBeNull();
  });
  it("does not alter an excerpt to repair ambiguous source-internal citations", () => {
    expect(recoverSelectedSourceExcerpt([{ ...direct, text: "Exact source statement.[2]" }], rejected, false)).toBeNull();
  });
  it.each(["coadminister X.", "assess symptoms at 1.5 weeks."])("restores the whole curated instruction when selection omits a negation or condition: %s", (excerpt) => {
    const result = recoverSelectedSourceExcerpt([{ ...direct, text: excerpt }], rejected, false)!;
    expect(result.answer).toBe(`The source summary for ${direct.title} states:\n\n“${direct.text}” [1]`);
    expect(result.answer).toContain("Do not coadminister X.");
    expect(result.answer).toContain("Only when condition A is met");
  });
  it("rejects DB/arbitrary fragments, another brand, and altered provenance", () => {
    expect(recoverSelectedSourceExcerpt([{ ...direct, id: "db:direct" }], rejected, false)).toBeNull();
    expect(recoverSelectedSourceExcerpt([{ ...direct, surveySlug: "padcev" }], rejected, false)).toBeNull();
    expect(recoverSelectedSourceExcerpt([{ ...direct, url: "https://example.test/other" }], rejected, false)).toBeNull();
    expect(recoverSelectedSourceExcerpt([{ ...direct, text: "An invented full instruction." }], rejected, false)).toBeNull();
  });
});

describe("recovery delivery through the source API", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "development"); mocks.query.mockReset().mockResolvedValue([]); mocks.select.mockReset();
    mocks.compose.mockReset().mockRejectedValue({ contextualCompositionAttempts: [
      { trace: { response: { id: "draft-1" } }, groundingTrace: { response: { id: "review-1" } }, failure: { stage: "grounding", code: "unsupported_claims" } },
      { trace: { response: { id: "draft-2" } }, groundingTrace: { response: { id: "review-2" } }, failure: { stage: "grounding", code: "unsupported_claims" } },
    ] });
  });
  afterEach(() => vi.unstubAllEnvs());
  it("delivers an unchanged quotation, only its citation/asset, and retains the full raw packet with null grounding", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({ surveySlug: "nubeqa", participantMessage: "Can you explain that?", sourceTopicContext: "What practical assessment is described?", evidencePacket: { sources: [direct, context].map((source) => ({ ...source, assets: source.assets ?? [] })) }, surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, responseMode: "answer_only" });
    expect(mocks.compose).toHaveBeenCalledOnce();
    expect(mocks.select).not.toHaveBeenCalled();
    expect(mocks.compose.mock.calls[0][0].sources[0].text).toBe(context.text);
    expect(result.enabled).toBe(true);
    expect(result.answer).toBe(`The source summary for ${context.title} states:\n\n“${context.text}” [1]`);
    expect(result.references.map((reference) => reference.citationId)).toEqual(["rag:context"]);
    expect(result.references[0].assets).toEqual(context.assets);
    expect(result.sourceAnswerGrounding).toBeNull();
    expect(result.sourceOutcome).toMatchObject({ status: "extractive_recovery", recovery: { sourceId: "context" } });
    expect(result.sourceOutcome?.attempts).toHaveLength(4);
    expect(result.evidencePacket?.sources.map((source) => source.id)).toEqual(["context", "direct"]);
  });
  it.each([false, true])("repairs the retained packet to the complete displayed instruction for the next clarification (narrowed=%s)", async (narrowed) => {
    const excerpt = "need assessment at 1.5 weeks";
    const evidencePacket = { sources: [direct, { ...context, text: excerpt }].map((source) => ({ ...source, assets: source.assets ?? [] })) };
    mocks.select.mockResolvedValue({ result: { selections: [{ sourceId: context.id, supportExcerpt: excerpt, assetIds: [], evidenceRole: "contextual", contribution: "requested_context" }], rationale: "Synthetic adversarial selection omitted the condition." } });
    const input = { surveySlug: "nubeqa" as const, participantMessage: narrowed ? "Can you explain that more simply?" : "Can you explain that?", sourceTopicContext: "What practical assessment is described?", evidencePacket, surveyContext: "", currentQuestion: null, selectedNextQuestion: null, selectedQuestionSourceContext: null, responseMode: "answer_only" as const };
    const result = await askControlledRagForSurveyInterviewerTurn(input);
    expect(result.enabled).toBe(true);
    expect(result.answer).toContain(context.text);
    expect(result.evidencePacket?.sources.find((source) => source.id === context.id)?.text).toBe(context.text);
    expect(result.evidencePacket?.sources.find((source) => source.id === direct.id)?.text).toBe(direct.text);
    await askControlledRagForSurveyInterviewerTurn({ ...input, participantMessage: "Can you explain that?", evidencePacket: result.evidencePacket });
    expect(mocks.compose.mock.calls.at(-1)![0].sources[0].text).toBe(context.text);
    expect(mocks.compose.mock.calls.at(-1)![0].sources[0].text).toContain("Only patients meeting condition A");
  });
});
