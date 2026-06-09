import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  type GroundedReference,
  type MvpCustomGptSurveyMessage,
  type MvpCustomGptSurveyResponse,
  type MvpCustomGptSurveySpeechRequest,
  type MvpCustomGptSurveyStartRequest,
  type MvpCustomGptSurveyTurnRequest,
  type MvpCustomGptSurveyVoiceTranscribeRequest,
  type MvpCustomGptSurveyVoiceTurnRequest,
  mvpCustomGptSurveyResponseSchema,
  mvpCustomGptSurveySpeechResponseSchema,
  mvpCustomGptSurveyVoiceTranscribeResponseSchema,
  mvpCustomGptSurveyVoiceTurnResponseSchema,
} from "@interview/schemas";
import { env } from "../env";
import { askCustomGptForSurveyInterviewerTurn } from "./customgpt-service";
import {
  BRUKINSA_HCP_MVP_GUIDE,
  type MvpGuideQuestion,
  guideFromQuestionStrings,
} from "./mvp-brukinsa-guide";
import { PADCEV_HCP_MVP_GUIDE } from "./mvp-padcev-guide";
import { transcriptLooksNonEnglishOrGarbled } from "./transcript-quality";
import { decodeAudio, synthesizeSpeech, transcribeAudio } from "./voice-service";

const BRUKINSA_DEFAULT_PROJECT_ID = "96737";
const PADCEV_DEFAULT_PROJECT_ID = "97350";
const MVP_AUDIT_DIR_NAME = "mvp-turn-audits";

type DiseaseArea = "cll" | "wm" | "mcl" | "mzl" | "fl";
type MvpSurveySlug = "brukinsa" | "padcev";

type MvpSurveyDefinition = {
  slug: MvpSurveySlug;
  defaultStudyName: string;
  sourceBrand: string;
  guide: MvpGuideQuestion[];
  intents?: MvpSurveyIntent[];
  projectIdEnvName: string;
  defaultProjectId: () => string | null;
};

type MvpSurveyIntent = {
  slug: string;
  label: string;
  primaryIntent: string;
  requiredCoverage: string[];
  steeringRule: string;
  questionOrder: string[];
  allowedQuestionIds?: string[];
  blockedQuestionIds?: string[];
  offLaneSourceRule?: string;
};

type MvpSurveySession = {
  sessionId: string;
  surveySlug: MvpSurveySlug;
  sourceBrand: string;
  surveyIntent: MvpSurveyIntent | null;
  studyName: string;
  projectId: string | null;
  projectIdEnvName: string;
  targetDurationSeconds: number;
  startedAt: Date;
  guide: MvpGuideQuestion[];
  askedQuestionIds: string[];
  currentQuestionId: string | null;
  activeDiseaseAreas: DiseaseArea[];
  primaryDiseaseArea: DiseaseArea | null;
  queuedQuestionIds: string[];
  messages: MvpCustomGptSurveyMessage[];
  turnCount: number;
  completedReason: string | null;
};

const sessions = new Map<string, MvpSurveySession>();

const PADCEV_SAFETY_LANE_QUESTION_IDS = new Set([
  "safety",
  "safety_management_workflow",
  "safety_patient_caution",
  "safety_resources",
  "support_barriers",
  "safety_close",
]);

const PADCEV_SURVEY_INTENTS: MvpSurveyIntent[] = [
  {
    slug: "general-padcev-reaction",
    label: "General PADCEV Reaction",
    primaryIntent:
      "Understand the respondent's overall reaction to PADCEV source information across evidence, safety, patient fit, and implementation.",
    requiredCoverage: [
      "baseline familiarity",
      "current indication and positioning",
      "EV-302/KEYNOTE-A39 first-line evidence",
      "patient fit",
      "safety/tolerability",
      "overall perception",
    ],
    steeringRule:
      "Keep the discussion balanced across source-supported efficacy, safety, patient fit, dosing/admin, and implementation. Do not dwell on intake demographics.",
    questionOrder: [
      "intro_consent",
      "familiarity",
      "indication_positioning",
      "ev302",
      "patient_fit",
      "safety",
      "dosing_admin",
      "overall",
      "close",
    ],
  },
  {
    slug: "ev302-first-line-evidence",
    label: "EV-302 / First-Line Evidence",
    primaryIntent:
      "Guide the respondent through the PADCEV plus pembrolizumab first-line evidence and identify what the EV-302/KEYNOTE-A39 data changes or fails to change.",
    requiredCoverage: [
      "EV-302/KEYNOTE-A39 design",
      "key efficacy outcomes",
      "patient types where evidence is compelling",
      "safety caveats tied to first-line use",
      "remaining evidence questions",
    ],
    steeringRule:
      "Prioritize concrete EV-302/KEYNOTE-A39 study details and first-line implications. Answer other source questions briefly, then return to first-line evidence.",
    questionOrder: [
      "intro_consent",
      "ev302",
      "patient_fit",
      "safety",
      "overall",
      "close",
    ],
  },
  {
    slug: "side-effect-management",
    label: "Side Effect Management",
    primaryIntent:
      "Understand how practitioners think about monitoring, counseling, mitigating, and operationalizing PADCEV-associated adverse events.",
    requiredCoverage: [
      "baseline safety concern",
      "skin reaction management",
      "peripheral neuropathy",
      "hyperglycemia",
      "pneumonitis/ILD and ocular issues when relevant",
      "dose modification confidence",
      "patient counseling and monitoring barriers",
    ],
    steeringRule:
      "Prioritize safety-management confidence, monitoring workflow, dose modification comfort, and practical barriers. Do not route into broad efficacy, PFS/OS, or general patient-attractiveness questions unless the respondent explicitly asks about efficacy or risk-benefit.",
    questionOrder: [
      "intro_consent",
      "safety",
      "safety_management_workflow",
      "safety_patient_caution",
      "safety_resources",
      "support_barriers",
      "safety_close",
      "close",
    ],
    allowedQuestionIds: [
      "intro_consent",
      "safety",
      "safety_management_workflow",
      "safety_patient_caution",
      "safety_resources",
      "support_barriers",
      "safety_close",
      "close",
    ],
    blockedQuestionIds: [
      "indication_positioning",
      "ev302",
      "patient_fit",
      "monotherapy_evidence",
      "overall",
    ],
    offLaneSourceRule:
      "For the side-effect-management intent, efficacy/PFS/OS and broad patient-attractiveness modules are off-lane unless the respondent explicitly asks about efficacy, clinical benefit, or risk-benefit tradeoff.",
  },
  {
    slug: "patient-selection-barriers",
    label: "Patient Selection & Barriers",
    primaryIntent:
      "Identify where PADCEV feels appropriate, where clinicians are cautious, and which practical barriers prevent adoption.",
    requiredCoverage: [
      "appropriate patient populations",
      "caution or avoidance segments",
      "comorbidity and toxicity-risk concerns",
      "implementation barriers",
      "access/support needs",
      "what would increase confidence",
    ],
    steeringRule:
      "Prioritize patient-fit, caution segments, and barriers. Use source evidence to probe why the respondent would or would not use PADCEV in specific scenarios.",
    questionOrder: [
      "intro_consent",
      "patient_fit",
      "indication_positioning",
      "ev302",
      "safety",
      "support_barriers",
      "overall",
      "close",
    ],
  },
  {
    slug: "familiar-whats-new",
    label: "Already Familiar: What's New",
    primaryIntent:
      "Orient familiar respondents to newer or emphasized PADCEV information and determine what, if anything, would change behavior.",
    requiredCoverage: [
      "current indication or positioning updates",
      "EV-302/KEYNOTE-A39 first-line evidence",
      "later-line monotherapy context",
      "safety-management details that may be underappreciated",
      "remaining information gaps",
    ],
    steeringRule:
      "Assume basic familiarity. Avoid basic intake and introductory education; focus on what is new, underappreciated, or practice-changing.",
    questionOrder: [
      "intro_consent",
      "indication_positioning",
      "ev302",
      "monotherapy_evidence",
      "safety",
      "overall",
      "close",
    ],
  },
];

const SURVEY_DEFINITIONS: Record<MvpSurveySlug, MvpSurveyDefinition> = {
  brukinsa: {
    slug: "brukinsa",
    defaultStudyName: "BRUKINSA HCP MVP",
    sourceBrand: "BRUKINSA",
    guide: BRUKINSA_HCP_MVP_GUIDE,
    projectIdEnvName: "CUSTOMGPT_PROJECT_ID",
    defaultProjectId: () => env.CUSTOMGPT_PROJECT_ID ?? BRUKINSA_DEFAULT_PROJECT_ID,
  },
  padcev: {
    slug: "padcev",
    defaultStudyName: "PADCEV HCP MVP",
    sourceBrand: "PADCEV",
    guide: PADCEV_HCP_MVP_GUIDE,
    intents: PADCEV_SURVEY_INTENTS,
    projectIdEnvName: "CUSTOMGPT_PADCEV_PROJECT_ID",
    defaultProjectId: () => env.CUSTOMGPT_PADCEV_PROJECT_ID ?? PADCEV_DEFAULT_PROJECT_ID,
  },
};

