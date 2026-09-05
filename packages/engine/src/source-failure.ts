const errorNames = new Set(["Error", "ZodError", "APIError", "BadRequestError", "AuthenticationError", "PermissionDeniedError", "NotFoundError", "ConflictError", "UnprocessableEntityError", "RateLimitError", "InternalServerError", "APIConnectionError", "APIConnectionTimeoutError"]);
const issueCodes = new Set(["invalid_type", "invalid_literal", "unrecognized_keys", "invalid_union", "invalid_union_discriminator", "invalid_enum_value", "invalid_arguments", "invalid_return_type", "invalid_date", "invalid_string", "too_small", "too_big", "invalid_intersection_types", "not_multiple_of", "not_finite", "custom"]);
const knownPaths = new Set(["practicalAnswer", "qualification", "usedSourceIndexes", "version", "supported", "unsupportedClaims", "excerpt", "reason", "draft", "sources", "index", "text", "previousDraft", "groundingViolations", "surveySlug", "participantMessage", "sourceTopicContext", "sourceQuestionPlan", "recentTurns", "role", "content", "presentationPlan", "purpose", "depth", "maxFacts", "maxTopics", "askReadiness", "resolvedSourceQuestion", "surveyContext", "currentQuestion", "selectedNextQuestion", "selectedQuestionSourceContext", "recentInterviewerContext", "responseMode", "clinicalEvidenceCard", "title", "url", "description", "tags", "evidenceRole"]);
const failureCodes = new Set(["unsupported_claims", "citation_mismatch", "missing_contextual_citation", "unexpected_question", "invalid_grounding_verdict", "missing_structured_output", "invalid_schema", "rate_limited", "authentication_failed", "provider_timeout", "composition_unavailable"]);
const providerCodes = new Set(["rate_limit_exceeded", "insufficient_quota", "billing_hard_limit_reached"]);
const limitKinds = ["tokens_per_minute", "tokens_per_day", "requests_per_minute", "requests_per_day", "quota_or_billing", "unknown"] as const;
type LimitKind = typeof limitKinds[number];

export type SourceFailureMetadata = {
  stage: "composition" | "grounding";
  code: string;
  errorName: string;
  status: number | null;
  providerCode: string | null;
  limitKind: LimitKind | null;
  retryAfter: number | null;
  issues: Array<{ code: string; path: string[] }>;
};

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" ? value as Record<string, unknown> : {};

/** Never return error messages, received values, arbitrary keys, or provider bodies. */
export function sanitizeSourceFailure(value: unknown, stage: SourceFailureMetadata["stage"]): SourceFailureMetadata {
  const error = record(value);
  const name = error.errorName ?? error.name;
  const errorName = typeof name === "string" && errorNames.has(name) ? name : "Error";
  const status = typeof error.status === "number" && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599 ? error.status : null;
  const rawProviderCode = error.providerCode ?? error.code;
  const providerCode = typeof rawProviderCode === "string" && providerCodes.has(rawProviderCode) ? rawProviderCode : null;
  const message = typeof value === "string" ? value : typeof error.message === "string" ? error.message : "";
  let limitKind: LimitKind | null = null;
  if (status === 429) {
    const hint = [error.type, rawProviderCode, message].filter((part) => typeof part === "string").join(" ");
    limitKind = typeof error.limitKind === "string" && (limitKinds as readonly string[]).includes(error.limitKind) ? error.limitKind as LimitKind
      : /insufficient_quota|billing_hard_limit_reached|exceeded your current quota|check your plan and billing/i.test(hint) ? "quota_or_billing"
      : /\btpd\b|tokens(?:[\s_]+per[\s_]+|\/)day\b/i.test(hint) ? "tokens_per_day"
      : /\btpm\b|tokens(?:[\s_]+per[\s_]+|\/)minute\b/i.test(hint) ? "tokens_per_minute"
      : /\brpd\b|requests(?:[\s_]+per[\s_]+|\/)day\b/i.test(hint) ? "requests_per_day"
      : /\brpm\b|requests(?:[\s_]+per[\s_]+|\/)minute\b/i.test(hint) ? "requests_per_minute" : "unknown";
  }
  let retryValue: unknown = error.retryAfter;
  if (retryValue == null) {
    const headers = record(error.headers);
    try { retryValue = typeof headers.get === "function" ? headers.get.call(error.headers, "retry-after") : headers["retry-after"] ?? headers["Retry-After"]; } catch { /* Do not inspect other headers. */ }
  }
  const retryNumber = typeof retryValue === "number" ? retryValue : typeof retryValue === "string" && /^\d+(?:\.\d+)?$/.test(retryValue) ? Number(retryValue) : NaN;
  const retryAfter = Number.isFinite(retryNumber) && retryNumber >= 0 && retryNumber <= 86400 ? retryNumber : null;
  let code = typeof error.code === "string" && failureCodes.has(error.code) ? error.code : "composition_unavailable";
  if (errorName === "ZodError") code = "invalid_schema";
  else if (status === 429) code = "rate_limited";
  else if (status === 401 || status === 403) code = "authentication_failed";
  else if (errorName === "APIConnectionTimeoutError") code = "provider_timeout";
  else if (message.includes("unsupported claims")) code = "unsupported_claims";
  else if (message.includes("individual citations")) code = "citation_mismatch";
  else if (message.includes("contextual source")) code = "missing_contextual_citation";
  else if (message.includes("append a question")) code = "unexpected_question";
  else if (message.includes("exact draft excerpts")) code = "invalid_grounding_verdict";
  else if (message.includes("returned no parsed output")) code = "missing_structured_output";
  const issues = (Array.isArray(error.issues) ? error.issues : []).slice(0, 8).map((raw) => {
    const issue = record(raw);
    return {
      code: typeof issue.code === "string" && issueCodes.has(issue.code) ? issue.code : "invalid_schema",
      path: (Array.isArray(issue.path) ? issue.path : []).slice(0, 6).map((part) => typeof part === "number" && Number.isInteger(part) && part >= 0 || part === "[]" ? "[]" : typeof part === "string" && knownPaths.has(part) ? part : "[unknown]"),
    };
  });
  return { stage, code, errorName, status, providerCode, limitKind, retryAfter, issues };
}
