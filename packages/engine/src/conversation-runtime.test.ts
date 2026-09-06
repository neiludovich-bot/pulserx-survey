import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
import { emptyConversationState, selectConversationAction, validateConversationObservation } from "./conversation-runtime";
import type { ConversationObservation, ConversationTurnContext } from "@interview/schemas";
const empty: ConversationObservation = { answerStatus: "not_answered", answerEvidence: [], reactionEvidence: [], request: null, priorities: [], familiarity: null, familiarityEvidence: null, outOfScope: false };
const context: ConversationTurnContext = { version: 2, brand: "fixture", participantMessage: "That sounds useful. How is it dosed?", question: { id: "reaction", text: "What is your reaction?", kind: "reaction" }, discussionQuery: "Study A", recentTurns: [], topics: [] };
describe("replacement conversation selection", () => {
  it("only accepts closing intent during final Q&A and lets a question override it", () => {
    const message = "No thanks";
    const closingResponse = { intent: "finish", evidence: message };
    expect(validateConversationObservation({ ...context, participantMessage: message }, { ...empty, closingResponse }).closingResponse).toBeNull();
    expect(validateConversationObservation({ ...context, closing: true, participantMessage: message }, { ...empty, closingResponse }).closingResponse?.intent).toBe("finish");
    expect(validateConversationObservation({ ...context, closing: true, participantMessage: "No thanks, but how is it dosed?" }, { ...empty, closingResponse, request: { text: "Dosing?", evidence: "how is it dosed?" } }).closingResponse).toBeNull();
    expect(() => validateConversationObservation({ ...context, closing: true, participantMessage: "Yes" }, { ...empty, closingResponse })).toThrow("current-message evidence");
  });
  it("accepts a simplification request as a response to a clarity check without clinical credit", () => {
    const message = "Can you explain that more simply?";
    const result = validateConversationObservation({ ...context, participantMessage: message, question: { id: "clarity", text: "Does that address your question?", kind: "clarification" } }, { ...empty, answerStatus: "partial", answerEvidence: [message], request: { text: "Explain the monitoring guidance more simply", evidence: message } });
    expect(result.request?.evidence).toBe(message); expect(result.reactionEvidence).toEqual([]);
  });
  it("does not count clarification satisfaction as a clinical reaction", () => {
    const state = emptyConversationState(); state.reactionPending = true;
    state.activeTopicId = "a"; state.topics = [{ id: "a", label: "efficacy", query: "efficacy", status: "presented", evidence: [] }];
    const result = selectConversationAction(state, { ...empty, answerStatus: "answered", answerEvidence: ["Yes, that answers it"] }, false, false);
    expect(result.action).toBe("ask_reaction"); expect(result.state.topics[0].status).toBe("presented"); expect(result.state.topics[0].evidence).toEqual([]);
  });
  it("captures a volunteered clinical reaction during clarification before answering a new question", () => {
    const state = emptyConversationState(); state.reactionPending = true;
    state.activeTopicId = "a"; state.topics = [{ id: "a", label: "efficacy", query: "efficacy", status: "presented", evidence: [] }];
    const result = selectConversationAction(state, { ...empty, reactionEvidence: ["That looks relevant"], request: { text: "Dosing?", evidence: "Dosing?" } }, false, true);
    expect(result.action).toBe("answer_request"); expect(result.state.topics[0].evidence).toEqual(["That looks relevant"]); expect(result.state.reactionPending).toBe(false);
  });
  it("retains a reaction and independently selects the follow-up request", () => {
    const observation = validateConversationObservation(context, { ...empty, answerStatus: "answered", answerEvidence: ["That sounds useful."], request: { text: "How is fixture dosed?", evidence: "How is it dosed?" } });
    const state = emptyConversationState();
    state.topics = [{ id: "a", label: "efficacy", query: "efficacy", status: "presented", evidence: [] }, { id: "b", label: "dosing", query: "dosing", status: "pending", evidence: [] }];
    state.activeTopicId = "a"; state.reactionPending = true;
    const result = selectConversationAction(state, observation, false);
    expect(result.action).toBe("answer_request");
    expect(result.state.topics[0]).toMatchObject({ status: "discussed", evidence: ["That sounds useful."] });
    expect(result.state.topics[1].status).toBe("pending");
    expect(state.topics[0].status).toBe("presented");
  });
  it("queues both named priorities in order, without marking either presented before delivery", () => {
    const result = selectConversationAction(emptyConversationState(), { ...empty, answerStatus: "answered", answerEvidence: ["PFS and DDI"], priorities: [{ label: "PFS", query: "PFS evidence", evidence: "PFS" }, { label: "DDI", query: "DDI evidence", evidence: "DDI" }] }, false);
    expect(result.action).toBe("present_topic");
    expect(result.state.topics.map(t => [t.label, t.status])).toEqual([["PFS", "pending"], ["DDI", "pending"]]);
    expect(result.state.activeTopicId).toBe("topic-1");
  });
  it("continue clears the discussion and skips remaining topics without inventing answers", () => {
    const state = emptyConversationState(); state.parkedGuideId = "fit";
    state.topics = [{ id: "a", label: "DDI", query: "DDI", status: "presented", evidence: [] }];
    state.discussion = { query: "DDI", lastAnswer: "A sourced answer", sourceIds: ["a"] }; state.reactionPending = true;
    const result = selectConversationAction(state, null, true);
    expect(result.action).toBe("resume_guide");
    expect(result.state).toMatchObject({ parkedGuideId: "fit", reactionPending: false, discussion: null });
    expect(result.state.topics[0]).toMatchObject({ status: "skipped", evidence: [] });
  });
  it("does not turn a question into research-answer credit", () => {
    const result = validateConversationObservation({ ...context, participantMessage: "How is it dosed?" }, { ...empty, answerStatus: "answered", answerEvidence: ["How is it dosed?"], request: { text: "How is it dosed?", evidence: "How is it dosed?" } });
    expect(result.answerEvidence).toEqual([]);
    expect(result.answerStatus).toBe("not_answered");
    expect(result.request?.text).toBe("How is it dosed?");
  });
  it.each(["old evidence", "That sounds useful. fabricated"])("rejects evidence absent from this message: %s", evidence => {
    expect(() => validateConversationObservation(context, { ...empty, answerStatus: "answered", answerEvidence: [evidence] })).toThrow("exact current-message");
  });
  it("does not infer an overview from low familiarity", () => {
    expect(selectConversationAction(emptyConversationState(), { ...empty, familiarity: "low", familiarityEvidence: "Not familiar" }, false).action).toBe("ask_information_need");
  });
});