function surveyDefinitionForSlug(slug?: string): MvpSurveyDefinition {
  const normalized = slug?.toLowerCase();

  if (normalized === "padcev") {
    return SURVEY_DEFINITIONS.padcev;
  }

  return SURVEY_DEFINITIONS.brukinsa;
}

function surveyIntentForSlug(
  definition: MvpSurveyDefinition,
  slug?: string,
) {
  if (!definition.intents?.length) {
    return null;
  }

  return (
    definition.intents.find((intent) => intent.slug === slug) ??
    definition.intents[0] ??
    null
  );
}

function guideForIntent(
  definition: MvpSurveyDefinition,
  intent: MvpSurveyIntent | null,
) {
  if (!intent) {
    return definition.guide;
  }

  const guideById = new Map(
    definition.guide.map((question) => [question.id, question]),
  );

  return intent.questionOrder
    .map((questionId) => guideById.get(questionId))
    .filter((question): question is MvpGuideQuestion => Boolean(question));
}

function questionAllowedByIntent(
  session: MvpSurveySession,
  question: MvpGuideQuestion,
) {
  const intent = session.surveyIntent;

  if (!intent) {
    return true;
  }

  if (intent.blockedQuestionIds?.includes(question.id)) {
    return false;
  }

  if (intent.allowedQuestionIds?.length) {
    return intent.allowedQuestionIds.includes(question.id);
  }

  return true;
}

function workspaceRoot() {
  const cwd = process.cwd();

  return cwd.endsWith(path.join("apps", "api")) ? path.resolve(cwd, "../..") : cwd;
}

function appendMvpAuditEvent(
  session: MvpSurveySession,
  event: Record<string, unknown>,
) {
  try {
    const auditDir = path.join(workspaceRoot(), "storage", MVP_AUDIT_DIR_NAME);
    mkdirSync(auditDir, { recursive: true });
    appendFileSync(
      path.join(auditDir, `${session.sessionId}.jsonl`),
      `${JSON.stringify({
        timestamp: new Date().toISOString(),
        sessionId: session.sessionId,
        studyName: session.studyName,
        turnCount: session.turnCount,
        ...event,
      })}\n`,
      "utf8",
    );
  } catch {
    // Audit capture should never block the respondent-facing interview.
  }
}

function normalizeClinicalMarkup(content: string) {
  return content
    .replace(/\$\$?\s*IC_\{?50\}?\s*\$\$?/gi, "IC50")
    .replace(/\$\$?\s*([A-Za-z]+)_\{?(\d+)\}?\s*\$\$?/g, "$1$2")
    .replace(/\$\$?\s*([^$]+?)\s*\$\$?/g, "$1");
}

function createMessage(
  role: MvpCustomGptSurveyMessage["role"],
  content: string,
  references: GroundedReference[] = [],
): MvpCustomGptSurveyMessage {
  return {
    id: randomUUID(),
    role,
    content: normalizeClinicalMarkup(content),
    createdAt: new Date().toISOString(),
    references,
  };
}

