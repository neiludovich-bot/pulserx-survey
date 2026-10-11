import { describe, expect, it } from "vitest";
import { NUBEQA_TRAINER as program } from "./nubeqa-objections";
import { advance, createTrainerSession, currentObjection, recordAttempt, scorecard, TrainerError } from "./session";

const t = (s = 0) => new Date(Date.UTC(2026, 9, 11, 22, 0, s));
const result = (score: number, flags = 0) => ({
  criteria: [], compliance: Array.from({ length: flags }, () => ({ issue: "comparative_claim", quote: "better than", explanation: "No head-to-head data." })),
  score, strengths: [], improvements: [], hcpReaction: "Okay.",
});

describe("objection trainer session", () => {
  it("every objection has acknowledgment, evidence criteria, a model answer and a figure", () => {
    for (const objection of program.objections) {
      expect(objection.criteria[0]!.id).toBe("acknowledge");
      expect(objection.criteria.length).toBeGreaterThan(2);
      expect(objection.modelAnswer.length).toBeGreaterThan(100);
      expect(objection.figures.length).toBeGreaterThan(0);
    }
  });

  it("deals a reproducible round of distinct objections", () => {
    const a = createTrainerSession(program, "s1", "Jane Rep", null, t());
    expect(createTrainerSession(program, "s1", "Jane Rep", null, t()).order).toEqual(a.order);
    expect(a.order).toHaveLength(program.roundSize);
    expect(new Set(a.order).size).toBe(program.roundSize);
  });

  it("records attempts, allows a retry, and summarises best scores", () => {
    const state = createTrainerSession(program, "s2", "Jane Rep", "East", t());
    const first = currentObjection(program, state)!.id;
    recordAttempt(program, state, { reply: "It's better than enzalutamide.", source: "text", result: result(2, 1), now: t(30) });
    expect(state.phase).toBe("feedback");
    expect(() => recordAttempt(program, state, { reply: "again", source: "text", result: result(3), now: t(31) })).toThrow(TrainerError);
    advance(state, "retry", t(40));
    recordAttempt(program, state, { reply: "Improved answer", source: "voice", result: result(4), now: t(90) });
    advance(state, "next", t(100));
    expect(currentObjection(program, state)!.id).not.toBe(first);
    advance(state, "finish", t(110));
    expect(state.phase).toBe("complete");
    const card = scorecard(program, state);
    expect(card.rows).toEqual([{ id: first, title: card.rows[0]!.title, first: 2, best: 4, attempts: 2, complianceFlags: 1 }]);
    expect(card.average).toBe(4);
  });
});
