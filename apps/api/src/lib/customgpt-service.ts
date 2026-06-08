import { z } from "zod";
import { env } from "../env";

const customGptConversationResponseSchema = z.object({
  data: z
    .object({
      session_id: z.union([z.string(), z.number()]).optional(),
      id: z.union([z.string(), z.number()]).optional(),
    })
    .passthrough(),
});

const customGptMessagePayloadSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    openai_response: z.string().optional(),
    response: z.string().optional(),
    answer: z.string().optional(),
  })
  .passthrough();

const customGptMessageResponseSchema = z
  .object({
    data: customGptMessagePayloadSchema.optional(),
    openai_response: z.string().optional(),
    response: z.string().optional(),
    answer: z.string().optional(),
  })
  .passthrough();

const customGptCitationResponseSchema = z
  .object({
    data: z
      .object({
        id: z.union([z.string(), z.number()]).optional(),
        title: z.string().optional(),
        page_title: z.string().optional(),
        name: z.string().optional(),
        file_name: z.string().optional(),
        url: z.string().optional(),
        page_url: z.string().optional(),
        file_url: z.string().optional(),
        description: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const customGptSourcesResponseSchema = z
  .object({
    data: z.unknown().optional(),
  })
  .passthrough();

type AskCustomGptInput = {
  projectId?: string | null;
  question: string;
  surveyContext: string;
  assetTitle?: string | null;
  purpose?: "reactive_clarification" | "proactive_study_context";
};

const CUSTOMGPT_PROMPT_MAX_CHARS = 7800;
const CUSTOMGPT_REQUEST_TIMEOUT_MS = 45_000;

export type CustomGptReference = {
  citationId: string;
  title: string | null;
  url: string | null;
  description: string | null;
};

const citationReferenceCache = new Map<string, CustomGptReference>();

export type CustomGptSourceSummary = {
  sourceId: string;
  type: string;
  path: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  pageCount: number;
  indexedPageCount: number;
  queuedPageCount: number;
  failedPageCount: number;
  limitedPageCount: number;
};

function getProjectId(inputProjectId?: string | null) {
  return inputProjectId ?? env.CUSTOMGPT_PROJECT_ID ?? null;
}

function requireCustomGptConfig(projectId?: string | null) {
  if (!env.CUSTOMGPT_API_KEY) {
    return {
      enabled: false,
      reason: "CUSTOMGPT_API_KEY is not configured.",
    } as const;
  }

  if (!projectId) {
    return {
      enabled: false,
      reason: "CUSTOMGPT_PROJECT_ID is not configured for this study.",
    } as const;
  }

  return {
    enabled: true,
    projectId,
  } as const;
}

async function customGptFetch(path: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.CUSTOMGPT_API_KEY}`);
  if (!(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    CUSTOMGPT_REQUEST_TIMEOUT_MS,
  );
  let response: Response;

  try {
    response = await fetch(`${env.CUSTOMGPT_API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `CustomGPT request timed out after ${Math.round(
          CUSTOMGPT_REQUEST_TIMEOUT_MS / 1000,
        )} seconds.`,
      );
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const details = await response.text();
    throw new Error(
      `CustomGPT request failed with ${response.status}: ${details}`,
    );
  }

  return response.json() as Promise<unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function firstSourcePath(source: Record<string, unknown>) {
  return firstPresentString(source, [
    "sitemap_path",
    "path",
    "url",
    "page_url",
    "file_name",
    "name",
  ]);
}

type SourcePageStatusCounts = Pick<
  CustomGptSourceSummary,
  | "indexedPageCount"
  | "queuedPageCount"
  | "failedPageCount"
  | "limitedPageCount"
>;

function pageStatusCounts(pages: unknown[]): SourcePageStatusCounts {
  return pages.reduce<SourcePageStatusCounts>(
    (counts, page) => {
      if (!isRecord(page)) {
        return counts;
      }

      const indexStatus =
        typeof page.index_status === "string" ? page.index_status : null;

      if (indexStatus === "ok") {
        counts.indexedPageCount += 1;
      } else if (indexStatus === "failed") {
        counts.failedPageCount += 1;
      } else if (indexStatus === "limited") {
        counts.limitedPageCount += 1;
      } else if (indexStatus === "queued") {
        counts.queuedPageCount += 1;
      }

      return counts;
    },
    {
      indexedPageCount: 0,
      queuedPageCount: 0,
      failedPageCount: 0,
      limitedPageCount: 0,
    },
  );
}

function normalizeSource(source: unknown, fallbackType: string) {
  if (!isRecord(source)) {
    return null;
  }

  const pages = getArray(source.pages);
  const counts = pageStatusCounts(pages);
  const sourceId =
    source.id !== undefined && source.id !== null
      ? String(source.id)
      : (firstSourcePath(source) ?? `${fallbackType}-${Date.now()}`);
  const type =
    typeof source.type === "string" && source.type.trim()
      ? source.type.trim()
      : fallbackType;

  return {
    sourceId,
    type,
    path: firstSourcePath(source),
    createdAt: firstPresentString(source, ["created_at", "createdAt"]),
    updatedAt: firstPresentString(source, ["updated_at", "updatedAt"]),
    pageCount: pages.length,
    ...counts,
  } satisfies CustomGptSourceSummary;
}

function looksLikeSourceRecord(source: Record<string, unknown>) {
  return (
    source.id !== undefined ||
    getArray(source.pages).length > 0 ||
    firstSourcePath(source) !== null ||
    (typeof source.type === "string" && source.type.trim().length > 0)
  );
}

function normalizeSources(response: unknown) {
  const parsed = customGptSourcesResponseSchema.parse(response);
  const data = isRecord(parsed.data) ? parsed.data : parsed;
  const sources: CustomGptSourceSummary[] = [];

  for (const source of getArray(data.sitemaps)) {
    const normalized = normalizeSource(source, "sitemap");
    if (normalized) {
      sources.push(normalized);
    }
  }

  const uploads = data.uploads;
  if (Array.isArray(uploads)) {
    for (const source of uploads) {
      const normalized = normalizeSource(source, "upload");
      if (normalized) {
        sources.push(normalized);
      }
    }
  } else if (isRecord(uploads)) {
    const uploadValues = looksLikeSourceRecord(uploads)
      ? [uploads]
      : Object.values(uploads);
    for (const source of uploadValues) {
      const normalized = normalizeSource(source, "upload");
      if (normalized) {
        sources.push(normalized);
      }
    }
  }

  for (const source of getArray(data.sources)) {
    const normalized = normalizeSource(source, "source");
    if (normalized) {
      sources.push(normalized);
    }
  }

  return sources;
}

async function createConversation(projectId: string) {
  const response = customGptConversationResponseSchema.parse(
    await customGptFetch(`/projects/${projectId}/conversations`, {
      method: "POST",
      body: JSON.stringify({
        name: `medical-survey-${Date.now()}`,
      }),
    }),
  );

  const sessionId = response.data.session_id ?? response.data.id;
  if (!sessionId) {
    throw new Error("CustomGPT did not return a conversation session id.");
  }

  return String(sessionId);
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values));
}

function clipText(value: string | null | undefined, maxChars: number) {
  if (!value) {
    return null;
  }

  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxChars - 28)).trimEnd()} [truncated]`;
}

function normalizeCustomGptReference(
  value: unknown,
  fallbackIndex: number,
): CustomGptReference | null {
  if (typeof value === "string" || typeof value === "number") {
    const citationId = String(value).trim();
    return citationId
      ? {
          citationId,
          title: null,
          url: null,
          description: null,
        }
      : null;
  }

  if (!isRecord(value)) {
    return null;
  }

  const explicitId =
    firstPresentStringOrNumber(value, [
      "citation_id",
      "citationId",
      "id",
      "source_id",
      "sourceId",
      "document_id",
      "documentId",
      "page_id",
      "pageId",
    ]);
  const title = firstPresentString(value, [
    "title",
    "page_title",
    "pageTitle",
    "name",
    "file_name",
    "fileName",
    "document_title",
    "documentTitle",
  ]);
  const url = firstPresentString(value, [
    "page_url",
    "pageUrl",
    "url",
    "file_url",
    "fileUrl",
    "source_url",
    "sourceUrl",
  ]);
  const description = firstPresentString(value, [
    "description",
    "snippet",
    "text",
    "content",
  ]);

  if (!explicitId && !title && !url && !description) {
    return null;
  }

  return {
    citationId: explicitId ?? `inline:${fallbackIndex + 1}`,
    title,
    url,
    description,
  };
}

function referencesFromValue(value: unknown, startIndex: number) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item, index) => {
    const reference = normalizeCustomGptReference(item, startIndex + index);
    return reference ? [reference] : [];
  });
}

function responseReferenceValues(response: unknown) {
  const records = [
    response,
    isRecord(response) && isRecord(response.data) ? response.data : null,
  ].filter((value): value is Record<string, unknown> => isRecord(value));

  const references: CustomGptReference[] = [];
  for (const record of records) {
    for (const key of [
      "citations",
      "references",
      "sources",
      "source_documents",
      "sourceDocuments",
    ]) {
      references.push(...referencesFromValue(record[key], references.length));
    }
  }

  return references;
}

function uniqueReferences(references: CustomGptReference[]) {
  const seen = new Set<string>();
  const unique: CustomGptReference[] = [];

  for (const reference of references) {
    const key =
      reference.citationId ||
      reference.url ||
      reference.title ||
      reference.description;
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(reference);
  }

  return unique;
}

function extractMessage(response: unknown) {
  const parsed = customGptMessageResponseSchema.parse(response);
  const answer =
    parsed.data?.openai_response ??
    parsed.data?.response ??
    parsed.data?.answer ??
    parsed.openai_response ??
    parsed.response ??
    parsed.answer ??
    null;

  if (!answer) {
    throw new Error("CustomGPT did not return a message answer.");
  }

  return {
    answer,
    references: uniqueReferences(responseReferenceValues(parsed)),
  };
}

function firstPresentString(
  data: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function firstPresentStringOrNumber(
  data: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return null;
}

async function getCitationReference(projectId: string, citationId: string) {
  const cacheKey = `${projectId}:${citationId}`;
  const cached = citationReferenceCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    const parsed = customGptCitationResponseSchema.parse(
      await customGptFetch(`/projects/${projectId}/citations/${citationId}`, {
        method: "GET",
      }),
    );
    const data = (parsed.data ?? parsed) as Record<string, unknown>;
    const title =
      firstPresentString(data, [
        "title",
        "page_title",
        "name",
        "file_name",
        "document_title",
      ]) ?? `Citation ${citationId}`;
    const url = firstPresentString(data, ["page_url", "url", "file_url"]);

    const reference = {
      citationId,
      title,
      url,
      description: firstPresentString(data, ["description", "snippet"]),
    } satisfies CustomGptReference;
    citationReferenceCache.set(cacheKey, reference);
    return reference;
  } catch {
    const reference = {
      citationId,
      title: `Citation ${citationId}`,
      url: null,
      description: null,
    } satisfies CustomGptReference;
    citationReferenceCache.set(cacheKey, reference);
    return reference;
  }
}

function mergeCitationReference(
  inlineReference: CustomGptReference,
  fetchedReference: CustomGptReference,
) {
  const genericFetchedTitle = `Citation ${inlineReference.citationId}`;

  return {
    citationId: inlineReference.citationId,
    title:
      fetchedReference.title && fetchedReference.title !== genericFetchedTitle
        ? fetchedReference.title
        : (inlineReference.title ?? fetchedReference.title),
    url: fetchedReference.url ?? inlineReference.url,
    description: fetchedReference.description ?? inlineReference.description,
  } satisfies CustomGptReference;
}

function needsCitationDetailFetch(reference: CustomGptReference) {
  if (reference.citationId.startsWith("inline:")) {
    return false;
  }

  return (
    !reference.url ||
    !reference.title ||
    reference.title === `Citation ${reference.citationId}`
  );
}

async function resolveMessageReferences(
  projectId: string,
  references: CustomGptReference[],
) {
  return Promise.all(
    references.map(async (reference) => {
      if (!needsCitationDetailFetch(reference)) {
        return reference;
      }

      const fetchedReference = await getCitationReference(
        projectId,
        reference.citationId,
      );

      return mergeCitationReference(reference, fetchedReference);
    }),
  );
}

export function formatCustomGptAnswerWithReferences(
  answer: string,
  references: CustomGptReference[],
) {
  if (references.length === 0) {
    return answer;
  }

  const referenceText = references
    .map((reference, index) => {
      const label = reference.title ?? `Citation ${reference.citationId}`;
      const location = reference.url ? `: ${reference.url}` : "";
      return `[${index + 1}] ${label}${location}`;
    })
    .join(" ");

  return `${answer}\n\nReferences: ${referenceText}`;
}

function hasInlineCitationMarkers(answer: string) {
  return /\[\d{1,3}\]/.test(answer);
}

function inlineCitationNumbers(answer: string) {
  return Array.from(answer.matchAll(/\[(\d{1,3})\]/g), (match) =>
    Number(match[1]),
  ).filter((value) => Number.isInteger(value) && value > 0);
}

function stripInlineCitationMarkers(answer: string) {
  return answer
    .replace(/\s*\[\d{1,3}\]/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

function markerText(startIndex: number, count: number) {
  return Array.from(
    { length: count },
    (_, index) => `[${startIndex + index}]`,
  ).join(" ");
}

function addMarkersToParagraph(paragraph: string, markers: string) {
  const finalQuestion = paragraph.match(
    /^(.*?)(\s+(?:How|What|Which|Would|Does|Do|Can|Is|Are|To close)\b[^?]*\?)\s*$/s,
  );

  if (finalQuestion?.[1]?.trim()) {
    return `${finalQuestion[1].trimEnd()} ${markers}${finalQuestion[2]}`;
  }

  return `${paragraph.trimEnd()} ${markers}`;
}

function addFallbackCitationMarkers(
  answer: string,
  references: CustomGptReference[],
) {
  if (references.length === 0) {
    return answer;
  }

  const paragraphs = answer.split(/\n{2,}/);
  let nextReferenceIndex = 1;
  let addedMarker = false;
  const markedParagraphs = paragraphs.map((paragraph, paragraphIndex) => {
    const trimmed = paragraph.trim();
    const isFinalQuestion =
      paragraphIndex === paragraphs.length - 1 && trimmed.endsWith("?");

    if (!trimmed || isFinalQuestion || nextReferenceIndex > references.length) {
      return paragraph;
    }

    const remainingReferenceCount = references.length - nextReferenceIndex + 1;
    const remainingEvidenceParagraphCount = paragraphs
      .slice(paragraphIndex)
      .filter((candidate, candidateIndex) => {
        const candidateTrimmed = candidate.trim();
        const absoluteIndex = paragraphIndex + candidateIndex;
        return (
          candidateTrimmed &&
          !(
            absoluteIndex === paragraphs.length - 1 &&
            candidateTrimmed.endsWith("?")
          )
        );
      }).length;
    const markerCount = Math.max(
      1,
      Math.ceil(remainingReferenceCount / remainingEvidenceParagraphCount),
    );
    const actualMarkerCount = Math.min(markerCount, remainingReferenceCount);
    const markers = markerText(nextReferenceIndex, actualMarkerCount);
    nextReferenceIndex += actualMarkerCount;
    addedMarker = true;
    return addMarkersToParagraph(paragraph, markers);
  });

  if (addedMarker) {
    return markedParagraphs.join("\n\n");
  }

  return addMarkersToParagraph(answer, markerText(1, references.length));
}

function normalizeCitationMarkers(
  answer: string,
  references: CustomGptReference[],
) {
  if (references.length === 0) {
    return answer;
  }

  const citationNumbers = inlineCitationNumbers(answer);
  if (citationNumbers.length === 0) {
    return addFallbackCitationMarkers(answer, references);
  }

  const hasOrphanedMarker = citationNumbers.some(
    (citationNumber) => citationNumber > references.length,
  );

  if (!hasOrphanedMarker) {
    return answer;
  }

  return addFallbackCitationMarkers(stripInlineCitationMarkers(answer), references);
}

export async function listCustomGptSources(input: {
  projectId?: string | null;
}) {
  const projectId = getProjectId(input.projectId);
  const config = requireCustomGptConfig(projectId);

  if (!config.enabled) {
    return {
      enabled: false,
      projectId,
      reason: config.reason,
      sources: [],
    };
  }

  const response = await customGptFetch(
    `/projects/${config.projectId}/sources`,
    {
      method: "GET",
    },
  );

  return {
    enabled: true,
    projectId: config.projectId,
    reason: null,
    sources: normalizeSources(response),
  };
}

export async function addCustomGptSitemapSource(input: {
  projectId?: string | null;
  sitemapPath: string;
}) {
  const projectId = getProjectId(input.projectId);
  const config = requireCustomGptConfig(projectId);

  if (!config.enabled) {
    throw new Error(config.reason);
  }

  const formData = new FormData();
  formData.append("sitemap_path", input.sitemapPath);
  formData.append("image_extraction_type", "none");

  await customGptFetch(`/projects/${config.projectId}/sources`, {
    method: "POST",
    body: formData,
  });

  return listCustomGptSources({
    projectId: config.projectId,
  });
}

export async function addCustomGptFileSource(input: {
  projectId?: string | null;
  fileName: string;
  mimeType: string;
  bytes: Buffer;
}) {
  const projectId = getProjectId(input.projectId);
  const config = requireCustomGptConfig(projectId);

  if (!config.enabled) {
    throw new Error(config.reason);
  }

  const formData = new FormData();
  formData.append(
    "files[]",
    new Blob([input.bytes], { type: input.mimeType }),
    input.fileName,
  );
  formData.append("file_data_retension", "true");
  formData.append("is_ocr_enabled", "0");
  formData.append("is_vision_enabled", "false");

  await customGptFetch(`/projects/${config.projectId}/sources`, {
    method: "POST",
    body: formData,
  });

  return listCustomGptSources({
    projectId: config.projectId,
  });
}

export async function askCustomGptForSurveyClarification(
  input: AskCustomGptInput,
) {
  const projectId = getProjectId(input.projectId);
  const config = requireCustomGptConfig(projectId);

  if (!config.enabled) {
    return {
      enabled: false,
      answer: null,
      references: [],
      citationIds: [],
      reason: config.reason,
    };
  }

  const sessionId = await createConversation(config.projectId);
  const proactiveStudyContext = input.purpose === "proactive_study_context";
  const prompt = [
    proactiveStudyContext
      ? "You are preparing source context for a structured medical market research survey."
      : "You are supporting a structured medical market research survey.",
    proactiveStudyContext
      ? "Provide a source-grounded context block before the respondent is asked to react."
      : "Answer only the participant's clarification question using the approved knowledge base.",
    proactiveStudyContext
      ? "Do not answer the survey question for the respondent or suggest how they should react."
      : null,
    "Do not provide diagnosis, treatment advice, or emergency triage.",
    "Give a thorough answer from the approved source material when the question calls for it.",
    "If the participant asks about a named clinical study or trial, summarize it so they can react to the survey question: study name, population or setting, design/comparator if available, key endpoint or result if supported, and relevant caveats.",
    proactiveStudyContext
      ? "If the survey question itself depends on a named clinical study or trial, proactively include enough detail for an HCP to react: study name/acronym, clinical setting or population, design and comparator, endpoint(s), efficacy or safety result(s), follow-up or treatment context, and caveats or limitations when supported by the source."
      : "If the survey question itself depends on a named clinical study or trial, summarize that study before the question is asked: study name, population or setting, design/comparator if available, key endpoint or result if supported, and relevant caveats.",
    proactiveStudyContext
      ? "Use one to three tight paragraphs or bullets. Do not reduce substantive study context to a one-line teaser unless the approved source is thin."
      : null,
    "For study summaries, use plain language and keep the focus on helping the respondent understand the source material, not persuading them.",
    "Preserve important caveats, distinctions, and context from the source material.",
    "Use source-grounded wording and include citation markers if the agent is configured to show them.",
    "Do not invent references. If the approved source material does not answer the question, say that clearly.",
    input.assetTitle ? `Current asset: ${input.assetTitle}` : null,
    `Survey context: ${input.surveyContext}`,
    proactiveStudyContext
      ? `Survey question needing context: ${input.question}`
      : `Participant question: ${input.question}`,
  ]
    .filter(Boolean)
    .join("\n");

  const response = await customGptFetch(
    `/projects/${config.projectId}/conversations/${sessionId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        prompt,
        custom_context: input.surveyContext,
        response_source: "own_content",
        agent_capability: "optimal-choice",
      }),
    },
  );
  const message = extractMessage(response);
  const references = await resolveMessageReferences(
    config.projectId,
    message.references,
  );

  return {
    enabled: true,
    answer: formatCustomGptAnswerWithReferences(message.answer, references),
    references,
    citationIds: references.map((reference) => reference.citationId),
    reason: null,
  };
}

