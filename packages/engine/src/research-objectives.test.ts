import { describe, expect, it, vi } from "vitest";
vi.mock("@interview/schemas", async () => import("../../schemas/src/index"));
import { researchPlanStateSchema, type ConversationObservation } from "@interview/schemas";
import { updateResearchCoverage, selectObjectiveFollowUp } from "./research-objectives";
const plan = () => researchPlanStateSchema.parse({ version: 1, turn: 0, objectives: ["evidence", "safety"].map(id => ({
  id, module: id, objective: `Understand ${id}`, questionIds: [id], transition: "Next topic.",
  criteria: [{ id: "view", description: "Their view", followUp: "What do you think?" }, { id: "reason", description: "Their reason", followUp: "What leads you to that view?" }],
  status: "uncovered", evidence: [], followUpsAsked: 0,
})) });
const observation = (researchSignals: ConversationObservation["researchSignals"]): ConversationObservation => ({ answerStatus: "answered", answerEvidence: [], reactionEvidence: [], researchSignals, request: null, priorities: [], familiarity: null, familiarityEvidence: null, outOfScope: false });
describe("objective coverage", () => {
  it("does not count the same opinion twice as its own reason, regardless of signal order", () => {
    const state = plan(); state.objectives[0].criteria[0].id = "perspective";
    const signals = [{ objectiveId: "evidence", criterionId: "reason", evidence: "This breadth seems useful" }, { objectiveId: "evidence", criterionId: "perspective", evidence: "This breadth seems useful" }];
    for (const values of [signals, [...signals].reverse()]) {
      const next = updateResearchCoverage(state, observation(values), "This breadth seems useful");
      expect(next.objectives[0].status).toBe("partial");
      expect(next.objectives[0].evidence.map(item => item.criterionId)).toEqual(["perspective"]);
    }
  });
  it("credits a later module from volunteered evidence and selects only the missing reason", () => {
    const original = plan();
    const next = updateResearchCoverage(original, observation([{ objectiveId: "safety", criterionId: "view", evidence: "Safety seems manageable" }]), "Safety seems manageable");
    expect(next.objectives[1].status).toBe("partial");
    expect(next.objectives[0].status).toBe("uncovered");
    expect(selectObjectiveFollowUp(next, "safety")?.criterion.id).toBe("reason");
    expect(original.objectives[1].evidence).toEqual([]);
    const complete = updateResearchCoverage(next, observation([{ objectiveId: "safety", criterionId: "reason", evidence: "Our clinic already monitors this" }]), "Our clinic already monitors this");
    expect(complete.objectives[1].status).toBe("covered");
    expect(complete.objectives[1].evidence.map(item => item.turn)).toEqual([1, 2]);
    expect(selectObjectiveFollowUp(complete, "safety")).toBeNull();
  });
  it("does not count a medical question or navigation as completed research", () => {
    const obs = observation([{ objectiveId: "safety", criterionId: "view", evidence: "What are the side effects?" }]);
    obs.request = { text: "Side effects", evidence: "What are the side effects?" };
    expect(updateResearchCoverage(plan(), obs, obs.request.evidence).objectives[1].status).toBe("uncovered");
    expect(updateResearchCoverage(plan(), null, "continue").objectives.every(item => item.status === "uncovered")).toBe(true);
  });
  it("bounds follow-ups and preserves unresolved objectives through serialization", () => {
    const state = plan(); state.objectives[0].status = "partial"; state.objectives[0].followUpsAsked = 1;
    const reloaded = researchPlanStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(selectObjectiveFollowUp(reloaded, "objective-probe:evidence")).toBeNull();
    expect(reloaded.objectives[0].status).toBe("partial");
  });
  it("rejects invented evidence and unknown criteria", () => {
    expect(() => updateResearchCoverage(plan(), observation([{ objectiveId: "safety", criterionId: "view", evidence: "invented" }]), "actual")).toThrow("current-message");
    expect(() => updateResearchCoverage(plan(), observation([{ objectiveId: "safety", criterionId: "unknown", evidence: "actual" }]), "actual")).toThrow("Unknown");
  });
});
