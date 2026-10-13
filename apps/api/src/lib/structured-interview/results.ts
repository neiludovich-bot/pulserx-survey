import { questionById } from "./engine";
import type { StoredInterview } from "./store";
import type { StructuredSurvey } from "./types";

const csvCell = (value: unknown) => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const minutesBetween = (start: string, end: string | null) =>
  end ? Math.round(((Date.parse(end) - Date.parse(start)) / 60000) * 10) / 10 : null;

/** One row per interview; per question: chosen labels, how answered, verbatim, follow-up, seconds to answer. */
export function interviewsToCsv(survey: StructuredSurvey, interviews: StoredInterview[]) {
  const header = ["session_id", "started_at", "completed_at", "end_reason", "minutes", "card_order", "detour_count", "detour_questions"];
  for (const q of survey.questions) {
    header.push(`${q.id}`, `${q.id}_how`, `${q.id}_verbatim`, `${q.id}_follow_up`, `${q.id}_seconds`);
  }
  const rows = interviews.map(({ state }) => {
    const row: unknown[] = [state.sessionId, state.startedAt, state.completedAt, state.endReason ?? "in_progress",
      minutesBetween(state.startedAt, state.completedAt),
      state.order.filter(id => survey.rotationBlocks.some(block => block.includes(id))).join(" > "),
      state.detours.length, state.detours.map(d => d.question).join(" | ")];
    for (const q of survey.questions) {
      const answer = state.answers[q.id];
      if (!answer) { row.push("", "", "", "", ""); continue; }
      row.push(answer.optionIds.map(id => q.options.find(o => o.id === id)?.label ?? id).join("; "),
        answer.inferred ? `${answer.source} (interpreted)` : answer.source,
        answer.verbatim, answer.followUp?.response ?? (answer.followUp?.skipped ? "(skipped)" : ""),
        Math.round((Date.parse(answer.answeredAt) - Date.parse(answer.presentedAt)) / 1000));
    }
    return row;
  });
  return [header, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
}

export type QuestionSummary = {
  id: string; section: string; prompt: string; label: string; kind: "single" | "multi" | "rank"; responses: number;
  /** For rank questions: count = times ranked first, share = average position as a fraction (0 = always first). */
  options: Array<{ id: string; label: string; count: number; share: number; averageRank?: number }>;
  verbatims: Array<{ sessionId: string; optionLabels: string; text: string }>;
};

/** Counts per option and every verbatim, for the results page. */
export function summarize(survey: StructuredSurvey, interviews: StoredInterview[]) {
  const consented = interviews.filter(i => i.state.answers.a0_consent?.optionIds.includes("yes") ?? true);
  const questions: QuestionSummary[] = survey.questions.filter(q => q.id !== "a0_consent").map(q => {
    const answers = consented.map(i => ({ sessionId: i.state.sessionId, answer: i.state.answers[q.id] })).filter(a => a.answer);
    const total = answers.length;
    return {
      id: q.id, section: q.section, prompt: q.prompt, label: q.exportLabel, kind: q.kind, responses: total,
      options: q.options.map(o => {
        if (q.kind === "rank") {
          const positions = answers.map(a => a.answer!.optionIds.indexOf(o.id)).filter(i => i >= 0);
          const averageRank = positions.length ? Math.round((positions.reduce((sum, i) => sum + i + 1, 0) / positions.length) * 10) / 10 : undefined;
          const count = positions.filter(i => i === 0).length;
          return { id: o.id, label: o.label, count, share: averageRank ? 1 - (averageRank - 1) / Math.max(1, q.options.length - 1) : 0, averageRank };
        }
        const count = answers.filter(a => a.answer!.optionIds.includes(o.id)).length;
        return { id: o.id, label: o.label, count, share: total ? count / total : 0 };
      }).sort((a, b) => (q.kind === "rank" ? (a.averageRank ?? 99) - (b.averageRank ?? 99) : 0)),
      verbatims: answers.flatMap(a => {
        const text = [a.answer!.verbatim, a.answer!.followUp?.response].filter(Boolean).join(" — ");
        return text ? [{ sessionId: a.sessionId, optionLabels: a.answer!.optionIds.map(id => questionById(survey, q.id).options.find(o => o.id === id)?.label ?? id).join("; "), text }] : [];
      }),
    };
  });
  const completed = interviews.filter(i => i.state.endReason === "completed");
  const durations = completed.map(i => minutesBetween(i.state.startedAt, i.state.completedAt)!).sort((a, b) => a - b);
  return {
    surveySlug: survey.slug, title: survey.title, surveyVersion: survey.version,
    totals: { started: interviews.length, completed: completed.length,
      declined: interviews.filter(i => i.state.endReason === "declined").length,
      stopped: interviews.filter(i => i.state.endReason === "stopped").length,
      medianMinutes: durations.length ? durations[Math.floor(durations.length / 2)]! : null },
    detours: interviews.flatMap(i => i.state.detours.map(d => ({ sessionId: i.state.sessionId, questionId: d.questionId, question: d.question, answered: d.answered }))),
    questions,
  };
}