export async function askCustomGptForProactiveStudyContext(
  input: Omit<AskCustomGptInput, "purpose">,
) {
  return askCustomGptForSurveyClarification({
    ...input,
    purpose: "proactive_study_context",
  });
}

export async function askCustomGptForSurveyInterviewerTurn(input: {
  projectId?: string | null;
  conversationId?: string | null;
  participantMessage: string;
  surveyContext: string;
  currentQuestion: string | null;
  selectedNextQuestion: string | null;
  selectedQuestionSourceContext: string | null;
  remainingSeconds: number;
  askedQuestions: string[];
}) {
  const projectId = getProjectId(input.projectId);
  const config = requireCustomGptConfig(projectId);

  if (!config.enabled) {
    return {
      enabled: false,
      answer: null,
      references: [],
      citationIds: [],
      conversationId: null,
      reason: config.reason,
    };
  }

  const sessionId =
    input.conversationId ?? (await createConversation(config.projectId));
  const selectedSourceContext = clipText(
    input.selectedQuestionSourceContext,
    1500,
  );
  const currentQuestion = clipText(input.currentQuestion, 500);
  const selectedNextQuestion = clipText(input.selectedNextQuestion, 700);
  const surveyContext = clipText(input.surveyContext, 1400);
  const participantMessage = clipText(input.participantMessage, 1800);
  const askedQuestions = input.askedQuestions
    .slice(-6)
    .map((question) => clipText(question, 180))
    .filter((question): question is string => Boolean(question))
    .join(" | ");
  const prompt = [
    "You are the CustomGPT-first interviewer in a structured medical market research survey.",
    "Write one natural interviewer message only. Ask one survey question only.",
    "Use only the approved source material named in the survey controller context for factual/site/study detail and cite source-supported claims.",
    "Place inline citation markers like [1] immediately after the specific source-supported claim or sentence. Do not dump all citation markers only at the end of the answer.",
    "If the participant asked a source/evidence/safety/detail question, answer it, then return to the selected survey question in the same message.",
    "Respect the active disease lane in the survey controller context. For broad follow-ups such as 'what's new,' 'what else is new,' or 'what information is new,' scope the source answer to the active disease lane unless the participant explicitly names another disease area or the source-context requirement asks for cross-disease breadth. Do not cite off-lane disease pages for broad questions.",
    "If the participant answered adequately, acknowledge briefly and continue.",
    "Do not answer evidence requests with vague framing such as only saying a study is an anchor, flagship story, or key evidence. Give the actual useful study details.",
    "This is an HCP audience. For evidence questions, be concise but data-dense; bullets are fine. Include study names, design/phase if supported, disease setting and population, comparator or cohorts, endpoint(s), key numeric result(s), follow-up/timepoint when supported, safety/tolerability context when relevant, and caveats or limitations. If a detail is not in the approved source, say it is not available from the source.",
    "When a source-supported numeric result is available, give the exact value instead of only saying results favored the product, were strong, were positive, or were clinically meaningful.",
    "For broad evidence questions, use a compact evidence-card format: Study/setting, design/comparator, endpoint, key result(s), safety/tolerability or caveat, citation.",
    "If the participant asks what the data show, prioritize concrete study results over website-section summaries.",
    "Avoid repetitive acknowledgements. Do not start every turn with generic thanks.",
    selectedSourceContext
      ? "A source-context requirement applies to this turn. Explain the relevant source detail first, cite it, then ask the selected question. Do not ask the question naked."
      : "No mandatory source-context requirement was selected for this turn.",
    selectedSourceContext
      ? `Source-context requirement: ${selectedSourceContext}`
      : null,
    "Do not provide diagnosis, treatment advice, emergency triage, or patient-specific care instructions.",
    "Do not repeat already asked questions. Do not stay on a reactive clarification topic for another turn.",
    input.remainingSeconds <= 90
      ? "The timebox is nearly over. Be concise and move toward a final high-value wrap-up."
      : null,
    currentQuestion
      ? `Current survey question being answered: ${currentQuestion}`
      : "Current survey question being answered: none.",
    selectedNextQuestion
      ? `Selected next survey question to ask at the end of your message: ${selectedNextQuestion}`
      : "Selected next survey question to ask at the end of your message: none. Close the interview briefly.",
    askedQuestions
      ? `Recently asked survey questions: ${askedQuestions}`
      : "Already asked survey questions: none.",
    `Seconds remaining: ${input.remainingSeconds}`,
    surveyContext ? `Survey controller context: ${surveyContext}` : null,
    participantMessage ? `Participant message: ${participantMessage}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  if (prompt.length > CUSTOMGPT_PROMPT_MAX_CHARS) {
    throw new Error(
      `Internal CustomGPT prompt exceeded ${CUSTOMGPT_PROMPT_MAX_CHARS} characters after compaction.`,
    );
  }

  const response = await customGptFetch(
    `/projects/${config.projectId}/conversations/${sessionId}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        prompt,
        custom_context: input.surveyContext,
        response_source: "own_content",
        agent_capability: "optimal-choice",
      }),
    },
  );
  const message = extractMessage(response);
  const references = await resolveMessageReferences(
    config.projectId,
    message.references,
  );

  return {
    enabled: true,
    answer: normalizeCitationMarkers(message.answer, references),
    references,
    citationIds: references.map((reference) => reference.citationId),
    conversationId: sessionId,
    reason: null,
  };
}
