import { beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(detour?.state).toEqual(first.state);
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
    }) });
    const followup = await runModeratorTurn(inputFor(surveySlug, {
      state: restoredState, currentQuestion: second!.question,
      participantMessage: "Can you explain that more simply?",
      isPriorityQuestion: false, asksSourceQuestion, answerStatus: "not_answered",
      recentTurns: [{ role: "participant", content: reaction }, { role: "interviewer", content: second!.content! }],
    }));

    expect(followup?.state).toEqual(second!.state);
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
