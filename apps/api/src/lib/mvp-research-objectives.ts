import { researchPlanStateSchema, type ResearchObjective } from "@interview/schemas";
import type { MvpGuideQuestion } from "./mvp-brukinsa-guide";

/** Authored research purposes, separate from the question used to open a module. */
export function researchPlanForGuide(guide: MvpGuideQuestion[]) {
  return researchPlanStateSchema.parse({ version: 1, turn: 0, objectives: guide
    .filter(question => question.id !== "intro_consent")
    .map(question => {
      const intake = ["role", "practice_setting", "uc_involvement", "disease_involvement", "primary_disease_focus", "patient_volume", "familiarity", "disease_focus", "disease_area", "practice_context"].includes(question.id);
      const closing = question.close || ["close", "safety_close"].includes(question.id);
      const priority = ["decision_framework", "btki_decision_framework"].includes(question.id);
      const safety = /safety|dosing|medication|support|resources|barrier/.test(question.id);
      const fit = /patient_fit|patient_caution|positioning|behavioral/.test(question.id);
      const objective: ResearchObjective = {
        id: question.id, questionIds: [question.id],
        module: intake || priority ? "Familiarity and context" : closing ? "Remaining needs" : safety ? "Safety and practicality" : fit ? "Patient fit" : "Evidence reaction",
        objective: closing ? "Identify the participant's remaining questions or information needs, including an explicit statement that none remain."
          : `${question.objective}${intake ? "" : " Understand their own view and the reason or practical implication behind it; positive, negative, mixed and no-change reactions are equally valid."}`,
        criteria: intake || closing || priority ? [{ id: "perspective", description: closing ? "An explicit remaining information need or statement that no questions remain." : priority ? "The participant names the factors that matter in their own decision-making, not merely topics they ask to learn about." : question.objective,
          followUp: closing ? "What, if anything, would you still want clarified?" : priority ? "Which consideration matters most to you, and why?" : "Could you tell me a little more about your experience?" }]
          : [
            { id: "perspective", description: "Their own view on this objective, tied to the particular study/setting where applicable. Not a generic acknowledgement or request for facts.", followUp: "What is your own take on that information?" },
            { id: "reason", description: "A concrete reason, uncertainty, example or practical implication supporting that view on this same objective. Do not infer a reason from sentiment alone.", followUp: "What about that leads you to that view?" },
          ],
        transition: closing ? "Before we finish, I'd like to understand what remains unresolved."
          : safety ? "I'd also like to understand what this means in day-to-day practice."
          : fit ? "Let's connect that with the patients you see."
          : intake || priority ? "To put your perspective in context:" : "Let's look at another part of the evidence and what you make of it.",
      };
      return { ...objective, status: "uncovered", evidence: [], followUpsAsked: 0 };
    }) });
}

export function objectiveOrientedGuide(guide: MvpGuideQuestion[], brand: string) {
  const questions: Record<string, string> = {
    patient_fit: `Where, if anywhere, do you see a role for ${brand} in your practice, and what shapes that view?`,
    overall: `After this discussion, what stands out most to you about ${brand}, and why?`,
    overall_perception: `After this discussion, what stands out most to you about ${brand}, and why?`,
    close: `What, if anything, would you still want clarified about ${brand}?`,
    safety_close: `What, if anything, remains unclear about the safety or practical use information for ${brand}?`,
  };
  return guide.map(question => question.id === "intro_consent" ? { ...question,
    canonicalQuestion: `We're interested in how you interpret the clinical evidence for ${brand}, what matters in your practice, and what questions remain. We'll cover a few topics, with room to explore what interests you. This is market research, not a test of knowledge; positive, negative and unchanged views are equally useful. Please don't include patient-identifying information. Is it okay to begin?`,
  } : { ...question, canonicalQuestion: questions[question.id] ?? question.canonicalQuestion });
}
