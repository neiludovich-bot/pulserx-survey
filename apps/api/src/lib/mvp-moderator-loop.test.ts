import { beforeEach, describe, expect, it, vi } from "vitest";
import { sourceQuestionPlanSchema, sourceAnswerGroundingAuditSchema } from "@interview/schemas";
import type { ModeratorPlanResult, ModeratorPhrasingInput, ModeratorEvidencePacket } from "@interview/schemas";
import type { SourceAnswerProviderInput } from "./source-answer-service";
import { emptyModeratorState, runModeratorTurn } from "./mvp-moderator-service";

const mocks = vi.hoisted(() => ({
  plan: vi.fn(),
  phrase: vi.fn(),
  source: vi.fn(),
}));
vi.mock("./model-gateway", () => ({
  getOptionalOpenAIGateway: () => ({
    planModeratorTurn: mocks.plan,
    phraseModeratorTurn: mocks.phrase,
  }),
}));
vi.mock("./source-answer-service", () => ({
  askSourceProviderForSurveyInterviewerTurn: mocks.source,
}));

type ModeratorInput = Parameters<typeof runModeratorTurn>[0];
type SurveySlug = ModeratorInput["surveySlug"];

function evidenceFor(surveySlug: SurveySlug, topic: string): ModeratorEvidencePacket {
  return { sources: [{
    id: `${surveySlug}-${topic}-source`, surveySlug,
    title: `${surveySlug.toUpperCase()} ${topic} source`,
    url: `https://example.test/${surveySlug}/${topic}`,
    description: "Synthetic source fixture; no medical claim.",
    tags: [topic], text: `Original retrieved ${topic} source excerpt for ${surveySlug}.`, assets: [],
  }] };
}

function planned(overrides: Partial<ModeratorPlanResult> = {}): ModeratorPlanResult {
  return {
    newPriorities: [],
    reactionStatus: "not_answered",
    reactionEvidence: [],
    action: "probe_reaction",
    selectedPriorityId: null,
    rationale: "Retain the active research priority until its reaction is captured.",
    ...overrides,
  };
}

function inputFor(surveySlug: SurveySlug, overrides: Partial<ModeratorInput> = {}): ModeratorInput {
  return {
    surveySlug,
    brand: surveySlug.toUpperCase(),
    state: emptyModeratorState(),
    participantMessage: "PFS and DDI",
    currentQuestion: "Which factors matter most in your treatment decisions?",
    recentTurns: [],
    isPriorityQuestion: true,
    asksSourceQuestion: false,
    answerStatus: "answered",
    isResumeCue: false,
    surveyContext: `${surveySlug.toUpperCase()} synthetic moderator regression`,
    ...overrides,
  };
}

function initialPlan(surveySlug: SurveySlug) {
  return planned({
    action: "present_priority",
    newPriorities: [
      { label: "PFS", participantEvidence: "PFS", sourceQuestion: `What approved PFS evidence is available for ${surveySlug.toUpperCase()}?` },
      { label: "DDI", participantEvidence: "DDI", sourceQuestion: `What drug interactions are documented for ${surveySlug.toUpperCase()}?` },
    ],
  });
}

async function presentAgenda(surveySlug: SurveySlug) {
  mocks.plan.mockResolvedValueOnce({ result: initialPlan(surveySlug) });
  const first = await runModeratorTurn(inputFor(surveySlug));
  if (!first) throw new Error("A stated pair of priorities must create a moderator agenda.");
  return first;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.plan.mockReset();
  mocks.plan.mockResolvedValue({ result: planned() });
  mocks.phrase.mockReset();
  mocks.phrase.mockImplementation(async (input: ModeratorPhrasingInput) => ({
    result: {
      text: input.action === "guide_resume" ? input.selectedQuestion.question : input.action === "reaction"
        ? `How does this information about ${input.priorityLabel} affect your assessment?`
        : `You also mentioned ${input.priorityLabel}. Let's consider that next.`,
    },
  }));
  mocks.source.mockReset();
  mocks.source.mockImplementation(async (input: SourceAnswerProviderInput) => {
    const topic = /PFS|progression/i.test(input.participantMessage) ? "PFS" : "DDI";
    return {
      enabled: true,
      provider: "controlled_rag",
      answer: `${input.surveySlug.toUpperCase()} ${topic} approved source summary.`,
      references: [{ citationId: `${input.surveySlug}-${topic}-source`, title: `${input.surveySlug.toUpperCase()} ${topic} source`, url: `https://example.test/${input.surveySlug}/${topic}`, description: null, assets: [] }],
      citationIds: [`${input.surveySlug}-${topic}-source`],
      conversationId: null,
      reason: null,
      evidencePacket: evidenceFor(input.surveySlug, topic),
    };
  });
});

