import type { MvpCustomGptSurveyStartRequest } from "@interview/schemas";

/** Applied only at creation; restored sessions keep their persisted runtime. */
export function conversationRuntimeForNewSession(
  surveySlug: string,
  requested: MvpCustomGptSurveyStartRequest["conversationRuntime"],
  environment: { NODE_ENV: string; MVP_CONVERSATION_RUNTIME?: "current" | "conversation_v2" },
) {
  if (!["nubeqa", "brukinsa", "padcev"].includes(surveySlug)) return "current" as const;
  return requested ?? environment.MVP_CONVERSATION_RUNTIME ?? (environment.NODE_ENV === "production" ? "conversation_v2" : "current");
}
