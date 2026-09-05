import type { PresentationPlan } from "@interview/schemas";

type Turn = { role: "participant" | "interviewer"; content: string };

// This recognizes an explicit presentation instruction, never clinical intent.
export function requestsSimplerPresentation(message: string) {
  const text = message.trim();
  return /\b(?:simplify|shorten|summari[sz]e)\s+(?:that|this|it|the (?:answer|explanation))\b/i.test(text)
    || /\b(?:explain|say|put|make|describe|keep)\b[\s\S]{0,200}\b(?:more\s+simply|simpler|simple terms|plain (?:english|language)|shorter|brief(?:ly)?|less detail)\b/i.test(text)
    || /^(?:(?:even|please|a bit)\s+)*(?:more\s+)?(?:simply|simpler|briefly|shorter|plain english|plain language)(?:\s+please)?[.!?]*$/i.test(text)
    || /^(?:please\s+)?(?:simplify|shorten|summari[sz]e)(?:\s+please)?[.!?]*$/i.test(text);
}

export function sourcePresentationForTurn(plan: PresentationPlan | undefined, message: string, recentTurns: Turn[] = []): PresentationPlan | undefined {
  if (!requestsSimplerPresentation(message)) return plan;
  const history = [...recentTurns];
  if (history.at(-1)?.role === "participant" && history.at(-1)?.content.trim() === message.trim()) history.pop();
  const previousParticipant = [...history].reverse().find((turn) => turn.role === "participant");
  const repeated = /\beven (?:more )?(?:simply|simpler|shorter|briefly)\b/i.test(message)
    || Boolean(previousParticipant && requestsSimplerPresentation(previousParticipant.content));
  // A failed answer has no citations. Measure the last successful explanation,
  // not a service-error sentence or a newly selected research question.
  const previousAnswer = [...history].reverse().find((turn) => turn.role === "interviewer" && /\[\d+\]/.test(turn.content));
  const previousWords = previousAnswer?.content.replace(/\[\d+\]/g, "").trim().split(/\s+/).length;
  const maxWords = Math.min(repeated ? 40 : 60, plan?.maxWords ?? 500, previousWords ? Math.max(20, previousWords - 10) : 500);
  return { version: 1, purpose: plan?.purpose ?? "source_answer", depth: "brief", maxFacts: repeated ? 1 : 2, maxTopics: 1, maxWords, askReadiness: plan?.askReadiness ?? false };
}