describe.each(["nubeqa", "brukinsa", "padcev"] as const)("%s reusable moderator loop", (surveySlug) => {
  it("handles clarification, retry and resume without planning an already parked source discussion", async () => {
    const first = await presentAgenda(surveySlug);
    const state = structuredClone(first.state);
    const priority = state.priorities[0];
    state.sourceDiscussion = { query: "What interaction instructions are described?", status: "open", returnTarget: { kind: "priority", id: priority.id }, evidencePacket: priority.evidencePacket, navigationHintShown: true };
    mocks.plan.mockClear();
    mocks.source.mockClear();
    mocks.source.mockResolvedValueOnce({ enabled: false, answer: null, references: [], reason: "Evidence unavailable" });
    const clarified = await runModeratorTurn(inputFor(surveySlug, { state, currentQuestion: first.question, participantMessage: "Can you explain that more simply?", isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered" }));
    expect(clarified?.decision).toMatchObject({ plannerAttempts: 0, plan: { reactionStatus: "not_answered", rationale: expect.stringContaining("Deterministic source-discussion clarification") } });
    expect(clarified?.state.understanding).toMatchObject({ preferredDepth: "brief", depthPreferenceExplicit: true, participantEvidence: ["Can you explain that more simply?"] });
    expect(clarified?.state.priorities).toEqual(state.priorities);
    expect(mocks.source.mock.calls.at(-1)![0]).toMatchObject({ requestOrigin: "participant", presentationPlan: { depth: "brief" } });
    const retried = await runModeratorTurn(inputFor(surveySlug, { state: structuredClone(clarified!.state), participantMessage: "retry", isPriorityQuestion: false, asksSourceQuestion: false, answerStatus: "not_answered" }));
    expect(retried?.decision.plannerAttempts).toBe(0);
    expect(retried?.state.priorities).toEqual(state.priorities);
    expect(mocks.source.mock.calls.at(-1)![0].participantMessage).toBe("Can you explain that more simply?");
    mocks.source.mockClear();
    const resumed = await runModeratorTurn(inputFor(surveySlug, { state: structuredClone(retried!.state), participantMessage: "Thanks, continue.", isPriorityQuestion: false, asksSourceQuestion: false, answerStatus: "not_answered", isResumeCue: true }));
    expect(resumed?.decision.plannerAttempts).toBe(0);
    expect(resumed?.state.priorities).toEqual(state.priorities);
    expect(resumed?.state.sourceDiscussion).toBeUndefined();
    expect(mocks.source).not.toHaveBeenCalled();
    expect(mocks.plan).not.toHaveBeenCalled();
  });

  it("starts transition and reaction phrasing together after the next priority evidence is ready", async () => {
    const first = await presentAgenda(surveySlug);
    const reaction = "This would be part of my assessment.";
    mocks.plan.mockResolvedValueOnce({ result: planned({ reactionStatus: "answered", reactionEvidence: [reaction], action: "present_priority", selectedPriorityId: first.state.priorities[1].id }) });
    let releaseTransition!: () => void;
    let markReactionStarted!: () => void;
    const reactionStarted = new Promise<void>((resolve) => { markReactionStarted = resolve; });
    const transitionReady = new Promise<void>((resolve) => { releaseTransition = resolve; });
    mocks.phrase.mockImplementation(async (input: ModeratorPhrasingInput) => {
      if (input.action === "transition") { await transitionReady; return { result: { text: "Next, DDI." } }; }
      markReactionStarted();
      return { result: { text: "What is your reaction to DDI?" } };
    });
    const pending = runModeratorTurn(inputFor(surveySlug, { state: first.state, participantMessage: reaction, isPriorityQuestion: false }));
    await reactionStarted;
    releaseTransition();
    const next = await pending;
    expect(next?.content).toMatch(/^Next, DDI\./);
    expect(next?.content).toMatch(/What is your reaction to DDI\?$/);
    expect(mocks.source.mock.calls.at(-1)![0]).toMatchObject({ requestOrigin: "selected_priority" });
  });

  it("treats an attributed recovery as delivered evidence and retains its distinct audit", async () => {
    const packet = evidenceFor(surveySlug, "PFS");
    const outcome = { version: 1, status: "extractive_recovery", attempts: [{ stage: "grounding", code: "unsupported_claims", responseId: "rejected", model: "fixture" }], recovery: { method: "verbatim_curated_source_card", sourceId: packet.sources[0].id, cause: "grounding_rejected" } };
    mocks.source.mockResolvedValueOnce({ enabled: true, answer: `Here is the wording from the source: “${packet.sources[0].text}” [1]`, references: [{ citationId: `rag:${packet.sources[0].id}`, title: packet.sources[0].title, url: packet.sources[0].url, description: null, assets: [] }], evidencePacket: packet, sourceAnswerGrounding: null, sourceOutcome: outcome });
    const result = await presentAgenda(surveySlug);
    expect(result.state.priorities[0]).toMatchObject({ status: "presented", evidencePacket: packet });
    expect(result.state.priorities[1].status).toBe("pending");
    expect(result.content).toContain(packet.sources[0].text);
    expect(result.content).not.toContain("couldn't produce a supported answer");
    expect(result.decision.sourceOutcome).toEqual(outcome);
    expect(result.decision.sourceAnswerGrounding).toBeNull();
  });
  it("grounds priority presentations and reloaded followups in participant wording instead of an expanded model source question", async () => {
    const generated = initialPlan(surveySlug);
    generated.newPriorities[0].sourceQuestion = "Compare PFS and MFS across every disease stage and population.";
    mocks.plan.mockResolvedValueOnce({ result: generated });
    const first = await runModeratorTurn(inputFor(surveySlug));
    const expected = `What information about PFS is available for ${surveySlug.toUpperCase()}?`;
    expect(mocks.source.mock.calls[0][0].participantMessage).toBe(expected);
    expect(first?.state.priorities[0].sourceQuestion).toBe(expected);
    // Keep the model proposal in the audited decision, not in canonical scope.
    expect(first?.decision.plan.newPriorities[0].sourceQuestion).toBe(generated.newPriorities[0].sourceQuestion);
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source", selectedPriorityId: first!.state.activePriorityId }) });
    const detour = await runModeratorTurn(inputFor(surveySlug, { state: JSON.parse(JSON.stringify(first!.state)), currentQuestion: first!.question, participantMessage: "Can you explain that more simply?", isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered" }));
    expect(mocks.source.mock.calls.at(-1)![0]).toMatchObject({ sourceTopicContext: expected, evidencePacket: evidenceFor(surveySlug, "PFS") });
    expect(detour?.state.sourceDiscussion?.query).toBe(expected);
    expect(detour?.state.priorities[0].status).toBe("presented");
  });

  it("does not let a broadened model label override its original evidence", async () => {
    const generated = initialPlan(surveySlug);
    generated.newPriorities[0] = { label: "PFS and MFS across stages", participantEvidence: "PFS", sourceQuestion: "Compare all endpoints across stages." };
    mocks.plan.mockResolvedValueOnce({ result: generated });
    const result = await runModeratorTurn(inputFor(surveySlug));
    expect(mocks.source.mock.calls[0][0].participantMessage).toBe(`What information about PFS is available for ${surveySlug.toUpperCase()}?`);
    expect(result?.state.priorities[0].label).toBe("PFS");
  });

  it("does not pass the previous priority's evidence to phrasing when the next answer has no packet", async () => {
    const first = await presentAgenda(surveySlug);
    expect(first.state.priorities[0].evidencePacket).toBeDefined();
    const reaction = "The efficacy results would be one part of my assessment.";
    mocks.plan.mockResolvedValueOnce({ result: planned({ sourceRequest: null, action: "present_priority", selectedPriorityId: first.state.priorities[1].id, reactionStatus: "answered", reactionEvidence: [reaction] }) });
    mocks.source.mockResolvedValueOnce({ enabled: true, provider: "controlled_rag", answer: "A cited DDI source answer without an evidence packet.", references: [{ citationId: "ddi-source", title: "DDI source", url: "https://example.test/ddi", description: null, assets: [] }], evidencePacket: null });
    mocks.phrase.mockClear();
    const next = await runModeratorTurn(inputFor(surveySlug, { state: first.state, currentQuestion: first.question, participantMessage: reaction, isPriorityQuestion: false, sourceRequest: null }));
    expect(next?.state.priorities[0].status).toBe("reacted");
    expect(next?.state.priorities[1]).toMatchObject({ label: "DDI", status: "presented" });
    expect(next?.state.priorities[1].evidencePacket).toBeUndefined();
    expect(mocks.phrase).toHaveBeenCalledTimes(2);
    for (const [input] of mocks.phrase.mock.calls) {
      expect(input.priorityLabel).toBe("DDI");
      expect(input.evidenceSummary).toBeUndefined();
    }
  });

  it.each([false, true])("uses low familiarity for brief first impressions, retaining reactions and moving to the next priority (phrasing failure=%s)", async (phrasingFails) => {
    const state = emptyModeratorState();
    state.understanding = { version: 1, productFamiliarity: "low", preferredDepth: "brief", participantEvidence: ["Not very familiar"] };
    mocks.plan.mockResolvedValueOnce({ result: initialPlan(surveySlug) });
    if (phrasingFails) mocks.phrase.mockRejectedValue(new Error("Phrasing unavailable"));
    else mocks.phrase.mockImplementation(async (input: ModeratorPhrasingInput) => ({ result: { text: input.action === "reaction" ? `What is your initial reaction to this information about ${input.priorityLabel}?` : "Let's consider the next priority." } }));
    const first = await runModeratorTurn(inputFor(surveySlug, { state }));
    expect(first?.question).toBe("What is your initial reaction to this information about PFS?");
    expect(mocks.phrase.mock.calls.at(-1)![0]).toMatchObject({ probeIntent: "first_impression", selectedObjective: expect.stringContaining("initial reaction"), presentationPlan: { depth: "brief" }, reactionEvidence: [] });
    const reaction = "The efficacy results would be one part of my assessment; I would also weigh interaction concerns.";
    mocks.plan.mockResolvedValueOnce({ result: planned({ sourceRequest: null, action: "present_priority", selectedPriorityId: first!.state.priorities[1].id, reactionStatus: "answered", reactionEvidence: [reaction] }) });
    const next = await runModeratorTurn(inputFor(surveySlug, { state: first!.state, currentQuestion: first!.question, participantMessage: reaction, isPriorityQuestion: false, sourceRequest: null }));
    expect(next?.state.priorities[0]).toMatchObject({ status: "reacted", reactionEvidence: [reaction] });
    expect(next?.question).toBe("What is your initial reaction to this information about DDI?");
    expect(next?.state.sourceDiscussion).toBeUndefined();
    expect(mocks.phrase.mock.calls.at(-1)![0]).toMatchObject({ probeIntent: "first_impression", reactionEvidence: [] });
  });

  it("retains the failed practical question while retrieving fresh support for repeated clarification", async () => {
    const first = await presentAgenda(surveySlug);
    const oldPacket = first.state.priorities[0].evidencePacket;
    const pending = "What does that mean for what to monitor in practical terms?";
    const failure = { enabled: false, answer: null, references: [], reason: "Grounding rejected", sourceOutcome: { version: 1, status: "grounding_rejected", attempts: [] } };
    mocks.source.mockResolvedValueOnce(failure);
    const failed = await runModeratorTurn(inputFor(surveySlug, { state: first.state, participantMessage: pending, isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered" }));
    mocks.source.mockResolvedValueOnce(failure);
    const stillFailed = await runModeratorTurn(inputFor(surveySlug, { state: structuredClone(failed!.state), participantMessage: "Can you explain that more simply?", isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered" }));
    expect(mocks.source.mock.calls.at(-1)![0]).toMatchObject({ participantMessage: "Can you explain that more simply?", sourceTopicContext: expect.stringContaining(pending), evidencePacket: undefined });
    expect(stillFailed?.state.sourceDiscussion).toMatchObject({ status: "failed", pendingQuestion: pending, evidencePacket: oldPacket });
    const newPacket = evidenceFor(surveySlug, "practical");
    mocks.source.mockResolvedValueOnce({ enabled: true, answer: "Supported practical explanation.", references: first.references, evidencePacket: newPacket });
    const clarified = await runModeratorTurn(inputFor(surveySlug, { state: structuredClone(stillFailed!.state), participantMessage: "Even more simply please.", isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered" }));
    expect(mocks.source.mock.calls.at(-1)![0]).toMatchObject({ participantMessage: "Even more simply please.", sourceTopicContext: expect.stringContaining(pending), evidencePacket: undefined });
    expect(clarified?.state.sourceDiscussion).toMatchObject({ status: "open", query: pending, evidencePacket: newPacket });
    expect(clarified?.state.sourceDiscussion?.pendingQuestion).toBeUndefined();
    expect(first.state.priorities[0].evidencePacket).toEqual(oldPacket);
  });

  it("credits a separate mixed-turn reaction even when upstream says not_answered, then resumes the next priority", async () => {
    const first = await presentAgenda(surveySlug);
    const reaction = "It's something I need to track but not terribly concerning.";
    const question = "So someone on those medications is at risk for what adverse reactions";
    const sourceRequest = { kind: "question" as const, participantEvidence: question, resolvedQuestion: question };
    mocks.plan.mockResolvedValueOnce({ result: planned({ sourceRequest, action: "answer_source", reactionStatus: "answered", reactionEvidence: [reaction] }) });
    const detour = await runModeratorTurn(inputFor(surveySlug, { state: first.state, participantMessage: `${reaction} ${question}`, isPriorityQuestion: false, sourceRequest, asksSourceQuestion: true, answerStatus: "not_answered" }));
    expect(detour?.state.priorities[0]).toMatchObject({ status: "reacted", reactionEvidence: [reaction] });
    expect(detour?.question).toBeNull();
    expect(detour?.decision.plan.reactionStatus).toBe("answered");
    mocks.plan.mockResolvedValueOnce({ result: planned({ sourceRequest: null, action: "present_priority", selectedPriorityId: first.state.priorities[1].id }) });
    const resumed = await runModeratorTurn(inputFor(surveySlug, { state: detour!.state, participantMessage: "Thanks, continue.", isPriorityQuestion: false, sourceRequest: null, asksSourceQuestion: false, answerStatus: "not_answered", isResumeCue: true }));
    expect(resumed?.state.priorities[1].status).toBe("presented");
    expect(resumed?.state.activePriorityId).toBe(first.state.priorities[1].id);
  });

  it("rejects overlapping request text as reaction credit even if upstream and planner both say answered", async () => {
    const first = await presentAgenda(surveySlug);
    const question = "Can you explain that more simply?";
    const sourceRequest = { kind: "clarification_request" as const, participantEvidence: question, resolvedQuestion: question };
    mocks.plan.mockResolvedValueOnce({ result: planned({ sourceRequest, action: "answer_source", reactionStatus: "answered", reactionEvidence: ["explain that more simply"] }) });
    const detour = await runModeratorTurn(inputFor(surveySlug, { state: first.state, participantMessage: question, isPriorityQuestion: false, sourceRequest, asksSourceQuestion: true, answerStatus: "answered" }));
    expect(detour?.state.priorities[0]).toMatchObject({ status: "presented", reactionEvidence: [] });
    expect(detour?.decision.plan).toMatchObject({ reactionStatus: "not_answered", reactionEvidence: [] });
    expect(detour?.question).toBeNull();
  });

  it("does not let a stale source boolean override explicit null request provenance", async () => {
    const first = await presentAgenda(surveySlug);
    const participantMessage = "The efficacy results would be one part of my assessment; I would also weigh interaction concerns.";
    mocks.plan.mockResolvedValueOnce({ result: planned({ sourceRequest: null, action: "present_priority", reactionStatus: "answered", reactionEvidence: [participantMessage], selectedPriorityId: first.state.priorities[1].id }) });
    const next = await runModeratorTurn(inputFor(surveySlug, { state: first.state, participantMessage, isPriorityQuestion: false, sourceRequest: null, asksSourceQuestion: true }));
    expect(mocks.plan.mock.calls.at(-1)![0]).toMatchObject({ asksSourceQuestion: false, sourceRequest: null });
    expect(next?.decision.action).toBe("present_priority");
    expect(next?.state.priorities[0].status).toBe("reacted");
    expect(next?.state.priorities[1].status).toBe("presented");
    expect(next?.state.sourceDiscussion).toBeUndefined();
  });

  it("keeps source evidence and reaction state through a failed followup, retry, and continue", async () => {
    const initial = await presentAgenda(surveySlug);
    const active = initial.state.priorities[0];
    mocks.source.mockResolvedValueOnce({ enabled: false, answer: null, references: [], reason: "Grounding rejected", sourceOutcome: { version: 1, status: "grounding_rejected", attempts: [] } });
    const failed = await runModeratorTurn(inputFor(surveySlug, { state: initial.state, isPriorityQuestion: false, participantMessage: "What else does that evidence say?", asksSourceQuestion: true, answerStatus: "not_answered" }));
    expect(failed?.state.sourceDiscussion).toMatchObject({ query: active.sourceQuestion, pendingQuestion: "What else does that evidence say?", status: "failed", evidencePacket: active.evidencePacket, returnTarget: { kind: "priority", id: active.id }, failure: { stage: "grounding" } });
    expect(failed?.state.priorities[0]).toMatchObject({ status: "presented", probeCount: 0, reactionEvidence: [] });
    expect(failed?.question).toBeNull();
    const retried = await runModeratorTurn(inputFor(surveySlug, { state: structuredClone(failed!.state), isPriorityQuestion: false, participantMessage: "retry", asksSourceQuestion: false, answerStatus: "not_answered" }));
    expect(mocks.source.mock.calls.at(-1)![0]).toMatchObject({ participantMessage: "What else does that evidence say?", sourceTopicContext: active.sourceQuestion, evidencePacket: active.evidencePacket });
    expect(retried?.content).not.toContain('say "continue"');
    const resumed = await runModeratorTurn(inputFor(surveySlug, { state: retried!.state, isPriorityQuestion: false, participantMessage: "continue", asksSourceQuestion: false, answerStatus: "not_answered", isResumeCue: true }));
    expect(resumed?.state.activePriorityId).toBe(active.id);
    expect(resumed?.state.priorities[0].probeCount).toBe(0);
    expect(resumed?.state.sourceDiscussion).toBeUndefined();
    expect(resumed?.question).toContain("PFS");
  });
  it.each(["schema", "evidence"])("retries one invalid planner %s result without duplicate state changes or source calls", async (failure) => {
    const first = await presentAgenda(surveySlug);
    const reaction = "That evidence would increase my confidence in choosing it for appropriate patients.";
    mocks.plan.mockClear();
    mocks.source.mockClear();
    mocks.plan.mockResolvedValueOnce({ result: planned({
      reactionStatus: "answered", reactionEvidence: failure === "schema" ? [] : ["A fabricated reaction"],
    }) });
    mocks.plan.mockResolvedValueOnce({ result: planned({
      reactionStatus: "answered", reactionEvidence: [reaction], action: "present_priority", selectedPriorityId: first.state.priorities[1].id,
    }) });
    const recovered = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question, participantMessage: reaction, isPriorityQuestion: false,
    }));

    expect(mocks.plan).toHaveBeenCalledTimes(2);
    expect(mocks.plan.mock.calls[0][0]).toEqual(mocks.plan.mock.calls[1][0]);
    expect(recovered?.decision).toMatchObject({ plannerAttempts: 2, plannerRecovered: true, plannerError: null });
    expect(recovered?.decision.plannerErrors).toHaveLength(1);
    expect(recovered?.decision.plannerFailures).toEqual([expect.objectContaining({ code: failure === "schema" ? "invalid_schema" : "invalid_reaction_excerpt", status: null })]);
    expect(JSON.stringify(recovered?.decision.plannerFailures)).not.toContain("fabricated");
    expect(recovered?.state.priorities[0]).toMatchObject({ status: "reacted", reactionEvidence: [reaction], probeCount: 0 });
    expect(recovered?.state.priorities[1].status).toBe("presented");
    expect(mocks.source).toHaveBeenCalledTimes(1);
    expect(first.state.priorities[0]).toMatchObject({ status: "presented", reactionEvidence: [], probeCount: 0 });
  });

  it.each([
    { content: "That evidence would increase my confidence in choosing it for appropriate patients.", answerStatus: "answered" as const, asksSourceQuestion: false, isResumeCue: false, probes: 1 },
    { content: "CYP3A4 inducers", answerStatus: "answered" as const, asksSourceQuestion: false, isResumeCue: false, probes: 1 },
    { content: "Can you explain that more simply?", answerStatus: "not_answered" as const, asksSourceQuestion: true, isResumeCue: false, probes: 0 },
    { content: "continue", answerStatus: "not_answered" as const, asksSourceQuestion: false, isResumeCue: true, probes: 0 },
  ])("preserves conservative answer credit after both planner attempts fail: $content", async ({ content, answerStatus, asksSourceQuestion, isResumeCue, probes }) => {
    const first = await presentAgenda(surveySlug);
    mocks.plan.mockClear();
    mocks.plan.mockRejectedValueOnce(new Error("Invalid model result on first attempt"));
    mocks.plan.mockRejectedValueOnce(new Error("Invalid model result on retry"));
    const failed = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question, participantMessage: content,
      isPriorityQuestion: false, answerStatus, asksSourceQuestion, isResumeCue,
    }));

    expect(mocks.plan).toHaveBeenCalledTimes(2);
    expect(failed?.decision).toMatchObject({
      plannerAttempts: 2, plannerRecovered: false, plannerError: "Invalid model result on retry",
      plannerErrors: ["Invalid model result on first attempt", "Invalid model result on retry"],
    });
    expect(failed?.state.priorities[0]).toMatchObject({ status: "presented", reactionEvidence: [], probeCount: probes });
    expect(failed?.state.priorities[1].status).toBe("pending");
    expect(failed?.state.activePriorityId).toBe(first.state.activePriorityId);
  });

  it("retains both stated priorities and presents cited evidence before asking for the first reaction", async () => {
    const first = await presentAgenda(surveySlug);
    expect(first.state.priorities.map((priority) => [priority.label, priority.status])).toEqual([["PFS", "presented"], ["DDI", "pending"]]);
    expect(first.state.priorities.map((priority) => priority.participantEvidence)).toEqual(["PFS", "DDI"]);
    expect(first.state.activePriorityId).toBe(first.state.priorities[0].id);
    expect(first.state.priorities[0].referenceIds).toEqual([`${surveySlug}-PFS-source`]);
    expect(first.state.priorities[0].evidencePacket).toEqual(evidenceFor(surveySlug, "PFS"));
    expect(first.state.priorities[0].reactionEvidence).toEqual([]);
    expect(first.creditOriginalAnswer).toBe(true);
    expect(first.content).toContain("PFS and DDI");
    expect(first.content!.indexOf("approved source summary")).toBeLessThan(first.content!.indexOf(first.question!));
    expect(first.question).toMatch(/PFS.*\?$/);
    expect(mocks.source).toHaveBeenCalledTimes(1);
    expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({ surveySlug, responseMode: "answer_only", selectedNextQuestion: null }));
  });

  it("captures a partial reaction, then advances to the other priority after a substantive reaction", async () => {
    const first = await presentAgenda(surveySlug);
    const partialText = "I am uncertain about the follow-up.";
    mocks.plan.mockResolvedValueOnce({ result: planned({ reactionStatus: "partial", reactionEvidence: [partialText], selectedPriorityId: first.state.activePriorityId }) });
    const partial = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question, participantMessage: partialText,
      isPriorityQuestion: false, answerStatus: "partial",
    }));
    expect(partial?.state.activePriorityId).toBe(first.state.activePriorityId);
    expect(partial?.state.priorities[0]).toMatchObject({ status: "presented", reactionEvidence: [partialText] });
    expect(partial?.sourceUsed).toBe(false);

    const reaction = "The follow-up is too short to change my approach.";
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "present_priority", selectedPriorityId: first.state.priorities[1].id, reactionStatus: "answered", reactionEvidence: [reaction] }) });
    const next = await runModeratorTurn(inputFor(surveySlug, {
      state: partial!.state, currentQuestion: partial!.question, participantMessage: reaction,
      isPriorityQuestion: false, answerStatus: "answered",
    }));
    expect(next?.state.priorities[0]).toMatchObject({ status: "reacted", reactionEvidence: [partialText, reaction] });
    expect(next?.state.priorities[1]).toMatchObject({ status: "presented", referenceIds: [`${surveySlug}-DDI-source`] });
    expect(next?.state.activePriorityId).toBe(first.state.priorities[1].id);
    expect(next?.question).toMatch(/DDI.*\?$/);
    expect(next?.content).toContain("You also mentioned DDI.");
    expect(next?.content).not.toContain("PFS approved source summary");
    expect(mocks.phrase).toHaveBeenCalledWith(expect.objectContaining({ action: "transition", priorityLabel: "DDI", previousPriorityLabel: "PFS" }));
  });

  it("preserves an unanswered reaction through a source-question detour and navigation back", async () => {
    const first = await presentAgenda(surveySlug);
    const question = "Does that evidence include older people?";
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source", selectedPriorityId: first.state.activePriorityId }) });
    const detour = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question, participantMessage: question,
      isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered",
      recentTurns: [{ role: "interviewer", content: first.content! }],
    }));
    expect(detour?.decision.action).toBe("answer_source");
    expect(detour?.state.priorities).toEqual(first.state.priorities);
    expect(detour?.state.activePriorityId).toEqual(first.state.activePriorityId);
    expect(detour?.question).toBeNull();
    expect(detour?.content).not.toContain(first.question!);

    mocks.plan.mockResolvedValueOnce({ result: planned({ selectedPriorityId: first.state.activePriorityId }) });
    mocks.source.mockClear();
    const resumed = await runModeratorTurn(inputFor(surveySlug, {
      state: detour!.state, currentQuestion: first.question, participantMessage: "Thanks, continue.",
      isPriorityQuestion: false, answerStatus: "not_answered", isResumeCue: true,
    }));
    expect(resumed?.state).toEqual(first.state);
    expect(resumed?.question).toBe(first.question);
    expect(resumed?.state.priorities[0].reactionEvidence).toEqual([]);
    expect(resumed?.state.priorities[1].status).toBe("pending");
    expect(mocks.source).not.toHaveBeenCalled();
  });

  it.each([true, false])("binds a planner-selected source followup to active DDI when upstream asksSourceQuestion is %s", async (asksSourceQuestion) => {
    const first = await presentAgenda(surveySlug);
    const reaction = "That evidence would increase my confidence in choosing it for appropriate patients.";
    mocks.plan.mockResolvedValueOnce({ result: planned({
      action: "present_priority", selectedPriorityId: first.state.priorities[1].id,
      reactionStatus: "answered", reactionEvidence: [reaction],
    }) });
    const second = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question, participantMessage: reaction,
      isPriorityQuestion: false,
    }));
    expect(second?.state.priorities[1].status).toBe("presented");
    const restoredState = JSON.parse(JSON.stringify(second!.state));
    const expectedPacket = evidenceFor(surveySlug, "DDI");
    expect(restoredState.priorities[1].evidencePacket).toEqual(expectedPacket);
    expect(JSON.stringify(expectedPacket)).not.toContain("approved source summary");
    const activeSourceQuestion = second!.state.priorities[1].sourceQuestion;
    mocks.source.mockClear();
    mocks.plan.mockResolvedValueOnce({ result: planned({
      action: "answer_source", selectedPriorityId: second!.state.activePriorityId,
      reactionStatus: "answered", reactionEvidence: ["Can you explain that more simply?"],
    }) });
    const followup = await runModeratorTurn(inputFor(surveySlug, {
      state: restoredState, currentQuestion: second!.question,
      participantMessage: "Can you explain that more simply?",
      isPriorityQuestion: false, asksSourceQuestion, answerStatus: "not_answered",
      recentTurns: [{ role: "participant", content: reaction }, { role: "interviewer", content: second!.content! }],
    }));

    expect(followup?.state.priorities).toEqual(second!.state.priorities);
    expect(followup?.state.activePriorityId).toEqual(second!.state.activePriorityId);
    expect(followup?.question).toBeNull();
    expect(followup?.content).not.toContain(second!.question!);
    expect(mocks.source).toHaveBeenCalledTimes(1);
    expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({
      participantMessage: "Can you explain that more simply?",
      sourceTopicContext: activeSourceQuestion,
      evidencePacket: expectedPacket,
      responseMode: "answer_only",
    }));
    expect(activeSourceQuestion).toBe(`What information about DDI is available for ${surveySlug.toUpperCase()}?`);
  });

  it("audits the search interpretation while retaining the actual discussion request and structured conversation", async () => {
    const first = await presentAgenda(surveySlug);
    const recentTurns: ModeratorInput["recentTurns"] = [
      { role: "participant", content: "Which drug interactions are documented?" },
      { role: "interviewer", content: "The source describes interaction precautions." },
    ];
    const sourceQuestionPlan = sourceQuestionPlanSchema.parse({
      version: 1,
      interpretedQuestion: `What monitoring information is documented for ${surveySlug.toUpperCase()} in the context of those drug interactions?`,
      usesSourceContext: true,
      retrievalQueries: ["drug interaction precautions", "general safety monitoring"],
      answerApproach: "contextual_explanation",
      contextBoundary: "General monitoring information does not establish interaction-caused adverse reactions.",
      rationale: "Resolve the reference to the preceding interaction discussion while preserving the new monitoring question.",
    });
    const sourceAnswerGrounding = sourceAnswerGroundingAuditSchema.parse({ version: 1, status: "supported", attempt: 2, model: "source-model", responseId: "review-fixture" });
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source", selectedPriorityId: first.state.activePriorityId }) });
    mocks.source.mockResolvedValueOnce({
      enabled: true, provider: "controlled_rag", answer: "Synthetic contextual source explanation.",
      references: [{ citationId: `${surveySlug}-DDI-source`, title: "Synthetic interaction source", url: `https://example.test/${surveySlug}/DDI`, description: null, assets: [] }],
      citationIds: [`${surveySlug}-DDI-source`], conversationId: null, reason: null,
      evidencePacket: evidenceFor(surveySlug, "DDI"), sourceQuestionPlan, sourceAnswerGrounding,
    });
    const result = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question,
      participantMessage: "What should be monitored with those medications?", recentTurns,
      isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered",
    }));

    expect(mocks.source).toHaveBeenLastCalledWith(expect.objectContaining({ recentTurns }));
    expect(result?.decision.sourceQuestionPlan).toEqual(sourceQuestionPlan);
    expect(result?.decision.sourceAnswerGrounding).toEqual(sourceAnswerGrounding);
    expect(result?.state.sourceDiscussion).toMatchObject({
      query: "What should be monitored with those medications?", evidencePacket: evidenceFor(surveySlug, "DDI"),
    });
    expect(result?.state.priorities).toEqual(first.state.priorities);
  });

  it("does not save an unasked search expansion as the source discussion topic", async () => {
    const first = await presentAgenda(surveySlug);
    const request = `What PFS evidence is available for ${surveySlug}?`;
    const expanded = `Compare PFS and MFS results for ${surveySlug}.`;
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source", selectedPriorityId: first.state.activePriorityId }) });
    mocks.source.mockResolvedValueOnce({ enabled: true, answer: "Synthetic PFS answer. [1]", references: [{ citationId: "rag:fixture", title: "Synthetic", url: "https://example.test", description: null, assets: [] }], evidencePacket: evidenceFor(surveySlug, "PFS"), sourceQuestionPlan: { version: 1, interpretedQuestion: expanded, retrievalQueries: [expanded], answerApproach: "direct", usesSourceContext: false, contextBoundary: null, rationale: "Adversarial broader search." } });
    const detour = await runModeratorTurn(inputFor(surveySlug, { state: first.state, currentQuestion: first.question, participantMessage: request, isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered" }));
    expect(detour?.state.sourceDiscussion?.query).toBe(request);
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source", selectedPriorityId: first.state.activePriorityId }) });
    const followup = await runModeratorTurn(inputFor(surveySlug, { state: JSON.parse(JSON.stringify(detour!.state)), currentQuestion: first.question, participantMessage: "Can you explain that more simply?", isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered" }));
    expect(mocks.source).toHaveBeenLastCalledWith(expect.objectContaining({ sourceTopicContext: request, evidencePacket: evidenceFor(surveySlug, "PFS") }));
    expect(followup?.state.sourceDiscussion?.query).toBe(request);
  });

  it("clarifies the latest DDI detour after restart while preserving the original PFS reaction", async () => {
    const first = await presentAgenda(surveySlug);
    const sourceQuestion = `What drug interactions are documented for ${surveySlug.toUpperCase()}?`;
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source", selectedPriorityId: first.state.activePriorityId }) });
    const detour = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question, participantMessage: sourceQuestion,
      isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered",
    }));
    expect(detour?.state.sourceDiscussion).toMatchObject({ query: sourceQuestion, evidencePacket: evidenceFor(surveySlug, "DDI") });
    expect(detour?.state.priorities).toEqual(first.state.priorities);
    mocks.source.mockClear();
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source", selectedPriorityId: first.state.activePriorityId }) });
    const followup = await runModeratorTurn(inputFor(surveySlug, {
      state: JSON.parse(JSON.stringify(detour!.state)), currentQuestion: first.question,
      participantMessage: "Can you explain that more simply?",
      isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered",
    }));
    expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({
      sourceTopicContext: sourceQuestion, evidencePacket: evidenceFor(surveySlug, "DDI"),
    }));
    expect(followup?.state.sourceDiscussion).toEqual(detour?.state.sourceDiscussion);
    expect(followup?.state.priorities[0].evidencePacket).toEqual(evidenceFor(surveySlug, "PFS"));
    expect(followup?.question).toBeNull();
    mocks.source.mockClear();
    const resumed = await runModeratorTurn(inputFor(surveySlug, {
      state: followup!.state, currentQuestion: first.question, participantMessage: "continue",
      isPriorityQuestion: false, isResumeCue: true, answerStatus: "not_answered",
    }));
    expect(resumed?.state).toMatchObject(first.state);
    expect(resumed?.state.understanding).toMatchObject({ preferredDepth: "brief", depthPreferenceExplicit: true, participantEvidence: ["Can you explain that more simply?"] });
    expect(resumed?.question).toBe(first.question);
    expect(resumed?.state).not.toHaveProperty("sourceDiscussion");
    expect(mocks.source).not.toHaveBeenCalled();
  });

  it.each([true, false])("finishes the exact mixed adverse-reaction question before handing back to the guide (upstream source flag=%s)", async (asksSourceQuestion) => {
    const first = await presentAgenda(surveySlug);
    const firstReaction = "This evidence would affect my decision.";
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "present_priority", selectedPriorityId: first.state.priorities[1].id, reactionStatus: "answered", reactionEvidence: [firstReaction] }) });
    const second = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question, participantMessage: firstReaction, isPriorityQuestion: false,
    }));
    const finalReaction = "It's something that I need to track but not terribly concerning.";
    const mixedMessage = `${finalReaction}  So someone on those medications are at risk for what adverse reactions`;
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source", reactionStatus: "answered", reactionEvidence: [finalReaction] }) });
    const mixed = await runModeratorTurn(inputFor(surveySlug, {
      state: second!.state, currentQuestion: second!.question,
      participantMessage: mixedMessage,
      isPriorityQuestion: false, asksSourceQuestion, answerStatus: "answered",
    }));
    expect(mixed?.question).toBeNull();
    expect(mixed?.content).not.toContain(second!.question!);
    expect(mixed?.state.priorities[1].reactionEvidence).toEqual([finalReaction]);
    expect(mocks.source).toHaveBeenLastCalledWith(expect.objectContaining({ participantMessage: mixedMessage, responseMode: "answer_only" }));
    expect(mixed?.state.priorities.every((priority) => priority.status === "reacted")).toBe(true);
    expect(mixed?.state.activePriorityId).toBeNull();
    expect(mixed?.state.sourceDiscussion).toBeDefined();
    mocks.source.mockClear();
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source" }) });
    const followup = await runModeratorTurn(inputFor(surveySlug, {
      state: JSON.parse(JSON.stringify(mixed!.state)), currentQuestion: second!.question,
      participantMessage: "Can you explain that more simply?",
      isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered",
    }));
    expect(followup?.decision.action).toBe("answer_source");
    expect(mocks.source).toHaveBeenCalledWith(expect.objectContaining({ evidencePacket: evidenceFor(surveySlug, "DDI") }));
    expect(followup?.state.priorities).toEqual(mixed!.state.priorities);
    const resumed = await runModeratorTurn(inputFor(surveySlug, {
      state: followup!.state, currentQuestion: second!.question, participantMessage: "continue",
      isPriorityQuestion: false, isResumeCue: true, answerStatus: "not_answered",
    }));
    expect(resumed?.decision.action).toBe("resume_guide");
    expect(resumed?.content).toBeNull();
    expect(resumed?.state).not.toHaveProperty("sourceDiscussion");
  });

  it("honors an explicit request to leave all remaining topics without fabricating reactions", async () => {
    const first = await presentAgenda(surveySlug);
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "resume_guide" }) });
    mocks.source.mockClear();
    const finished = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question,
      participantMessage: "I'm done with these topics; move on",
      isPriorityQuestion: false, answerStatus: "not_answered",
    }));
    expect(finished?.state.priorities.map((priority) => priority.status)).toEqual(["skipped", "skipped"]);
    expect(finished?.state.priorities.every((priority) => priority.reactionEvidence.length === 0)).toBe(true);
    expect(finished?.state.activePriorityId).toBeNull();
    expect(finished?.content).toBeNull();
    expect(finished?.question).toBeNull();
    expect(finished?.decision.action).toBe("resume_guide");
    expect(mocks.source).not.toHaveBeenCalled();
  });

  it.each(["missing-answer", "missing-citations"])("does not ask for a reaction to unsupported source material: %s", async (failure) => {
    mocks.source.mockResolvedValueOnce({
      enabled: true, provider: "controlled_rag", answer: failure === "missing-answer" ? null : "An unsupported source claim.",
      references: failure === "missing-answer" ? [{ citationId: "empty-answer-source", title: "Source without an answer", url: `https://example.test/${surveySlug}/empty`, description: null, assets: [] }] : [],
      citationIds: [], conversationId: null, reason: "No approved supporting evidence.",
    });
    const first = await presentAgenda(surveySlug);
    expect(first.state.priorities.map((priority) => priority.status)).toEqual(["pending", "pending"]);
    expect(first.state.activePriorityId).toBeNull();
    expect(first.question).toBeNull();
    expect(first.content).not.toContain("An unsupported source claim.");
    expect(first.content).not.toMatch(/How does this information/);
    expect(mocks.phrase).not.toHaveBeenCalled();
  });
});