function cleanTextForSpeech(content: string) {
  let withoutReferences = content
    .replace(/\n\s*References:\s*[\s\S]*$/i, "")
    .replace(/\s+[A-Z][A-Za-z0-9®™()/'\-. ]{0,80}\s+page(?:\s+[A-Z][A-Za-z0-9®™()/'\-. ]{0,80}\s+page)*/g, "");
  const lastQuestionMarkIndex = withoutReferences.lastIndexOf("?");
  const textAfterLastQuestion =
    lastQuestionMarkIndex >= 0
      ? withoutReferences.slice(lastQuestionMarkIndex + 1)
      : "";

  if (
    /\b(?:BRUKINSA|PADCEV|Citation|HCP|source|homepage|page)\b/i.test(
      textAfterLastQuestion,
    )
  ) {
    withoutReferences = withoutReferences.slice(0, lastQuestionMarkIndex + 1);
  }

  return withoutReferences
    .replace(/\$\$?\s*IC_\{?50\}?\s*\$\$?/gi, "IC50")
    .replace(/\$\$?\s*([A-Za-z]+)_\{?(\d+)\}?\s*\$\$?/g, "$1$2")
    .replace(/\$\$?\s*([^$]+?)\s*\$\$?/g, "$1")
    .replace(/\[\d{1,3}(?:\s*[-,\u2013\u2014]\s*\d{1,3})*\]/g, "")
    .replace(/\bCitation\s+\d+\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function latestInterviewerMessage(session: MvpSurveySession) {
  return [...session.messages]
    .reverse()
    .find((message) => message.role === "interviewer");
}

function compactHistoryText(value: string, maxLength = 320) {
  const compacted = cleanTextForSpeech(value)
    .replace(/\s+/g, " ")
    .trim();

  return compacted.length > maxLength
    ? `${compacted.slice(0, maxLength - 1).trim()}...`
    : compacted;
}

function recentInterviewerSourceContext(session: MvpSurveySession) {
  const previousInterviewerMessages = session.messages
    .filter((message) => message.role === "interviewer")
    .slice(-4)
    .map((message) => compactHistoryText(message.content, 260))
    .filter(Boolean);

  if (previousInterviewerMessages.length === 0) {
    return null;
  }

  return previousInterviewerMessages
    .map((message, index) => `${index + 1}. ${message}`)
    .join(" ");
}

function configuredProjectId(
  definition: MvpSurveyDefinition,
  inputProjectId?: string,
) {
  return inputProjectId ?? definition.defaultProjectId();
}

function customGptMissingReason(
  projectId: string | null,
  projectIdEnvName = "CUSTOMGPT_PROJECT_ID",
) {
  if (!env.CUSTOMGPT_API_KEY) {
    return "CUSTOMGPT_API_KEY is not configured.";
  }

  if (!projectId) {
    return `${projectIdEnvName} is not configured.`;
  }

  return null;
}

function elapsedSeconds(session: MvpSurveySession) {
  return Math.max(
    0,
    Math.floor((Date.now() - session.startedAt.getTime()) / 1000),
  );
}

function remainingSeconds(session: MvpSurveySession) {
  return Math.max(0, session.targetDurationSeconds - elapsedSeconds(session));
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedTokens(value: string) {
  return normalizeText(value)
    .split(" ")
    .filter(Boolean);
}

function diseaseMatchIndex(content: string, patterns: string[]) {
  const normalized = ` ${normalizeText(content)} `;
  return Math.min(
    ...patterns
      .map((pattern) => normalized.indexOf(` ${normalizeText(pattern)} `))
      .filter((index) => index >= 0),
  );
}

function extractDiseaseAreas(content: string): DiseaseArea[] {
  const candidates: Array<{ area: DiseaseArea; index: number }> = [
    {
      area: "cll",
      index: diseaseMatchIndex(content, [
        "cll",
        "sll",
        "chronic lymphocytic",
        "small lymphocytic",
      ]),
    },
    {
      area: "wm",
      index: diseaseMatchIndex(content, ["wm", "waldenstrom"]),
    },
    {
      area: "mcl",
      index: diseaseMatchIndex(content, ["mcl", "mantle cell"]),
    },
    {
      area: "mzl",
      index: diseaseMatchIndex(content, ["mzl", "marginal zone"]),
    },
    {
      area: "fl",
      index: diseaseMatchIndex(content, ["fl", "follicular"]),
    },
  ];

  const matches = candidates.filter((match) => Number.isFinite(match.index));

  return matches
    .sort((left, right) => left.index - right.index)
    .map((match) => match.area);
}

function addDiseaseAreas(session: MvpSurveySession, areas: DiseaseArea[]) {
  for (const area of areas) {
    if (!session.activeDiseaseAreas.includes(area)) {
      session.activeDiseaseAreas.push(area);
    }
  }
}

function updateDiseaseStateFromParticipant(
  session: MvpSurveySession,
  content: string,
) {
  const areas = extractDiseaseAreas(content);
  if (areas.length === 0) {
    return;
  }

  const answeredQuestion = currentQuestion(session);
  addDiseaseAreas(session, areas);

  if (answeredQuestion?.id === "disease_involvement" && areas.length === 1) {
    session.primaryDiseaseArea = areas[0] ?? null;
  }

  if (answeredQuestion?.id === "primary_disease_focus") {
    session.primaryDiseaseArea = areas[0] ?? null;
  }
}

function diseaseAreasForQuestion(question: MvpGuideQuestion): DiseaseArea[] {
  if (
    [
      "cll_baseline_perception",
      "cll_orientation",
      "cll_guideline_positioning",
      "sequoia",
      "sequoia_patient_fit",
      "alpine",
      "cll_safety_tolerability",
    ].includes(question.id)
  ) {
    return ["cll"];
  }

  if (question.id === "wm_aspen") {
    return ["wm"];
  }

  if (question.id === "accelerated_approval_indolent") {
    return ["mcl", "mzl", "fl"];
  }

  return [];
}

function intersects<T>(left: T[], right: T[]) {
  return left.some((item) => right.includes(item));
}

function preferredDiseaseAreas(session: MvpSurveySession) {
  return session.primaryDiseaseArea
    ? [session.primaryDiseaseArea]
    : session.activeDiseaseAreas;
}

function questionAllowedByDiseaseLane(
  session: MvpSurveySession,
  question: MvpGuideQuestion,
  participantContent = "",
) {
  if (question.id === "primary_disease_focus" && session.primaryDiseaseArea) {
    return false;
  }

  const questionAreas = diseaseAreasForQuestion(question);
  if (questionAreas.length === 0) {
    return true;
  }

  const requestedAreas = extractDiseaseAreas(participantContent);
  if (intersects(questionAreas, requestedAreas)) {
    return true;
  }

  const activeAreas = preferredDiseaseAreas(session);
  return activeAreas.length === 0 || intersects(questionAreas, activeAreas);
}

function diseaseAreaLabel(area: DiseaseArea) {
  return {
    cll: "CLL/SLL",
    wm: "WM",
    mcl: "MCL",
    mzl: "MZL",
    fl: "FL",
  }[area];
}

function questionText(question: MvpGuideQuestion | null) {
  return question?.canonicalQuestion ?? null;
}

function currentQuestion(session: MvpSurveySession) {
  return (
    session.guide.find((question) => question.id === session.currentQuestionId) ??
    null
  );
}

function askedQuestions(session: MvpSurveySession) {
  return session.askedQuestionIds.flatMap((questionId) => {
    const question = session.guide.find((item) => item.id === questionId);
    return question ? [question.canonicalQuestion] : [];
  });
}

function questionWasAsked(session: MvpSurveySession, question: MvpGuideQuestion) {
  return session.askedQuestionIds.includes(question.id);
}

function unaskedQuestions(session: MvpSurveySession) {
  return session.guide.filter((question) => !questionWasAsked(session, question));
}

function guideIndex(session: MvpSurveySession, questionId: string | null) {
  if (!questionId) {
    return -1;
  }

  return session.guide.findIndex((question) => question.id === questionId);
}

function furthestAskedIndex(session: MvpSurveySession) {
  return Math.max(
    guideIndex(session, session.currentQuestionId),
    ...session.askedQuestionIds.map((questionId) => guideIndex(session, questionId)),
  );
}

function selectableQuestions(
  session: MvpSurveySession,
  questions: MvpGuideQuestion[],
  participantContent = "",
) {
  return questions.filter((question) =>
    questionAllowedByIntent(session, question) &&
    questionAllowedByDiseaseLane(session, question, participantContent),
  );
}

function firstPatternIndex(content: string, patterns: RegExp[]) {
  const indexes = patterns
    .map((pattern) => content.search(pattern))
    .filter((index) => index >= 0);

  return indexes.length ? Math.min(...indexes) : -1;
}

function questionById(session: MvpSurveySession, questionId: string) {
  return session.guide.find((question) => question.id === questionId) ?? null;
}

function enqueueQuestionIds(
  session: MvpSurveySession,
  questionIds: string[],
  participantContent: string,
) {
  for (const questionId of questionIds) {
    const question = questionById(session, questionId);
    if (
      !question ||
      questionWasAsked(session, question) ||
      session.queuedQuestionIds.includes(questionId) ||
      !questionAllowedByIntent(session, question) ||
      !questionAllowedByDiseaseLane(session, question, participantContent)
    ) {
      continue;
    }

    session.queuedQuestionIds.push(questionId);
  }
}

function queuePriorityFollowUps(
  session: MvpSurveySession,
  answeredQuestion: MvpGuideQuestion | null,
  participantContent: string,
) {
  if (
    !answeredQuestion ||
    !["btki_decision_framework", "cll_orientation", "evidence_overview"].includes(
      answeredQuestion.id,
    ) &&
      !(session.surveySlug === "padcev" && answeredQuestion.id === "decision_framework")
  ) {
    return;
  }

  const normalized = normalizeText(participantContent);
  const rules: Array<{
    questionIds: string[];
    patterns: RegExp[];
  }> = [
    {
      questionIds: ["sequoia"],
      patterns: [
        /\bprogression free\b/,
        /\bpfs\b/,
        /\boverall survival\b/,
        /\bos\b/,
        /\bsurvival\b/,
        /\befficacy\b/,
        /\bfirst line\b/,
        /\bfrontline\b/,
        /\bsequoia\b/,
      ],
    },
    {
      questionIds: ["alpine"],
      patterns: [
        /\balpine\b/,
        /\bhead to head\b/,
        /\bibrutinib\b/,
        /\brelapsed\b/,
        /\brefractory\b/,
        /\borr\b/,
      ],
    },
    {
      questionIds: ["cll_guideline_positioning"],
      patterns: [
        /\bguideline\b/,
        /\bguidelines\b/,
        /\bnccn\b/,
        /\bcategory\b/,
        /\bpreferred\b/,
        /\bpositioning\b/,
      ],
    },
    {
      questionIds: ["cll_safety_tolerability"],
      patterns: [
        /\bsafety\b/,
        /\btolerability\b/,
        /\bside effect\b/,
        /\bside effects\b/,
        /\badverse\b/,
        /\brisk\b/,
        /\btoxicity\b/,
      ],
    },
    {
      questionIds: ["sequoia_patient_fit"],
      patterns: [
        /\bpatient fit\b/,
        /\bpatient type\b/,
        /\bpatient types\b/,
        /\bpatient population\b/,
        /\bappropriate patient\b/,
      ],
    },
    {
      questionIds: ["dosing_formulation"],
      patterns: [/\bdosing\b/, /\bdose\b/, /\bbid\b/, /\bqd\b/],
    },
    {
      questionIds: ["support_resources"],
      patterns: [/\baccess\b/, /\bsupport\b/, /\bresource\b/, /\bresources\b/],
    },
    {
      questionIds: ["ev302"],
      patterns: [
        /\bev 302\b/,
        /\bev302\b/,
        /\bkeynote a39\b/,
        /\bkeynote-a39\b/,
        /\boverall survival\b/,
        /\bos\b/,
        /\bprogression free\b/,
        /\bpfs\b/,
        /\befficacy\b/,
        /\bfirst line\b/,
        /\bfrontline\b/,
      ],
    },
    {
      questionIds: ["patient_fit"],
      patterns: [
        /\bpatient fit\b/,
        /\bpatient population\b/,
        /\bpatient populations\b/,
        /\bpatient type\b/,
        /\bpatient types\b/,
        /\bcisplatin\b/,
        /\brenal\b/,
        /\bdiabetes\b/,
      ],
    },
    {
      questionIds: ["monotherapy_evidence"],
      patterns: [
        /\bmonotherapy\b/,
        /\bev 301\b/,
        /\bev301\b/,
        /\bev 201\b/,
        /\bev201\b/,
        /\blater line\b/,
        /\bpost platinum\b/,
      ],
    },
    {
      questionIds: ["safety"],
      patterns: [
        /\bsafety\b/,
        /\btolerability\b/,
        /\bside effect\b/,
        /\bside effects\b/,
        /\btoxicity\b/,
        /\bneuropathy\b/,
        /\bskin\b/,
        /\bhyperglycemia\b/,
        /\bpneumonitis\b/,
      ],
    },
    {
      questionIds: ["dosing_admin"],
      patterns: [/\bdosing\b/, /\bdose\b/, /\badministration\b/, /\binfusion\b/, /\bschedule\b/],
    },
  ];

  const matches = rules
    .map((rule, order) => ({
      ...rule,
      order,
      index: firstPatternIndex(normalized, rule.patterns),
    }))
    .filter((rule) => rule.index >= 0)
    .sort((left, right) => left.index - right.index || left.order - right.order);

  for (const match of matches) {
    enqueueQuestionIds(session, match.questionIds, participantContent);
  }
}

function dequeueNextQuestion(
  session: MvpSurveySession,
  participantContent: string,
) {
  while (session.queuedQuestionIds.length > 0) {
    const questionId = session.queuedQuestionIds[0];
    const question = questionId ? questionById(session, questionId) : null;

    if (
      question &&
      !questionWasAsked(session, question) &&
      questionAllowedByIntent(session, question) &&
      questionAllowedByDiseaseLane(session, question, participantContent)
    ) {
      session.queuedQuestionIds.shift();
      return question;
    }

    session.queuedQuestionIds.shift();
  }

  return null;
}

function forwardUnaskedQuestions(
  session: MvpSurveySession,
  participantContent = "",
) {
  const cursor = furthestAskedIndex(session);
  return selectableQuestions(
    session,
    session.guide.filter(
      (question, index) => index > cursor && !questionWasAsked(session, question),
    ),
    participantContent,
  );
}

function selectQuestionForKeyword(
  session: MvpSurveySession,
  lowerContent: string,
) {
  let bestQuestion: MvpGuideQuestion | null = null;
  let bestScore = 0;
  const cursor = furthestAskedIndex(session);

  for (const [index, question] of session.guide.entries()) {
    if (questionWasAsked(session, question)) {
      continue;
    }

    if (cursor >= 0 && index < cursor) {
      continue;
    }

    if (!questionAllowedByDiseaseLane(session, question, lowerContent)) {
      continue;
    }

    if (!questionAllowedByIntent(session, question)) {
      continue;
    }

    const matchingKeywords = question.routeKeywords.filter((keyword) =>
      lowerContent.includes(normalizeText(keyword)),
    );
    if (matchingKeywords.length === 0) {
      continue;
    }

    const specificStudyBoost =
      (lowerContent.includes("sequoia") && question.id === "sequoia") ||
      (lowerContent.includes("alpine") && question.id === "alpine") ||
      (lowerContent.includes("aspen") && question.id === "wm_aspen")
        ? 5
        : 0;
    const sourceContextBoost = question.sourceContextRequirement ? 2 : 0;
    const score =
      matchingKeywords.length + specificStudyBoost + sourceContextBoost;

    if (score > bestScore) {
      bestQuestion = question;
      bestScore = score;
    }
  }

  return bestQuestion;
}

function selectNextQuestion(
  session: MvpSurveySession,
  participantContent: string,
) {
  const remaining = remainingSeconds(session);
  const forwardUnasked = forwardUnaskedQuestions(session, participantContent);
  const fallbackUnasked = selectableQuestions(
    session,
    unaskedQuestions(session),
    participantContent,
  );
  const unasked = forwardUnasked.length ? forwardUnasked : fallbackUnasked;

  if (unasked.length === 0) {
    return null;
  }

  if (remaining <= 90) {
    return (
      unasked.find((question) => question.close) ??
      unasked[0] ??
      null
    );
  }

  const queuedQuestion = dequeueNextQuestion(session, participantContent);
  if (queuedQuestion) {
    return queuedQuestion;
  }

  const current = currentQuestion(session);
  const requiredIntakeQuestionIds = new Set([
    "intro_consent",
    "role",
    "practice_setting",
    "disease_involvement",
    "uc_involvement",
    "primary_disease_focus",
    "patient_volume",
    "familiarity",
  ]);

  if (
    current &&
    requiredIntakeQuestionIds.has(current.id) &&
    !contentLooksLikeReactiveQuestion(participantContent)
  ) {
    return forwardUnasked[0] ?? unasked[0] ?? null;
  }

  const keywordQuestion = selectQuestionForKeyword(
    session,
    normalizeText(participantContent),
  );
  return keywordQuestion ?? unasked[0] ?? null;
}

function contentLooksLikeReactiveQuestion(content: string) {
  const normalized = normalizeText(content);
  return (
    content.includes("?") ||
    /\b(explain|what is|what are|tell me|source|reference|data|study|trial|sequoia|alpine|ev302|ev 302|keynote a39|keynote-a39|ev301|ev 301|ev201|ev 201|safety)\b/.test(
      normalized,
    ) ||
    /\b(guide|checklist|resource|resources|how to handle|how do i handle|manage|management|continuum|monitor|monitoring|intervene|intervention)\b/.test(
      normalized,
    ) ||
    contentLooksLikePatientPopulationQuestion(content)
  );
}

function contentLooksLikePatientPopulationQuestion(content: string) {
  const normalized = normalizeText(content);

  return (
    /\b(appropriate patient|patient population|patient populations|patient type|patient types|inclusion|exclusion|exclude|gene mutation|mutation|tp53|del17p|del 17p|comorbid|comorbidity|high risk|side effect|adverse|neuropathy|diabetes|renal|cisplatin)\b/.test(
      normalized,
    ) &&
    /\b(who|which|what|patient|population|appropriate|exclusion|inclusion|mutation|risk|caution|avoid)\b/.test(
      normalized,
    )
  );
}

function contentLooksLikeSurveyStop(content: string) {
  const normalized = normalizeText(content);

  return /\b(no other questions|no more questions|nothing else|that is all|that s all|done|end survey|stop survey|finish)\b/.test(
    normalized,
  );
}

function contentLooksLikePadcevSafetyQuestion(content: string) {
  const normalized = normalizeText(content);

  return /\b(safety|tolerability|adverse|side effect|side effects|toxicity|neuropathy|peripheral neuropathy|rash|skin|hyperglycemia|pneumonitis|ild|ocular|dose interruption|dose reduction|dose modification|manage|management|intervene|intervention|monitor|monitoring)\b/.test(
    normalized,
  );
}

function areaTerms(area: DiseaseArea) {
  return {
    cll: ["cll", "sll", "chronic lymphocytic", "small lymphocytic", "sequoia", "alpine"],
    wm: ["wm", "waldenstrom", "aspen"],
    mcl: ["mcl", "mantle cell"],
    mzl: ["mzl", "marginal zone", "magnolia"],
    fl: ["fl", "follicular", "rosewood"],
  }[area];
}

function referenceText(reference: GroundedReference) {
  return normalizeText(
    [
      reference.title,
      reference.description,
      reference.url,
      reference.citationId,
    ]
      .filter((value): value is string => Boolean(value))
      .join(" "),
  );
}

function referenceMentionsArea(reference: GroundedReference, area: DiseaseArea) {
  const text = referenceText(reference);
  return areaTerms(area).some((term) =>
    text.includes(normalizeText(term)),
  );
}

function isClearlyOffLaneReference(
  reference: GroundedReference,
  allowedAreas: DiseaseArea[],
) {
  const allAreas: DiseaseArea[] = ["cll", "wm", "mcl", "mzl", "fl"];
  const disallowedAreas = allAreas.filter(
    (area) => !allowedAreas.includes(area),
  );

  const mentionsAllowedArea = allowedAreas.some((area) =>
    referenceMentionsArea(reference, area),
  );
  const mentionsDisallowedArea = disallowedAreas.some((area) =>
    referenceMentionsArea(reference, area),
  );

  return mentionsDisallowedArea && !mentionsAllowedArea;
}

function selectedQuestionAllowsCrossDiseaseReferences(
  selectedQuestion: MvpGuideQuestion | null,
) {
  return Boolean(
    selectedQuestion &&
      ["breadth", "accelerated_approval_indolent"].includes(selectedQuestion.id),
  );
}

function filterReferencesForDiseaseLane(input: {
  session: MvpSurveySession;
  selectedQuestion: MvpGuideQuestion | null;
  content: string;
  references: GroundedReference[];
}) {
  const allowedAreas = preferredDiseaseAreas(input.session);

  if (
    allowedAreas.length === 0 ||
    selectedQuestionAllowsCrossDiseaseReferences(input.selectedQuestion)
  ) {
    return {
      content: input.content,
      references: input.references,
      droppedReferences: [] as GroundedReference[],
    };
  }

  const keptReferences: GroundedReference[] = [];
  const droppedReferences: GroundedReference[] = [];
  const markerMap = new Map<number, number>();

  input.references.forEach((reference, index) => {
    if (isClearlyOffLaneReference(reference, allowedAreas)) {
      droppedReferences.push(reference);
      return;
    }

    keptReferences.push(reference);
    markerMap.set(index + 1, keptReferences.length);
  });

  if (droppedReferences.length === 0) {
    return {
      content: input.content,
      references: input.references,
      droppedReferences,
    };
  }

  const content = input.content
    .replace(/\[(\d{1,2})\]/g, (marker, rawIndex: string) => {
      const replacement = markerMap.get(Number(rawIndex));
      return replacement ? `[${replacement}]` : "";
    })
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return {
    content,
    references: keptReferences,
    droppedReferences,
  };
}

function containsAnyWord(content: string, words: string[]) {
  const normalized = ` ${normalizeText(content)} `;
  return words.some((word) => normalized.includes(` ${normalizeText(word)} `));
}

function hasAgreement(content: string) {
  return containsAnyWord(content, [
    "yes",
    "yeah",
    "yep",
    "sure",
    "ok",
    "okay",
    "fine",
    "ready",
    "agree",
    "begin",
    "proceed",
    "absolutely",
  ]);
}

function hasClinicalRole(content: string) {
  return containsAnyWord(content, [
    "physician",
    "doctor",
    "oncologist",
    "hematologist",
    "nurse",
    "np",
    "pa",
    "pharmacist",
    "provider",
    "clinician",
    "fellow",
    "resident",
    "medical director",
    "advanced practice",
    "nurse practitioner",
    "physician assistant",
  ]);
}

function hasPracticeSetting(content: string) {
  return containsAnyWord(content, [
    "community",
    "academic",
    "hospital",
    "clinic",
    "private",
    "group",
    "practice",
    "cancer center",
    "idn",
    "integrated",
    "health system",
    "university",
    "institution",
    "office",
    "specialty pharmacy",
  ]);
}

function hasPatientVolume(content: string) {
  const numberWordPattern =
    /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty|hundred)\b/i;

  return (
    /\b\d+\b/.test(content) ||
    numberWordPattern.test(content) ||
    containsAnyWord(content, [
      "zero",
      "none",
      "few",
      "several",
      "dozen",
      "about",
      "around",
      "under",
      "over",
      "monthly",
      "month",
      "patients",
    ])
  );
}

function hasFamiliaritySignal(content: string) {
  return containsAnyWord(content, [
    "familiar",
    "aware",
    "know",
    "used",
    "use",
    "prescribe",
    "recommend",
    "support",
    "low",
    "moderate",
    "high",
    "limited",
    "somewhat",
    "very",
    "new",
    "not",
  ]);
}

function answerHasEnoughOpenEndedContent(content: string) {
  const meaningfulTokens = normalizedTokens(content).filter(
    (token) =>
      token.length > 2 &&
      ![
        "yes",
        "yeah",
        "yep",
        "ok",
        "okay",
        "sure",
        "fine",
        "the",
        "and",
        "that",
        "this",
      ].includes(token),
  );

  return meaningfulTokens.length >= 3;
}

function answerMatchesQuestionRouteKeyword(
  question: MvpGuideQuestion,
  content: string,
) {
  const normalizedAnswer = normalizeText(content);
  const answerTokens = normalizedTokens(content);

  if (normalizedAnswer.length < 3 || answerTokens.length > 6) {
    return false;
  }

  return question.routeKeywords.some((keyword) => {
    const normalizedKeyword = normalizeText(keyword);
    return (
      normalizedKeyword.length >= 3 &&
      (normalizedAnswer === normalizedKeyword ||
        normalizedAnswer.includes(normalizedKeyword) ||
        normalizedKeyword.includes(normalizedAnswer))
    );
  });
}

function answerMatchesCurrentQuestion(
  question: MvpGuideQuestion,
  content: string,
) {
  switch (question.id) {
    case "intro_consent":
      return hasAgreement(content) && normalizedTokens(content).length <= 8;
    case "role":
      return hasClinicalRole(content);
    case "practice_setting":
      return hasPracticeSetting(content);
    case "disease_involvement":
    case "primary_disease_focus":
      return extractDiseaseAreas(content).length > 0;
    case "patient_volume":
      return hasPatientVolume(content);
    case "familiarity":
      return hasFamiliaritySignal(content);
    default:
      return (
        extractDiseaseAreas(content).length > 0 ||
        hasPatientVolume(content) ||
        answerMatchesQuestionRouteKeyword(question, content) ||
        answerHasEnoughOpenEndedContent(content)
      );
  }
}

function currentAnswerQuality(
  session: MvpSurveySession,
  content: string,
): { accepted: true } | { accepted: false; message: string } {
  const current = currentQuestion(session);

  if (transcriptLooksNonEnglishOrGarbled(content)) {
    return {
      accepted: false,
      message: [
        "I may have misheard that as non-English or unclear speech.",
        current
          ? `Please answer this question in English: ${current.canonicalQuestion}`
          : "Please try that answer again in English.",
      ].join("\n\n"),
    };
  }

  if (!current || contentLooksLikeReactiveQuestion(content)) {
    return { accepted: true };
  }

  if (answerMatchesCurrentQuestion(current, content)) {
    return { accepted: true };
  }

  return {
    accepted: false,
    message: [
      "I may not have captured an answer to that question.",
      `Could you answer this directly: ${current.canonicalQuestion}`,
    ].join("\n\n"),
  };
}

function sourceContextForQuestion(question: MvpGuideQuestion | null) {
  if (!question) {
    return null;
  }

  if (question.sourceContextRequirement) {
    return question.sourceContextRequirement;
  }

  if (/sequoia/i.test(question.canonicalQuestion)) {
    return "Before asking the SEQUOIA reaction question, briefly summarize what SEQUOIA is, the CLL/SLL setting or population described by the BRUKINSA HCP source, the relevant comparator or cohort structure if available, the key outcome or endpoint context, and any source-supported caveats needed for a fair reaction.";
  }

  if (/alpine|ibrutinib/i.test(question.canonicalQuestion)) {
    return "Before asking the ALPINE reaction question, briefly summarize what ALPINE is, the relapsed/refractory CLL/SLL setting, the head-to-head comparison with ibrutinib if supported by the source, the key outcome or endpoint context, and any source-supported caveats needed for a fair reaction.";
  }

  if (/safety|tolerability/i.test(question.canonicalQuestion)) {
    return "Before asking the safety/tolerability reaction question, briefly summarize the most relevant BRUKINSA HCP source context on safety, tolerability, warnings, and adverse-event considerations without giving patient-specific medical advice.";
  }

  if (/site|clarified|information/i.test(question.canonicalQuestion)) {
    return "Before asking what should be clarified from the HCP site, briefly orient the respondent to the relevant BRUKINSA source areas or evidence topics they can react to.";
  }

  return null;
}

function sourceContextForReactiveQuestion(
  session: MvpSurveySession,
  participantContent: string,
  selectedQuestion: MvpGuideQuestion | null,
) {
  if (!contentLooksLikeReactiveQuestion(participantContent)) {
    return null;
  }

  if (
    selectedQuestion &&
    ["breadth", "accelerated_approval_indolent"].includes(selectedQuestion.id)
  ) {
    return null;
  }

  if (session.surveySlug === "padcev") {
    const sideEffectIntent =
      session.surveyIntent?.slug === "side-effect-management";
    const selectedSafetyLaneQuestion = Boolean(
      selectedQuestion && PADCEV_SAFETY_LANE_QUESTION_IDS.has(selectedQuestion.id),
    );
    const safetyScoped =
      contentLooksLikePadcevSafetyQuestion(participantContent) ||
      selectedSafetyLaneQuestion ||
      (sideEffectIntent && contentLooksLikePatientPopulationQuestion(participantContent));

    if (safetyScoped) {
      return "The participant is in a PADCEV safety-management lane or asked a PADCEV safety-management/resource question. Answer the specific adverse-event, monitoring, management, safety-caution patient-profile, or resource angle they raised; do not provide a full label-style safety inventory. Use 2-4 focused bullets or one short paragraph. If patient profiles are discussed in this lane, frame them as safety-management caution profiles and monitoring/mitigation needs, not broad efficacy-based patient selection. Prioritize approved PADCEV HCP Important Safety Information, Prescribing Information, the PADCEV dose-modifications page, dosing/administration guide, Adverse Reactions Monitoring Checklist, adverse-reaction management guides, and the PADCEV Peripheral Neuropathy Informational Resource if available in the indexed sources. If the participant asks for a guide, checklist, continuum, operational aid, or how to handle adverse events, cite the source page most likely to expose that guide/checklist/PDF rather than a generic efficacy page. For neuropathy, rash/skin reactions, hyperglycemia, pneumonitis/ILD, ocular disorders, and other adverse events, include only source-supported monitoring, dose interruption, dose reduction, discontinuation, counseling, or supportive-care guidance for the relevant topic. For peripheral neuropathy specifically, look for source-supported grade-based dose modification guidance before saying the source lacks intervention detail. If the source does not provide a detailed stepwise intervention algorithm, say that plainly while still summarizing the source-supported management steps. Do not use or cite efficacy/PFS/OS pages or display efficacy graphs unless the participant also asks about efficacy or risk-benefit.";
    }

    return "The participant asked a source/detail question during the PADCEV urothelial cancer survey. Answer using only approved PADCEV HCP source material, including indication/positioning, EV-302/KEYNOTE-A39, EV-301/EV-201, safety, dosing/administration, patient fit, and access/support only where relevant to the participant's question. Then return to the selected survey question. Do not provide patient-specific treatment advice.";
  }

  const explicitlyRequestedAreas = extractDiseaseAreas(participantContent);
  const scopedAreas = explicitlyRequestedAreas.length
    ? explicitlyRequestedAreas
    : preferredDiseaseAreas(session);

  if (scopedAreas.length === 0) {
    return null;
  }

  const lane = scopedAreas.map(diseaseAreaLabel).join(", ");
  const patientPopulationQuestion =
    contentLooksLikePatientPopulationQuestion(participantContent);

  if (patientPopulationQuestion && scopedAreas.includes("cll")) {
    return `The participant is asking about appropriate patient populations, gene-mutation considerations, exclusions/inclusions, or side-effect risk in the active CLL/SLL lane. Answer using only approved BRUKINSA HCP CLL/SLL source material plus general Important Safety Information when directly relevant. Include CLL/SLL labeled indication, SEQUOIA/ALPINE patient-population context if supported, del(17p)/TP53 context if supported, high-risk safety considerations, and any source-supported caveats. Do not cite or summarize WM, MCL, MZL, or FL pages unless the participant explicitly asks to compare those disease areas.`;
  }

  if (explicitlyRequestedAreas.length > 0) {
    return `The participant explicitly asked for source detail in ${lane}. Answer using approved BRUKINSA HCP source material for ${lane}, then return to the selected survey question.`;
  }

  return `The participant asked a broad source/detail question without naming a new disease area. Treat it as scoped to the active disease lane (${lane}). For broad prompts such as "what's new," answer only with approved BRUKINSA HCP source material relevant to ${lane}; do not answer from or cite other disease pages unless the selected survey question explicitly requires cross-disease breadth.`;
}

function combineSourceContextRequirements(
  questionRequirement: string | null,
  reactiveRequirement: string | null,
) {
  const combined = [reactiveRequirement, questionRequirement]
    .filter(Boolean)
    .join(" ");

  return combined || null;
}

function questionTokenMatchCount(answer: string, question: string) {
  const answerText = normalizeText(answer);
  const tokens = normalizeText(question)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 5 &&
        !["about", "would", "which", "think", "today", "adult"].includes(
          token,
        ),
    );
  return tokens.filter((token) => answerText.includes(token)).length;
}

