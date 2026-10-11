import { describe, expect, it } from "vitest";
import {
  canAnswerDetour, createInterview, currentQuestion, followUpFor, orderedOptions, recordAnswer, recordDetour, recordFollowUp,
  markClarifying, questionById, questionView, SelectionError, skipOpenDetour,
} from "./engine";
import { NUBEQA_STRUCTURED_SURVEY as survey } from "./nubeqa";
import { interviewsToCsv, summarize } from "./results";
import { matchFigures } from "./nubeqa-figures";

const t = (seconds = 0) => new Date(Date.UTC(2026, 9, 11, 14, 0, seconds));
const tap = (state: ReturnType<typeof createInterview>, optionIds: string[], verbatim: string | null = null) =>
  recordAnswer(survey, state, { optionIds, verbatim, source: "tap", inferred: false, givesReason: Boolean(verbatim), now: t(5) });

/** Answer every question with its first option, skipping all follow-ups. */
function runThrough(sessionId: string) {
  const state = createInterview(survey, sessionId, t());
  for (let guard = 0; guard < 60 && state.phase !== "complete" && state.phase !== "declined"; guard++) {
    if (state.phase === "follow_up") { recordFollowUp(state, { text: null, source: "tap", now: t(9) }); continue; }
    if (state.phase === "detour_open") { skipOpenDetour(state, t(9)); continue; }
    const q = currentQuestion(survey, state)!;
    const first = orderedOptions(q, state).find(o => !o.ends)!;
    tap(state, [first.id]);
  }
  return state;
}

describe("figure library", () => {
  it("matches figures by trial and topic, not by stray substrings", () => {
    expect(matchFigures("What were the ARASENS results for time to castration resistance?")[0]!.id).toBe("arasens-crpc");
    expect(matchFigures("What are the most common side effects in ARAMIS?").map(f => f.id)).toContain("aramis-ae");
    expect(matchFigures("What are the most common side effects in ARAMIS?", 5).every(f => f.trial === "aramis" || f.trial === null)).toBe(true);
    expect(matchFigures("Does it interact with warfarin?").map(f => f.id)).toContain("ddi-anticoagulants");
    expect(matchFigures("How do I dose it?").map(f => f.trial)).not.toContain("arasens");
    expect(matchFigures("Thanks, that makes sense")).toHaveLength(0);
  });

  it("every evidence card shows several figures with captions", () => {
    for (const q of survey.questions.filter(q => q.card && q.id.startsWith("c"))) {
      expect(q.card!.figures.length).toBeGreaterThan(3);
      for (const figure of q.card!.figures) expect(Boolean(figure.caption)).toBe(true);
    }
  });
});

