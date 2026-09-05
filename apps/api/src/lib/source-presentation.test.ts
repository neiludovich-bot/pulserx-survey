import { describe, expect, it } from "vitest";
import { presentationPlanSchema } from "../../../../packages/schemas/src/presentation";
import { requestsSimplerPresentation, sourcePresentationForTurn } from "./source-presentation";

describe("source presentation budgets", () => {
  const priorAnswer = `${Array(70).fill("word").join(" ")} [1]`;
  it("prevents the observed70-word answer from becoming a92-word simplification", () => {
    const plan = sourcePresentationForTurn(undefined, "Can you explain that more simply?", [{ role: "interviewer", content: priorAnswer }]);
    expect(presentationPlanSchema.parse(plan)).toMatchObject({ depth: "brief", maxFacts: 2, maxTopics: 1, maxWords: 60 });
  });
  it("narrows the next clarification to one point and at most40 words", () => {
    expect(sourcePresentationForTurn(undefined, "Even more simply please.", [
      { role: "participant", content: "Can you explain that more simply?" },
      { role: "interviewer", content: `${Array(58).fill("word").join(" ")} [2]` },
    ])).toMatchObject({ maxFacts: 1, maxWords: 40 });
  });
  it("does not count the current message included in recent history as an earlier request", () => {
    expect(sourcePresentationForTurn(undefined, "Can you explain that more simply?", [
      { role: "interviewer", content: priorAnswer }, { role: "participant", content: "Can you explain that more simply?" },
    ])?.maxWords).toBe(60);
  });
  it("uses the successful cited answer rather than a later unavailable-answer message", () => {
    expect(sourcePresentationForTurn(undefined, "Explain that in simple terms.", [
      { role: "interviewer", content: priorAnswer }, { role: "interviewer", content: "I couldn't retrieve that information." },
    ])?.maxWords).toBe(60);
  });
  it("shortens an already concise answer instead of growing toward a target", () => {
    expect(sourcePresentationForTurn(undefined, "Please simplify that.", [{ role: "interviewer", content: `${Array(35).fill("word").join(" ")} [1]` }])?.maxWords).toBe(25);
  });
  it("does not treat a clinical question about simpler dosing as a style instruction", () => {
    expect(requestsSimplerPresentation("Does a simpler dosing schedule affect adherence?")).toBe(false);
    expect(sourcePresentationForTurn(undefined, "What should I monitor?")).toBeUndefined();
  });
  it("keeps prior contracts valid while rejecting invalid budgets", () => {
    const plan = { version: 1, purpose: "source_answer", depth: "standard", maxFacts: 4, maxTopics: 2, askReadiness: false };
    expect(presentationPlanSchema.safeParse(plan).success).toBe(true);
    expect(presentationPlanSchema.safeParse({ ...plan, maxWords: 19 }).success).toBe(false);
  });
});