function answerProbablyContainsQuestion(answer: string, question: string) {
  const tokenCount = normalizeText(question)
    .split(" ")
    .filter(
      (token) =>
        token.length >= 5 &&
        !["about", "would", "which", "think", "today", "adult"].includes(
          token,
        ),
    ).length;
  return questionTokenMatchCount(answer, question) >= Math.min(3, tokenCount);
}

function answerMentionsQuestionSpecificSignal(
  answer: string,
  question: MvpGuideQuestion,
) {
  const signalsByQuestionId: Record<string, string[]> = {
    evidence_overview: ["data", "evidence", "study", "trial"],
    cll_guideline_positioning: ["guideline", "guidelines", "nccn", "preferred"],
    sequoia: ["sequoia"],
    sequoia_patient_fit: ["first line", "frontline", "patient type"],
    alpine: ["alpine", "ibrutinib", "head to head"],
    cll_safety_tolerability: ["cll safety", "tolerability", "risk benefit"],
    wm_aspen: ["aspen", "waldenstrom"],
    accelerated_approval_indolent: ["accelerated approval", "mcl", "mzl", "fl"],
    support_resources: ["support resources", "mybeone", "access"],
    indication_positioning: ["indication", "first line", "combination", "monotherapy"],
    ev302: ["ev 302", "ev302", "keynote a39", "overall survival", "progression free"],
    patient_fit: ["patient population", "patient type", "patient fit", "cisplatin", "neuropathy"],
    monotherapy_evidence: ["monotherapy", "ev 301", "ev301", "ev 201", "ev201"],
    safety: ["safety", "neuropathy", "skin", "hyperglycemia", "pneumonitis"],
    dosing_admin: ["dosing", "administration", "infusion", "schedule"],
    support_barriers: ["barrier", "monitoring", "access", "support"],
  };
  const signals = signalsByQuestionId[question.id] ?? [];

  return signals.some((signal) =>
    ` ${normalizeText(answer)} `.includes(` ${normalizeText(signal)} `),
  );
}

