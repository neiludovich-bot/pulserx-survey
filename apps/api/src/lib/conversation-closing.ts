import type { ConversationState } from "@interview/schemas";

/** Recap recorded topics and verbatim views; never synthesize new medical advice. */
export function conversationRecap(state: ConversationState) {
  const topics = [...new Set(state.coveredTopics)];
  const views = [...new Set(state.research?.objectives.flatMap(objective =>
    objective.evidence.filter(item => item.criterionId === "perspective").map(item => item.evidence),
  ) ?? [])].slice(0, 3);
  const sections = ["Thank you for sharing your perspective."];
  if (topics.length) sections.push(`A brief recap of what we covered:\n${topics.slice(0, 8).map(topic => `• ${topic}`).join("\n")}${topics.length > 8 ? "\n• Additional topics are recorded in the conversation above." : ""}`);
  if (views.length) sections.push(`You shared these views:\n${views.map(view => `• “${view.length > 300 ? `${view.slice(0, 300)}…` : view}”`).join("\n")}`);
  if (!topics.length && !views.length) sections.push("We didn't cover any substantive discussion topics before ending.");
  sections.push("That completes the interview.");
  return sections.join("\n\n");
}
