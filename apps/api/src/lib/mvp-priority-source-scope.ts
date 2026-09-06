import type { ModeratorPriority } from "@interview/schemas";

const words = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const bounded = (value: string, max: number) => {
  if (value.length <= max) return value;
  const prefix = value.slice(0, max);
  return prefix.slice(0, prefix.lastIndexOf(" ") > 0 ? prefix.lastIndexOf(" ") : max).trim();
};

export function prioritySourceLabel(priority: Pick<ModeratorPriority, "label" | "participantEvidence">) {
  const evidence = priority.participantEvidence.trim();
  const label = priority.label.trim();
  // A paraphrased/expanded label is not independently grounded. Use the actual
  // participant wording in that case, including any explicit clinical setting.
  return words(label) && ` ${words(evidence)} `.includes(` ${words(label)} `) ? label : bounded(evidence, 200);
}

/** Generated search wording cannot broaden the participant's selected priority. */
export function prioritySourceQuestion(priority: Pick<ModeratorPriority, "label" | "participantEvidence">, brand: string) {
  const evidence = priority.participantEvidence.trim();
  const topic = prioritySourceLabel(priority);
  const question = `What information about ${topic} is available for ${brand}?`;
  if (words(topic) === words(evidence)) return question;
  const prefix = `${question}\nSelected priority: ${topic}. Focus on this priority and preserve any explicit setting in the participant wording below; other mentioned priorities are separate.\nParticipant wording: `;
  // Full original evidence remains in canonical state and the turn history.
  return `${prefix}${bounded(evidence, 2000 - prefix.length)}`;
}