function findQuestionAskedByAnswer(
  session: MvpSurveySession,
  answer: string,
  preferredQuestion: MvpGuideQuestion | null,
) {
  if (
    preferredQuestion &&
    (answerProbablyContainsQuestion(answer, preferredQuestion.canonicalQuestion) ||
      answerMentionsQuestionSpecificSignal(answer, preferredQuestion))
  ) {
    return preferredQuestion;
  }

  const directlySignaledQuestion = unaskedQuestions(session).find((question) =>
    answerMentionsQuestionSpecificSignal(answer, question),
  );
  if (directlySignaledQuestion) {
    return directlySignaledQuestion;
  }

  let bestQuestion: MvpGuideQuestion | null = null;
  let bestScore = 0;

  for (const question of unaskedQuestions(session)) {
    const score = questionTokenMatchCount(answer, question.canonicalQuestion);
    if (score > bestScore && answerProbablyContainsQuestion(answer, question.canonicalQuestion)) {
      bestQuestion = question;
      bestScore = score;
    }
  }

  return bestQuestion;
}

function ensureReturnToSurvey(answer: string, selectedQuestion: string | null) {
  if (!selectedQuestion || answerProbablyContainsQuestion(answer, selectedQuestion)) {
    return answer.trim();
  }

  return `${answer.trim()}\n\nReturning to the survey: ${selectedQuestion}`;
}

