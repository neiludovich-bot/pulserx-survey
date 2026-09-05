import { beforeEach, describe, expect, it, vi } from "vitest";
import { sourceQuestionPlanSchema } from "@interview/schemas";
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
      text: input.action === "reaction"
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
    expect(activeSourceQuestion).toMatch(/drug interactions/);
  });

  it("retains the validated source question plan and resolved discussion while forwarding structured conversation", async () => {
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
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source", selectedPriorityId: first.state.activePriorityId }) });
    mocks.source.mockResolvedValueOnce({
      enabled: true, provider: "controlled_rag", answer: "Synthetic contextual source explanation.",
      references: [{ citationId: `${surveySlug}-DDI-source`, title: "Synthetic interaction source", url: `https://example.test/${surveySlug}/DDI`, description: null, assets: [] }],
      citationIds: [`${surveySlug}-DDI-source`], conversationId: null, reason: null,
      evidencePacket: evidenceFor(surveySlug, "DDI"), sourceQuestionPlan,
    });
    const result = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question,
      participantMessage: "What should be monitored with those medications?", recentTurns,
      isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered",
    }));

    expect(mocks.source).toHaveBeenLastCalledWith(expect.objectContaining({ recentTurns }));
    expect(result?.decision.sourceQuestionPlan).toEqual(sourceQuestionPlan);
    expect(result?.state.sourceDiscussion).toEqual({
      query: sourceQuestionPlan.interpretedQuestion, evidencePacket: evidenceFor(surveySlug, "DDI"),
    });
    expect(result?.state.priorities).toEqual(first.state.priorities);
  });

  it("clarifies the latest DDI detour after restart while preserving the original PFS reaction", async () => {
    const first = await presentAgenda(surveySlug);
    const sourceQuestion = `What drug interactions are documented for ${surveySlug.toUpperCase()}?`;
    mocks.plan.mockResolvedValueOnce({ result: planned({ action: "answer_source", selectedPriorityId: first.state.activePriorityId }) });
    const detour = await runModeratorTurn(inputFor(surveySlug, {
      state: first.state, currentQuestion: first.question, participantMessage: sourceQuestion,
      isPriorityQuestion: false, asksSourceQuestion: true, answerStatus: "not_answered",
    }));
    expect(detour?.state.sourceDiscussion).toEqual({ query: sourceQuestion, evidencePacket: evidenceFor(surveySlug, "DDI") });
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
    expect(resumed?.state).toEqual(first.state);
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
