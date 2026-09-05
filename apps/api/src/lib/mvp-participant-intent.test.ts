import { describe, expect, it } from "vitest";
import { interpretMvpParticipantIntent } from "./mvp-participant-intent";

const context = {
  currentQuestionId: "decision_framework",
  currentQuestion: "What are the top factors that matter most when you evaluate treatment?",
  currentQuestionObjective: "Capture decision drivers before presenting evidence.",
  currentQuestionKeywords: ["efficacy", "survival"],
  currentQuestionCompletionSignals: ["decision factors are stated"],
};

describe("participant answer and information-request interpretation", () => {
  it.each([
    "So someone on those medications are at risk for what adverse reactions",
    "Those patients are at risk for which complications",
    "These medicines interact with which treatments",
  ])("recognizes a trailing information question without punctuation: %s", (question) => {
    const reaction = "It's something that I need to track but not terribly concerning.";
    expect(interpretMvpParticipantIntent({ ...context, participantContent: `${reaction}  ${question}` })).toEqual({
      answerStatus: "answered", asksSourceQuestion: true, answerEvidence: [reaction],
    });
    expect(interpretMvpParticipantIntent({ ...context, participantContent: question })).toEqual({
      answerStatus: "not_answered", asksSourceQuestion: true, answerEvidence: [],
    });
  });
  it.each([
    "I know which medications need monitoring",
    "It depends on which regimen we choose",
    "Those patients are concerned about what the study showed",
    "This is what I need for my assessment",
    "I look for what works best in my practice",
  ])("does not turn a declarative relative clause into a question: %s", (participantContent) => {
    expect(interpretMvpParticipantIntent({ ...context, participantContent }).asksSourceQuestion).toBe(false);
  });
  it.each(["PFS and DDI", "toxicity", "cost and convenience", "quality of life", "I would use it"])("credits a contextual answer without requesting source evidence: %s", (participantContent) => {
    expect(interpretMvpParticipantIntent({ ...context, participantContent })).toEqual({
      answerStatus: "answered", asksSourceQuestion: false, answerEvidence: [participantContent],
    });
  });

  it.each(["What is PFS?", "Tell me about DDI", "What is DDI?", "What drug interactions should I consider?", "Show me the source link for drug interactions", "Well what are the known drug drug interactions", "I'd like to know about interactions", "Well, what is PFS"])("does not credit a source request as a research answer: %s", (participantContent) => {
    expect(interpretMvpParticipantIntent({ ...context, participantContent })).toEqual({
      answerStatus: "not_answered", asksSourceQuestion: true, answerEvidence: [],
    });
  });

  it.each([
    ["PFS and DDI. What is the interaction guidance?", "PFS and DDI."],
    ["PFS and DDI; what drug interactions should I consider?", "PFS and DDI"],
    ["Cost and convenience, but tell me about dosing", "Cost and convenience"],
    ["Toxicity and what did the study show?", "Toxicity"],
  ])("retains only the answer portion of a mixed turn: %s", (participantContent, evidence) => {
    const intent = interpretMvpParticipantIntent({ ...context, participantContent });
    expect(intent).toEqual({ answerStatus: "answered", asksSourceQuestion: true, answerEvidence: [evidence] });
    for (const excerpt of intent.answerEvidence) expect(participantContent).toContain(excerpt);
  });

  it("does not credit an acknowledgement or an answer without a current research question", () => {
    expect(interpretMvpParticipantIntent({ ...context, participantContent: "Thanks" }).answerStatus).toBe("not_answered");
    expect(interpretMvpParticipantIntent({ participantContent: "PFS and DDI" }).answerEvidence).toEqual([]);
  });

  it("retains short numeric answers and explicit uncertainty", () => {
    expect(interpretMvpParticipantIntent({ currentQuestion: "How many patients do you see?", participantContent: "5 to 10" }).answerStatus).toBe("answered");
    expect(interpretMvpParticipantIntent({ ...context, participantContent: "Not sure" })).toEqual({ answerStatus: "partial", asksSourceQuestion: false, answerEvidence: ["Not sure"] });
  });

  it.each([
    "What would help is a checklist or guide the nurses can use for call-ins and triage.",
    "What matters most is PFS",
    "What I need is practical guidance",
    "What we would need is a clear workflow",
  ])("recognizes declarative what clauses as answers: %s", (participantContent) => {
    expect(interpretMvpParticipantIntent({
      currentQuestion: "What is the hardest management decision in practice?",
      participantContent,
    })).toEqual({ answerStatus: "answered", asksSourceQuestion: false, answerEvidence: [participantContent] });
  });

  it.each(["What would help?", "What matters most?", "What do I need for safe dosing?", "What would help with triage"])("still treats real what questions as information requests: %s", (participantContent) => {
    expect(interpretMvpParticipantIntent({ ...context, participantContent })).toEqual({ answerStatus: "not_answered", asksSourceQuestion: true, answerEvidence: [] });
  });
});