function fallbackInterviewerTurn(input: {
  selectedQuestion: string | null;
  customGptReason: string;
  sourceContextRequirement: string | null;
  sourceBrand: string;
}) {
  if (!input.selectedQuestion) {
    return "Thanks, that gives us enough to close this MVP pass.";
  }

  const setupIssue =
    input.customGptReason.includes("CUSTOMGPT_API_KEY") ||
    input.customGptReason.includes("CUSTOMGPT_PROJECT_ID");

  return [
    setupIssue
      ? `CustomGPT is not connected in this local environment yet (${input.customGptReason}).`
      : `CustomGPT could not complete this turn (${input.customGptReason}).`,
    `In the live bridge, this turn would answer from the ${input.sourceBrand} HCP source material with references and then continue.`,
    input.sourceContextRequirement
      ? `This turn requires source context first: ${input.sourceContextRequirement}`
      : null,
    `For now, the guarded survey flow continues here: ${input.selectedQuestion}`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function surveyContext(
  session: MvpSurveySession,
  selectedQuestion: MvpGuideQuestion | null,
  sourceContextRequirement: string | null,
) {
  const current = currentQuestion(session);
  const selectedQuestionText = questionText(selectedQuestion);
  const upcomingQuestions = selectableQuestions(session, unaskedQuestions(session))
    .filter((question) => question.id !== selectedQuestion?.id)
    .slice(0, 4)
    .map((question) => `${question.id}: ${question.canonicalQuestion}`)
    .join(" | ");
  const currentModule = current?.module ?? "none";
  const selectedModule = selectedQuestion?.module ?? "none";
  const activeDiseaseLane = preferredDiseaseAreas(session)
    .map(diseaseAreaLabel)
    .join(", ");
  const queuedModules = session.queuedQuestionIds
    .map((questionId) => questionById(session, questionId))
    .filter((question): question is MvpGuideQuestion => Boolean(question))
    .map((question) => `${question.id}: ${question.module}`)
    .join(" | ");

  return [
    `Study: ${session.studyName}`,
    "Mode: CustomGPT-first adaptive medical market research MVP.",
    `Approved source brand: ${session.sourceBrand}.`,
    session.surveyIntent
      ? `Selected survey intention: ${session.surveyIntent.label}. ${session.surveyIntent.primaryIntent}`
      : "Selected survey intention: default guide.",
    session.surveyIntent
      ? `Intention steering rule: ${session.surveyIntent.steeringRule}`
      : null,
    session.surveyIntent?.allowedQuestionIds?.length
      ? `Intent-allowed question ids: ${session.surveyIntent.allowedQuestionIds.join(" | ")}`
      : null,
    session.surveyIntent?.blockedQuestionIds?.length
      ? `Intent-blocked question ids unless respondent explicitly asks off-lane: ${session.surveyIntent.blockedQuestionIds.join(" | ")}`
      : null,
    session.surveyIntent?.offLaneSourceRule
      ? `Intent off-lane source rule: ${session.surveyIntent.offLaneSourceRule}`
      : null,
    session.surveyIntent?.requiredCoverage.length
      ? `Required intent coverage: ${session.surveyIntent.requiredCoverage.join(" | ")}`
      : null,
    "Controller guardrails: answer reactive source questions once, return to the survey, do not repeat asked questions, respect the timebox, and do not pivot into disease modules outside the active lane unless the participant explicitly asks.",
    activeDiseaseLane
      ? `Active disease lane: ${activeDiseaseLane}.`
      : "Active disease lane: not established yet.",
    activeDiseaseLane
      ? `Broad reactive source questions are scoped to ${activeDiseaseLane}; do not answer from or cite other disease pages unless the participant explicitly names them or the selected module requires cross-disease comparison.`
      : null,
    sourceContextRequirement
      ? `Source-context requirement for this turn: ${sourceContextRequirement}`
      : "Source-context requirement for this turn: none.",
    `Current module: ${currentModule}`,
    `Selected next module: ${selectedModule}`,
    queuedModules
      ? `Queued respondent-priority modules after this turn: ${queuedModules}`
      : "Queued respondent-priority modules after this turn: none.",
    current
      ? `Current question: ${current.canonicalQuestion}`
      : "Current question: none.",
    selectedQuestionText
      ? `Selected next question: ${selectedQuestionText}`
      : "Selected next question: none; close.",
    askedQuestions(session).length
      ? `Already asked: ${askedQuestions(session).join(" | ")}`
      : "Already asked: none.",
    upcomingQuestions ? `Upcoming unasked guide preview: ${upcomingQuestions}` : null,
  ].join("\n");
}

function voicePromptContextForSession(session: MvpSurveySession | null) {
  const current = session ? currentQuestion(session) : null;

  if (!current) {
    return null;
  }

  const expectedAnswer =
    current.id === "disease_involvement" || current.id === "primary_disease_focus"
      ? "Expected answer may be a short list of B-cell malignancy abbreviations, such as CLL, SLL, MCL, MZL, FL, or WM. Preserve those abbreviations exactly."
      : current.id === "role"
        ? "Expected answer may be a short clinical role, such as physician, oncologist, hematologist, pharmacist, NP, or PA."
        : current.id === "practice_setting"
          ? "Expected answer may be a short practice setting, such as community oncology practice, academic center, hospital, IDN, or specialty pharmacy."
          : null;

  return [
    `Current survey question: ${current.canonicalQuestion}`,
    expectedAnswer,
  ]
    .filter(Boolean)
    .join(" ");
}

function responseForSession(
  session: MvpSurveySession,
  nextActionOverride?: MvpCustomGptSurveyResponse["nextAction"],
) {
  const remaining = remainingSeconds(session);
  const missingReason = customGptMissingReason(session.projectId);
  const customGptEnabled = !missingReason;
  const completed = Boolean(session.completedReason);
  const status = completed ? "completed" : customGptEnabled ? "active" : "needs_setup";
  const nextAction =
    nextActionOverride ??
    (completed
      ? "wrap_up"
      : customGptEnabled
        ? "ask"
        : "setup_required");
  const reason =
    session.completedReason ?? (customGptEnabled ? null : missingReason);

  return mvpCustomGptSurveyResponseSchema.parse({
    sessionId: session.sessionId,
    studyName: session.studyName,
    status,
    projectId: session.projectId,
    startedAt: session.startedAt.toISOString(),
    elapsedSeconds: elapsedSeconds(session),
    remainingSeconds: remaining,
    targetDurationSeconds: session.targetDurationSeconds,
    turnCount: session.turnCount,
    askedQuestions: askedQuestions(session),
    currentQuestion: questionText(currentQuestion(session)),
    nextAction,
    customGptEnabled,
    reason,
    messages: session.messages,
  });
}

export function resetMvpCustomGptSurveySessions() {
  sessions.clear();
}

export function startMvpCustomGptSurvey(input: MvpCustomGptSurveyStartRequest) {
  const definition = surveyDefinitionForSlug(input.surveySlug);
  const surveyIntent = surveyIntentForSlug(
    definition,
    input.surveyIntentSlug,
  );
  const guide = input.guide?.length
    ? guideFromQuestionStrings(input.guide)
    : guideForIntent(definition, surveyIntent);
  const firstQuestion = guide[0] ?? definition.guide[0];
  const projectId = configuredProjectId(definition, input.projectId);
  const missingReason = customGptMissingReason(
    projectId,
    definition.projectIdEnvName,
  );
  const session: MvpSurveySession = {
    sessionId: randomUUID(),
    surveySlug: definition.slug,
    sourceBrand: definition.sourceBrand,
    surveyIntent,
    studyName: input.studyName ?? definition.defaultStudyName,
    projectId,
    projectIdEnvName: definition.projectIdEnvName,
    targetDurationSeconds: input.targetDurationSeconds ?? 600,
    startedAt: new Date(),
    guide,
    askedQuestionIds: [firstQuestion.id],
    currentQuestionId: firstQuestion.id,
    activeDiseaseAreas: [],
    primaryDiseaseArea: null,
    queuedQuestionIds: [],
    messages: [
      createMessage(
        "interviewer",
        missingReason
          ? [
              `CustomGPT is not connected yet (${missingReason}).`,
              `The MVP shell is ready; once the key is set, this starts here: ${firstQuestion.canonicalQuestion}`,
            ].join("\n\n")
          : firstQuestion.canonicalQuestion,
      ),
    ],
    turnCount: 0,
    completedReason: null,
  };

  sessions.set(session.sessionId, session);
  void appendMvpAuditEvent(session, {
    eventType: "session_started",
    surveySlug: session.surveySlug,
    sourceBrand: session.sourceBrand,
    surveyIntentSlug: session.surveyIntent?.slug ?? null,
    surveyIntentLabel: session.surveyIntent?.label ?? null,
    surveyIntentCoverage: session.surveyIntent?.requiredCoverage ?? [],
    projectId: session.projectId,
    targetDurationSeconds: session.targetDurationSeconds,
    currentQuestionId: session.currentQuestionId,
    currentQuestion: firstQuestion.canonicalQuestion,
    queuedQuestionIds: [...session.queuedQuestionIds],
    customGptEnabled: !missingReason,
    setupReason: missingReason,
    messages: session.messages,
  });
  return responseForSession(session);
}

export async function submitMvpCustomGptSurveyTurn(
  input: MvpCustomGptSurveyTurnRequest,
) {
  const session = sessions.get(input.sessionId);
  if (!session) {
    throw new Error("MVP survey session was not found.");
  }

  if (session.completedReason) {
    return responseForSession(session, "wrap_up");
  }

  const currentQuestionBefore = currentQuestion(session);
  session.messages.push(createMessage("participant", input.content));
  session.turnCount += 1;

  const answerQuality = currentAnswerQuality(session, input.content);
  if (!answerQuality.accepted) {
    session.messages.push(createMessage("interviewer", answerQuality.message));
    void appendMvpAuditEvent(session, {
      eventType: "turn_rejected",
      participantMessage: input.content,
      currentQuestionBefore: currentQuestionBefore?.canonicalQuestion ?? null,
      surveyIntentSlug: session.surveyIntent?.slug ?? null,
      activeDiseaseAreas: [...session.activeDiseaseAreas],
      primaryDiseaseArea: session.primaryDiseaseArea,
      rejectionReason: answerQuality.message,
      assistantMessage: answerQuality.message,
      nextAction: "ask",
    });
    return responseForSession(session, "ask");
  }

  updateDiseaseStateFromParticipant(session, input.content);
  queuePriorityFollowUps(session, currentQuestionBefore, input.content);

  if (currentQuestionBefore?.close || contentLooksLikeSurveyStop(input.content)) {
    session.completedReason = currentQuestionBefore?.close
      ? "Closing question answered."
      : "Participant ended the survey.";
    session.currentQuestionId = null;
    const assistantContent =
      "Thank you, that gives us enough to close this MVP pass.";
    session.messages.push(createMessage("interviewer", assistantContent));
    appendMvpAuditEvent(session, {
      eventType: "turn_completed",
      participantMessage: input.content,
      currentQuestionBefore: currentQuestionBefore?.canonicalQuestion ?? null,
      surveyIntentSlug: session.surveyIntent?.slug ?? null,
      selectedQuestionId: null,
      selectedQuestion: null,
      actualAskedQuestionId: null,
      actualAskedQuestion: null,
      currentQuestionAfter: null,
      sourceContextRequirement: null,
      activeDiseaseAreas: [...session.activeDiseaseAreas],
      primaryDiseaseArea: session.primaryDiseaseArea,
      queuedQuestionIds: [...session.queuedQuestionIds],
      needsCustomGpt: false,
      customGptStatus: "not_needed",
      customGptReason: null,
      droppedReferences: [],
      assistantMessage: assistantContent,
      references: [],
      nextAction: "wrap_up",
      remainingSeconds: remainingSeconds(session),
      completedReason: session.completedReason,
    });
    return responseForSession(session, "wrap_up");
  }

  const selectedQuestion = selectNextQuestion(session, input.content);
  const questionSourceContextRequirement = sourceContextForQuestion(selectedQuestion);
  const sourceContextRequirement = combineSourceContextRequirements(
    questionSourceContextRequirement,
    sourceContextForReactiveQuestion(session, input.content, selectedQuestion),
  );
  const selectedQuestionText = questionText(selectedQuestion);
  let actualAskedQuestion = selectedQuestion;
  const missingReason = customGptMissingReason(
    session.projectId,
    session.projectIdEnvName,
  );
  const remaining = remainingSeconds(session);
  const needsCustomGpt =
    Boolean(sourceContextRequirement) ||
    contentLooksLikeReactiveQuestion(input.content);

  let assistantContent: string;
  let references: GroundedReference[] = [];
  let customGptStatus = needsCustomGpt ? "pending" : "not_needed";
  let customGptReason: string | null = null;
  let droppedReferences: GroundedReference[] = [];
  let nextAction: MvpCustomGptSurveyResponse["nextAction"] =
    needsCustomGpt ? "answer_then_ask" : "ask";

  if (remaining === 0 || !selectedQuestion) {
    session.completedReason =
      remaining === 0 ? "Timebox reached." : "Guide questions completed.";
    assistantContent =
      "Thanks, that gives us enough for this MVP pass. We can stop there.";
    customGptStatus = "not_needed";
    nextAction = "wrap_up";
  } else if (!needsCustomGpt) {
    assistantContent = selectedQuestionText ?? "Thanks, let's continue.";
    customGptStatus = "not_needed";
    nextAction = "ask";
  } else if (missingReason) {
    assistantContent = fallbackInterviewerTurn({
      selectedQuestion: selectedQuestionText,
      customGptReason: missingReason,
      sourceContextRequirement,
      sourceBrand: session.sourceBrand,
    });
    customGptStatus = "skipped_setup";
    customGptReason = missingReason;
    nextAction = "setup_required";
  } else {
    try {
      const customGptTurn = await askCustomGptForSurveyInterviewerTurn({
        projectId: session.projectId,
        participantMessage: input.content,
        surveyContext: surveyContext(
          session,
          selectedQuestion,
          sourceContextRequirement,
        ),
        currentQuestion: questionText(currentQuestion(session)),
        selectedNextQuestion: selectedQuestionText,
        selectedQuestionSourceContext: sourceContextRequirement,
        recentInterviewerContext: recentInterviewerSourceContext(session),
        remainingSeconds: remaining,
        askedQuestions: askedQuestions(session),
      });

      if (!customGptTurn.enabled || !customGptTurn.answer) {
        customGptStatus = "fallback";
        customGptReason = customGptTurn.reason ?? "CustomGPT was unavailable.";
        assistantContent = fallbackInterviewerTurn({
          selectedQuestion: selectedQuestionText,
          customGptReason,
          sourceContextRequirement,
          sourceBrand: session.sourceBrand,
        });
        nextAction = "setup_required";
      } else {
        customGptStatus = "success";
        actualAskedQuestion =
          findQuestionAskedByAnswer(session, customGptTurn.answer, selectedQuestion) ??
          selectedQuestion;
        assistantContent = ensureReturnToSurvey(
          customGptTurn.answer,
          questionText(actualAskedQuestion),
        );
        references = customGptTurn.references;
        const filtered = filterReferencesForDiseaseLane({
          session,
          selectedQuestion: actualAskedQuestion,
          content: assistantContent,
          references,
        });
        assistantContent = filtered.content;
        references = filtered.references;
        droppedReferences = filtered.droppedReferences;
      }
    } catch (error) {
      customGptStatus = "error";
      customGptReason =
        error instanceof Error ? error.message : "CustomGPT request failed.";
      assistantContent = fallbackInterviewerTurn({
        selectedQuestion: selectedQuestionText,
        customGptReason,
        sourceContextRequirement,
        sourceBrand: session.sourceBrand,
      });
      nextAction = "setup_required";
    }
  }

  session.messages.push(createMessage("interviewer", assistantContent, references));

  if (actualAskedQuestion && !session.completedReason) {
    session.queuedQuestionIds = session.queuedQuestionIds.filter(
      (questionId) => questionId !== actualAskedQuestion.id,
    );
    session.askedQuestionIds.push(actualAskedQuestion.id);
    session.currentQuestionId = actualAskedQuestion.id;
  } else if (session.completedReason) {
    session.currentQuestionId = null;
  }

  void appendMvpAuditEvent(session, {
    eventType: "turn_completed",
    participantMessage: input.content,
    currentQuestionBefore: currentQuestionBefore?.canonicalQuestion ?? null,
    surveyIntentSlug: session.surveyIntent?.slug ?? null,
    selectedQuestionId: selectedQuestion?.id ?? null,
    selectedQuestion: selectedQuestionText,
    actualAskedQuestionId: actualAskedQuestion?.id ?? null,
    actualAskedQuestion: questionText(actualAskedQuestion),
    currentQuestionAfter: questionText(currentQuestion(session)),
    sourceContextRequirement,
    activeDiseaseAreas: [...session.activeDiseaseAreas],
    primaryDiseaseArea: session.primaryDiseaseArea,
    queuedQuestionIds: [...session.queuedQuestionIds],
    needsCustomGpt,
    customGptStatus,
    customGptReason,
    droppedReferences: droppedReferences.map((reference) => ({
      citationId: reference.citationId,
      title: reference.title,
      url: reference.url,
    })),
    assistantMessage: assistantContent,
    references: references.map((reference) => ({
      citationId: reference.citationId,
      title: reference.title,
      url: reference.url,
    })),
    nextAction,
    remainingSeconds: remainingSeconds(session),
    completedReason: session.completedReason,
  });

  return responseForSession(session, nextAction);
}

export async function submitMvpCustomGptSurveyVoiceTurn(
  input: MvpCustomGptSurveyVoiceTurnRequest,
) {
  const session = sessions.get(input.sessionId) ?? null;
  const audioBuffer = decodeAudio(input);
  const transcript = await transcribeAudio({
    audioBuffer,
    mimeType: input.mimeType,
    promptContext: voicePromptContextForSession(session),
  });
  const survey = await submitMvpCustomGptSurveyTurn({
    sessionId: input.sessionId,
    content: transcript,
  });
  const updatedSession = sessions.get(input.sessionId);
  const spokenText = updatedSession
    ? cleanTextForSpeech(latestInterviewerMessage(updatedSession)?.content ?? "")
    : null;
  const audio = spokenText ? await synthesizeSpeech(spokenText, input.voice) : null;

  return mvpCustomGptSurveyVoiceTurnResponseSchema.parse({
    transcript,
    spokenText,
    audio,
    survey,
  });
}

export async function transcribeMvpCustomGptSurveyVoice(
  input: MvpCustomGptSurveyVoiceTranscribeRequest,
) {
  const session = input.sessionId ? (sessions.get(input.sessionId) ?? null) : null;
  const audioBuffer = decodeAudio(input);
  const transcript = await transcribeAudio({
    audioBuffer,
    mimeType: input.mimeType,
    promptContext: voicePromptContextForSession(session),
  });

  if (session) {
    const answerQuality = currentAnswerQuality(session, transcript);
    if (!answerQuality.accepted) {
      throw new Error(
        `I heard "${transcript}", but it does not look like an answer to the current question. Please try again or type the answer.`,
      );
    }
  }

  return mvpCustomGptSurveyVoiceTranscribeResponseSchema.parse({
    transcript,
  });
}

export async function synthesizeMvpCustomGptSurveyLatestInterviewer(
  input: MvpCustomGptSurveySpeechRequest,
) {
  const session = sessions.get(input.sessionId);
  if (!session) {
    throw new Error("MVP survey session was not found.");
  }

  const spokenText = cleanTextForSpeech(
    latestInterviewerMessage(session)?.content ?? "",
  );
  const audio = spokenText ? await synthesizeSpeech(spokenText, input.voice) : null;

  return mvpCustomGptSurveySpeechResponseSchema.parse({
    spokenText: spokenText || null,
    audio,
  });
}
