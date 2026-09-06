import { afterEach, describe, expect, it, vi } from "vitest";
import { logSyntheticModeratorDecision, sanitizeModeratorPlanningFailure } from "./synthetic-moderator-diagnostics";

const reaction = "PRIVATE REACTION.";
const question = "PRIVATE QUESTION?";
const input: Parameters<typeof logSyntheticModeratorDecision>[0] = {
  studyName: "SYNTHETIC QA PRIVATE STUDY", surveySlug: "nubeqa", phase: "after_moderator", turnSequence: 8,
  participantMessage: `${reaction} ${question}`,
  route: { provider: "openai_hybrid", answerStatus: "answered", asksSourceQuestion: true, answerEvidence: [reaction], sourceRequest: { kind: "question", participantEvidence: question, resolvedQuestion: "PRIVATE RESOLVED" }, suggestedQuestionIds: [], modelResult: null, error: "PRIVATE ERROR", decision: { kind: "source_question", topic: null, needsSource: true, isOutOfScope: false, isUnanticipated: false, sourceDirective: "PRIVATE DIRECTIVE", rationale: "PRIVATE RATIONALE" } },
  state: { version: 1, activePriorityId: "PRIVATE ID", priorities: [{ id: "PRIVATE ID", label: "PRIVATE LABEL", participantEvidence: "PRIVATE PRIORITY", status: "presented", sourceQuestion: "PRIVATE SOURCE", reactionEvidence: [], referenceIds: [], probeCount: 0 }] },
  moderatorDecision: { action: "answer_source", plannerAttempts: 1, plannerRecovered: false, plan: { newPriorities: [], reactionStatus: "answered", reactionEvidence: [reaction], sourceRequest: { kind: "question", participantEvidence: question, resolvedQuestion: "PRIVATE RESOLVED" }, action: "answer_source", selectedPriorityId: "PRIVATE ID", rationale: "PRIVATE RATIONALE" } },
};

describe("synthetic-only moderator decisions", () => {
  afterEach(() => vi.restoreAllMocks());
  it.each(["Ordinary research", "Ordinary SYNTHETIC QA embedded", "SYNTHETIC QA"])("excludes ordinary or incompletely labeled studies: %s", (studyName) => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSyntheticModeratorDecision({ ...input, studyName });
    expect(log).not.toHaveBeenCalled();
  });
  it("emits only flags, statuses and character spans before and after moderation", () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSyntheticModeratorDecision({ ...input, phase: "before_moderator", moderatorDecision: undefined });
    logSyntheticModeratorDecision(input);
    const events = log.mock.calls.map(([line]) => JSON.parse(line));
    expect(events[0]).toMatchObject({ phase: "before_moderator", moderator: null });
    expect(events[1]).toMatchObject({ event: "synthetic_moderator_decision", phase: "after_moderator", turnSequence: 8,
      router: { answerStatus: "answered", asksSourceQuestion: true, sourceRequest: { kind: "question", span: { start: reaction.length + 1, length: question.length } }, answerSpans: [{ start: 0, length: reaction.length }] },
      moderator: { action: "answer_source", reactionStatus: "answered", reactionSpans: [{ start: 0, length: reaction.length }], plannerAttempts: 1 },
      state: { activePriorityIndex: 0, priorities: [{ index: 0, status: "presented", probeCount: 0, reactionSpans: [] }] },
    });
    expect(JSON.stringify(events)).not.toContain("PRIVATE");
  });
  it("never changes delivery if diagnostic logging fails", () => {
    vi.spyOn(console, "warn").mockImplementation(() => { throw new Error("logging failed"); });
    expect(() => logSyntheticModeratorDecision(input)).not.toThrow();
  });
  it("retains safe validation categories and schema paths without provider or participant text", () => {
    const local = sanitizeModeratorPlanningFailure(new Error("A participant source question must retain its source-answer action."));
    expect(local.code).toBe("lost_source_action");
    expect(sanitizeModeratorPlanningFailure(local)).toEqual(local);
    const invalid = sanitizeModeratorPlanningFailure({ name: "ZodError", message: "PRIVATE OUTPUT", issues: [{ code: "invalid_type", path: ["sourceRequest", "participantEvidence", "PRIVATE KEY", 1], received: "PRIVATE VALUE", message: "PRIVATE VALIDATION" }] });
    expect(invalid).toMatchObject({ code: "invalid_schema", errorName: "ZodError", issues: [{ code: "invalid_type", path: ["sourceRequest", "participantEvidence", "[unknown]", "[]"] }] });
    expect(sanitizeModeratorPlanningFailure(invalid)).toEqual(invalid);
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    logSyntheticModeratorDecision({ ...input, moderatorDecision: { ...(input.moderatorDecision as object), plannerFailures: [local, invalid] } });
    const event = JSON.parse(log.mock.calls[0]![0]);
    expect(event.moderator.plannerFailures.map((failure: { code: string }) => failure.code)).toEqual(["lost_source_action", "invalid_schema"]);
    expect(JSON.stringify(event)).not.toContain("PRIVATE");
  });
});