describe("structured interview engine", () => {
  it("has unique ids and every rotation id exists", () => {
    const ids = survey.questions.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const block of survey.rotationBlocks) for (const id of block) expect(ids).toContain(id);
  });

  it("is reproducible per session and rotates the evidence cards across sessions", () => {
    const a = createInterview(survey, "session-a", t());
    expect(createInterview(survey, "session-a", t()).order).toEqual(a.order);
    const orders = new Set(Array.from({ length: 40 }, (_, i) => createInterview(survey, `s${i}`, t()).order.slice(5, 8).join(",")));
    expect(orders.size).toBeGreaterThan(3);
    // Cards stay inside their block's slots.
    expect(a.order.slice(0, 5)).toEqual(["a0_consent", "a1_specialty", "a2_volume", "a3_experience", "b1_drivers"]);
    expect(a.order.slice(8)).toEqual(survey.questions.slice(8).map(q => q.id));
  });

  it("keeps anchored options in place when shuffling", () => {
    for (let i = 0; i < 20; i++) {
      const state = createInterview(survey, `anchor${i}`, t());
      const q = questionById(survey, "b1_drivers");
      expect(orderedOptions(q, state).at(-1)!.id).toBe("other");
      expect(new Set(state.optionOrder.b1_drivers)).toEqual(new Set(q.options.map(o => o.id)));
    }
  });

  it("orders the most-relevant-trial options to match the rotated cards", () => {
    const state = createInterview(survey, "follow-rotation", t());
    const cardOrder = state.order.slice(5, 8).map(id => questionById(survey, id).card!.id);
    expect(state.optionOrder.c4_most_relevant!.slice(0, 3)).toEqual(cardOrder);
    expect(state.optionOrder.c4_most_relevant!.at(-1)).toBe("none");
  });

  it("ends politely when consent is declined", () => {
    const state = createInterview(survey, "decline", t());
    expect(tap(state, ["no"]).kind).toBe("ended");
    expect(state.phase).toBe("declined");
    expect(state.endReason).toBe("declined");
  });

  it("asks one follow-up after a bare tap on a reaction, none when they explained", () => {
    const state = runToCard("probe");
    expect(tap(state, ["concerns"])).toEqual({ kind: "follow_up", prompt: "What is your main doubt?" });
    recordFollowUp(state, { text: "Follow-up was short.", source: "text", now: t(20) });
    expect(state.phase).toBe("question");
    expect(Object.values(state.answers).find(a => a.optionIds.includes("concerns"))!.followUp!.response).toBe("Follow-up was short.");
    expect(tap(state, ["no_change"], "Same as other ARPIs in my experience").kind).toBe("advanced");
  });

  it("captures specifics for Other even when multi-select has several picks", () => {
    const q = questionById(survey, "b1_drivers");
    expect(followUpFor(q, ["os", "other"], false)).toBe("What else matters most to you?");
    expect(followUpFor(q, ["os", "ddi"], false)).toBeNull();
    expect(followUpFor(q, ["os"], false)).toBe("What makes that the deciding factor for you?");
  });

  it("narrates each trial and leads into new sections once", () => {
    const state = runToCard("narration");
    const view = questionView(survey, state)!;
    expect(view.narration!.startsWith("Now let's look at the evidence.")).toBe(true);
    expect(view.narration!.includes(questionById(survey, view.id).intro!)).toBe(true);
    tap(state, ["no_change"], "As expected");
    const next = questionView(survey, state)!;
    const intro = questionById(survey, next.id).intro;
    expect(survey.acknowledgments.some(ack => next.narration!.startsWith(ack))).toBe(true);
    expect(intro ? next.narration!.endsWith(intro) : true).toBe(true);
  });

  it("validates selections", () => {
    const state = createInterview(survey, "validate", t());
    expect(() => tap(state, ["made-up"])).toThrow(SelectionError);
    expect(() => tap(state, ["yes", "no"])).toThrow(SelectionError);
    tap(state, ["yes"]);
    tap(state, ["urology"]); tap(state, ["5_15"]); tap(state, ["regular"]);
    expect(() => tap(state, ["os", "ddi", "dosing", "access"])).toThrow("Choose up to 3.");
  });

  it("an exclusive option clears the others", () => {
    const state = createInterview(survey, "exclusive", t());
    state.index = state.order.indexOf("d2_patient_fit");
    tap(state, ["older_frail", "none"]);
    expect(state.answers.d2_patient_fit!.optionIds).toEqual(["none"]);
  });

  it("answers a few side questions per question, then parks further ones", () => {
    const state = createInterview(survey, "detour", t());
    for (let i = 0; i < survey.maxDetoursPerQuestion; i++) {
      expect(canAnswerDetour(survey, state)).toBe(true);
      recordDetour(state, { question: `Question ${i}?`, answer: i === 1 ? null : "Answer.", sourceIds: [], parked: false, now: t(3) });
    }
    expect(canAnswerDetour(survey, state)).toBe(false);
    expect(state.index).toBe(0);
    expect(state.phase).toBe("question");
  });

  it("keeps an unmapped answer's words for the confirming tap", () => {
    const state = createInterview(survey, "clarify", t());
    tap(state, ["yes"]);
    markClarifying(state, "mostly GU med onc these days");
    tap(state, ["medical_oncology"]);
    expect(state.answers.a1_specialty!.verbatim).toBe("mostly GU med onc these days");
    expect(state.answers.a1_specialty!.followUp).toBeNull();
  });

  it("the closing 'yes, I have a question' opens a detour that ends the interview once answered", () => {
    const state = createInterview(survey, "closing", t());
    state.index = state.order.indexOf("e3_open_questions");
    expect(tap(state, ["yes"]).kind).toBe("detour_open");
    expect(canAnswerDetour(survey, state)).toBe(true);
    recordDetour(state, { question: "Any data in older men?", answer: "…", sourceIds: [], parked: false, now: t(30) });
    expect(state.phase).toBe("complete");
    expect(state.answers.e3_open_questions!.verbatim).toBe("Any data in older men?");
  });

  it("completes a full run and exports one CSV row per interview", () => {
    const runs = ["r1", "r2", "r3"].map(runThrough);
    for (const state of runs) {
      expect(state.phase).toBe("complete");
      expect(Object.keys(state.answers)).toHaveLength(survey.questions.length);
    }
    const csv = interviewsToCsv(survey, runs.map(state => ({ state, messages: [] })));
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]!.split(",").length).toBe(8 + survey.questions.length * 5);
    const summary = summarize(survey, runs.map(state => ({ state, messages: [] })));
    expect(summary.totals.completed).toBe(3);
    expect(summary.questions.find(q => q.id === "a1_specialty")!.responses).toBe(3);
  });
});

function runToCard(sessionId: string) {
  const state = createInterview(survey, sessionId, t());
  tap(state, ["yes"]); tap(state, ["urology"]); tap(state, ["5_15"]); tap(state, ["regular"]);
  tap(state, ["os", "ddi"]);
  expect(currentQuestion(survey, state)!.card).toBeTruthy();
  return state;
}
