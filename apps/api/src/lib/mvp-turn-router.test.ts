import { describe, expect, it } from "vitest";
import { classifyMvpTurnRoute } from "./mvp-turn-router";

describe("MVP turn router", () => {
  it("routes PADCEV EV-302 response questions as side-lane source excursions", () => {
    const decision = classifyMvpTurnRoute({
      surveySlug: "padcev",
      activeIntentSlug: "side-effect-management",
      participantContent:
        "What did EV-302 show for response rate and complete response?",
      currentQuestion:
        "Which safety or tolerability details most influence comfort?",
      selectedQuestionText:
        "When a PADCEV adverse event emerges, what guidance would help?",
      selectedQuestionSourceContext:
        "Retrieve PADCEV safety-management resources.",
    });

    expect(decision.kind).toBe("off_lane_excursion");
    expect(decision.topic).toBe("padcev_ev302_response");
    expect(decision.needsSource).toBe(true);
    expect(decision.sourceDirective).toContain("EV-302");
  });

  it("routes PADCEV neuropathy questions to safety-management source context", () => {
    const decision = classifyMvpTurnRoute({
      surveySlug: "padcev",
      activeIntentSlug: "side-effect-management",
      participantContent:
        "How should I think about neuropathy risk with PADCEV?",
      selectedQuestionText:
        "Which safety or tolerability details most influence comfort?",
    });

    expect(decision.kind).toBe("in_lane_topic");
    expect(decision.topic).toBe("padcev_neuropathy_management");
    expect(decision.needsSource).toBe(true);
    expect(decision.isUnanticipated).toBe(false);
  });

  it("keeps unknown in-domain PADCEV source questions answerable", () => {
    const decision = classifyMvpTurnRoute({
      surveySlug: "padcev",
      activeIntentSlug: "side-effect-management",
      participantContent:
        "What do the approved materials say about coordinating this with clinic staffing?",
      selectedQuestionText: "What implementation barriers would still matter?",
    });

    expect(decision.kind).toBe("unknown_in_domain");
    expect(decision.topic).toBe("unknown_in_domain");
    expect(decision.needsSource).toBe(true);
    expect(decision.isUnanticipated).toBe(true);
  });

  it("does not send clearly out-of-scope questions to the source provider", () => {
    const decision = classifyMvpTurnRoute({
      surveySlug: "padcev",
      activeIntentSlug: "side-effect-management",
      participantContent: "What is the weather in Chicago tomorrow?",
      selectedQuestionText:
        "Which safety or tolerability details most influence comfort?",
    });

    expect(decision.kind).toBe("out_of_scope");
    expect(decision.needsSource).toBe(false);
    expect(decision.isOutOfScope).toBe(true);
  });

  it("routes BRUKINSA SEQUOIA questions without PADCEV-specific concepts", () => {
    const decision = classifyMvpTurnRoute({
      surveySlug: "brukinsa",
      activeIntentSlug: "cll-evidence",
      participantContent: "What did SEQUOIA show in first-line CLL?",
      selectedQuestionText:
        "How does the SEQUOIA evidence affect your view of BRUKINSA?",
    });

    expect(decision.kind).toBe("in_lane_topic");
    expect(decision.topic).toBe("brukinsa_cll_sequoia");
    expect(decision.sourceDirective).toContain("BRUKINSA");
    expect(decision.sourceDirective).not.toContain("EV-302");
  });
});
