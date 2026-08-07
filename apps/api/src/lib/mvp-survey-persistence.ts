import {
  DecisionKind,
  DecisionStatus,
  SessionStatus,
  TurnRole,
  type Prisma,
} from "@prisma/client";
import type {
  GroundedReference,
  MvpCustomGptSurveyMessage,
} from "@interview/schemas";
import { prisma } from "./prisma";
import type { MvpTurnRouteDecision } from "./mvp-turn-router";

export type MvpPersistenceSessionSnapshot = {
  sessionId: string;
  surveySlug: string;
  sourceBrand: string;
  studyName: string;
  surveyIntentSlug: string | null;
  surveyIntentLabel: string | null;
  surveyIntentCoverage: string[];
  projectId: string | null;
  projectIdEnvName: string;
  targetDurationSeconds: number;
  startedAt: Date;
  currentQuestionId: string | null;
  currentQuestion: string | null;
  pendingReturnQuestionId: string | null;
  activeDiseaseAreas: string[];
  primaryDiseaseArea: string | null;
  queuedQuestionIds: string[];
  excursionQuestionIds: string[];
  askedQuestionIds: string[];
  adaptiveProbeQuestions: unknown[];
  completedReason: string | null;
};

type MvpTurnAuditInput = {
  eventType: "turn_completed" | "turn_rejected";
  participantMessage: string;
  assistantMessage: string;
  sequenceBase: number;
  currentQuestionBefore: string | null;
  selectedQuestionId?: string | null;
  selectedQuestion?: string | null;
  actualAskedQuestionId?: string | null;
  actualAskedQuestion?: string | null;
  currentQuestionAfter?: string | null;
  sourceContextRequirement?: string | null;
  turnRouteDecision?: MvpTurnRouteDecision | null;
  turnRouteAnalysis?: Record<string, unknown> | null;
  needsCustomGpt?: boolean;
  customGptStatus?: string | null;
  customGptReason?: string | null;
  sourceProvider?: string | null;
  sourceProviderShadow?: Record<string, unknown> | null;
  sourceResponseMode?: "answer_only" | "answer_then_ask" | null;
  droppedReferences?: Array<
    Pick<GroundedReference, "citationId" | "title" | "url">
  >;
  references?: Array<Pick<GroundedReference, "citationId" | "title" | "url">>;
  nextAction: string;
  remainingSeconds: number;
  rejectionReason?: string | null;
  completedReason?: string | null;
};

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

function dbAuditEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

function studySlugForMvpSurvey(surveySlug: string) {
  return `mvp-customgpt-${surveySlug}`;
}

function metadataForSession(
  session: MvpPersistenceSessionSnapshot,
): Prisma.InputJsonObject {
  return {
    runtime: "mvp-customgpt-survey",
    surveySlug: session.surveySlug,
    sourceBrand: session.sourceBrand,
    surveyIntentSlug: session.surveyIntentSlug,
    surveyIntentLabel: session.surveyIntentLabel,
    surveyIntentCoverage: session.surveyIntentCoverage,
    projectId: session.projectId,
    projectIdEnvName: session.projectIdEnvName,
    targetDurationSeconds: session.targetDurationSeconds,
    currentQuestionId: session.currentQuestionId,
    currentQuestion: session.currentQuestion,
    pendingReturnQuestionId: session.pendingReturnQuestionId,
    activeDiseaseAreas: session.activeDiseaseAreas,
    primaryDiseaseArea: session.primaryDiseaseArea,
    queuedQuestionIds: session.queuedQuestionIds,
    excursionQuestionIds: session.excursionQuestionIds,
    askedQuestionIds: session.askedQuestionIds,
    adaptiveProbeQuestions: inputJson(session.adaptiveProbeQuestions),
    completedReason: session.completedReason,
  };
}

function jsonRecord(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Prisma.JsonObject)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberOrDefault(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function referencesFromPayload(
  payload: Prisma.JsonValue | null,
): GroundedReference[] {
  const record = jsonRecord(payload);
  const references = record.references;
  return Array.isArray(references)
    ? references.filter(
        (reference): reference is GroundedReference =>
          Boolean(reference) &&
          typeof reference === "object" &&
          reference !== null &&
          "citationId" in reference &&
          "title" in reference &&
          "url" in reference,
      )
    : [];
}

function messageIdFromPayload(payload: Prisma.JsonValue | null, fallback: string) {
  const record = jsonRecord(payload);
  return stringOrNull(record.messageId) ?? fallback;
}

async function ensureMvpStudy(session: MvpPersistenceSessionSnapshot) {
  return prisma.study.upsert({
    where: { slug: studySlugForMvpSurvey(session.surveySlug) },
    create: {
      slug: studySlugForMvpSurvey(session.surveySlug),
      name: session.studyName,
      description:
        "Auto-created study record for CustomGPT survey bridge beta audit.",
      status: "ACTIVE",
      config: {
        runtime: "mvp-customgpt-survey",
        surveySlug: session.surveySlug,
        sourceBrand: session.sourceBrand,
      },
    },
    update: {
      name: session.studyName,
      status: "ACTIVE",
      config: {
        runtime: "mvp-customgpt-survey",
        surveySlug: session.surveySlug,
        sourceBrand: session.sourceBrand,
      },
    },
  });
}

export async function persistMvpSurveySessionStarted(input: {
  session: MvpPersistenceSessionSnapshot;
  initialMessage: MvpCustomGptSurveyMessage;
  customGptEnabled: boolean;
  setupReason: string | null;
}) {
  if (!dbAuditEnabled()) {
    return;
  }

  try {
    const study = await ensureMvpStudy(input.session);
    await prisma.$transaction([
      prisma.session.upsert({
        where: { id: input.session.sessionId },
        create: {
          id: input.session.sessionId,
          studyId: study.id,
          status: SessionStatus.ACTIVE,
          startedAt: input.session.startedAt,
          metadata: {
            ...metadataForSession(input.session),
            customGptEnabled: input.customGptEnabled,
            setupReason: input.setupReason,
          },
        },
        update: {
          studyId: study.id,
          status: SessionStatus.ACTIVE,
          startedAt: input.session.startedAt,
          metadata: {
            ...metadataForSession(input.session),
            customGptEnabled: input.customGptEnabled,
            setupReason: input.setupReason,
          },
        },
      }),
      prisma.turn.upsert({
        where: {
          sessionId_sequence: {
            sessionId: input.session.sessionId,
            sequence: 1,
          },
        },
        create: {
          studyId: study.id,
          sessionId: input.session.sessionId,
          sequence: 1,
          role: TurnRole.INTERVIEWER,
          content: input.initialMessage.content,
          payload: {
            runtime: "mvp-customgpt-survey",
            eventType: "session_started",
            messageId: input.initialMessage.id,
            references: input.initialMessage.references,
            currentQuestionId: input.session.currentQuestionId,
          },
        },
        update: {
          content: input.initialMessage.content,
          payload: {
            runtime: "mvp-customgpt-survey",
            eventType: "session_started",
            messageId: input.initialMessage.id,
            references: input.initialMessage.references,
            currentQuestionId: input.session.currentQuestionId,
          },
        },
      }),
    ]);
  } catch {
    // DB audit must not block the respondent-facing MVP survey.
  }
}

export async function persistMvpSurveyTurnAudit(input: {
  session: MvpPersistenceSessionSnapshot;
  turn: MvpTurnAuditInput;
}) {
  if (!dbAuditEnabled()) {
    return;
  }

  try {
    const study = await ensureMvpStudy(input.session);
    const sessionStatus = input.session.completedReason
      ? SessionStatus.COMPLETED
      : SessionStatus.ACTIVE;
    const participantSequence = input.turn.sequenceBase + 1;
    const interviewerSequence = input.turn.sequenceBase + 2;
    const participantPayload = {
      runtime: "mvp-customgpt-survey",
      eventType: input.turn.eventType,
      currentQuestionBefore: input.turn.currentQuestionBefore,
    } satisfies Prisma.InputJsonObject;
    const interviewerPayload = {
      runtime: "mvp-customgpt-survey",
      ...input.turn,
    } as Prisma.InputJsonObject;
    const decisionInput = {
      runtime: "mvp-customgpt-survey",
      participantMessage: input.turn.participantMessage,
      currentQuestionBefore: input.turn.currentQuestionBefore,
      sourceContextRequirement: input.turn.sourceContextRequirement,
      sourceResponseMode: input.turn.sourceResponseMode ?? null,
      turnRouteDecision: inputJson(input.turn.turnRouteDecision ?? null),
      turnRouteAnalysis: inputJson(input.turn.turnRouteAnalysis ?? null),
    } as Prisma.InputJsonObject;
    const decisionOutput = {
      selectedQuestionId: input.turn.selectedQuestionId,
      selectedQuestion: input.turn.selectedQuestion,
      actualAskedQuestionId: input.turn.actualAskedQuestionId,
      actualAskedQuestion: input.turn.actualAskedQuestion,
      nextAction: input.turn.nextAction,
      customGptStatus: input.turn.customGptStatus,
      sourceProvider: input.turn.sourceProvider ?? null,
      sourceProviderShadow: inputJson(input.turn.sourceProviderShadow ?? null),
      sourceResponseMode: input.turn.sourceResponseMode ?? null,
      references: inputJson(input.turn.references ?? []),
      droppedReferences: inputJson(input.turn.droppedReferences ?? []),
    } as Prisma.InputJsonObject;

    await prisma.$transaction([
      prisma.session.upsert({
        where: { id: input.session.sessionId },
        create: {
          id: input.session.sessionId,
          studyId: study.id,
          status: sessionStatus,
          startedAt: input.session.startedAt,
          completedAt: input.session.completedReason ? new Date() : null,
          metadata: metadataForSession(input.session),
        },
        update: {
          status: sessionStatus,
          completedAt: input.session.completedReason ? new Date() : null,
          metadata: metadataForSession(input.session),
        },
      }),
      prisma.turn.upsert({
        where: {
          sessionId_sequence: {
            sessionId: input.session.sessionId,
            sequence: participantSequence,
          },
        },
        create: {
          studyId: study.id,
          sessionId: input.session.sessionId,
          sequence: participantSequence,
          role: TurnRole.PARTICIPANT,
          content: input.turn.participantMessage,
          payload: participantPayload,
        },
        update: {
          content: input.turn.participantMessage,
          payload: participantPayload,
        },
      }),
      prisma.turn.upsert({
        where: {
          sessionId_sequence: {
            sessionId: input.session.sessionId,
            sequence: interviewerSequence,
          },
        },
        create: {
          studyId: study.id,
          sessionId: input.session.sessionId,
          sequence: interviewerSequence,
          role: TurnRole.INTERVIEWER,
          content: input.turn.assistantMessage,
          payload: interviewerPayload,
        },
        update: {
          content: input.turn.assistantMessage,
          payload: interviewerPayload,
        },
      }),
      prisma.decision.create({
        data: {
          studyId: study.id,
          sessionId: input.session.sessionId,
          kind: input.session.completedReason
            ? DecisionKind.CLOSE_SESSION
            : DecisionKind.SELECT_NEXT_QUESTION,
          status: DecisionStatus.COMPLETED,
          rationale:
            input.turn.rejectionReason ??
            input.turn.customGptReason ??
            "MVP CustomGPT survey controller selected the next action.",
          input: decisionInput,
          output: decisionOutput,
        },
      }),
    ]);
  } catch {
    // DB audit must not block the respondent-facing MVP survey.
  }
}

export async function loadMvpSurveySessionSnapshot(sessionId: string) {
  if (!dbAuditEnabled()) {
    return null;
  }

  try {
    const persisted = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        study: true,
        turns: {
          orderBy: { sequence: "asc" },
        },
      },
    });

    if (!persisted) {
      return null;
    }

    const metadata = jsonRecord(persisted.metadata);
    if (metadata.runtime !== "mvp-customgpt-survey") {
      return null;
    }

    const surveySlug = stringOrNull(metadata.surveySlug);
    const sourceBrand = stringOrNull(metadata.sourceBrand);
    if (!surveySlug || !sourceBrand) {
      return null;
    }

    const messages = persisted.turns.flatMap((turn) => {
      if (
        turn.role !== TurnRole.INTERVIEWER &&
        turn.role !== TurnRole.PARTICIPANT
      ) {
        return [];
      }

      return [
        {
          id: messageIdFromPayload(turn.payload, turn.id),
          role:
            turn.role === TurnRole.INTERVIEWER
              ? ("interviewer" as const)
              : ("participant" as const),
          content: turn.content,
          createdAt: turn.createdAt.toISOString(),
          references: referencesFromPayload(turn.payload),
        },
      ] satisfies MvpCustomGptSurveyMessage[];
    });

    const turnCount = messages.filter(
      (message) => message.role === "participant",
    ).length;

    return {
      session: {
        sessionId: persisted.id,
        surveySlug,
        sourceBrand,
        studyName:
          persisted.study?.name ??
          stringOrNull(metadata.studyName) ??
          `${sourceBrand} HCP MVP`,
        surveyIntentSlug: stringOrNull(metadata.surveyIntentSlug),
        surveyIntentLabel: stringOrNull(metadata.surveyIntentLabel),
        surveyIntentCoverage: stringArray(metadata.surveyIntentCoverage),
        projectId: stringOrNull(metadata.projectId),
        projectIdEnvName:
          stringOrNull(metadata.projectIdEnvName) ?? "CUSTOMGPT_PROJECT_ID",
        targetDurationSeconds: numberOrDefault(
          metadata.targetDurationSeconds,
          600,
        ),
        startedAt: persisted.startedAt ?? persisted.createdAt,
        currentQuestionId: stringOrNull(metadata.currentQuestionId),
        currentQuestion: stringOrNull(metadata.currentQuestion),
        pendingReturnQuestionId: stringOrNull(
          metadata.pendingReturnQuestionId,
        ),
        activeDiseaseAreas: stringArray(metadata.activeDiseaseAreas),
        primaryDiseaseArea: stringOrNull(metadata.primaryDiseaseArea),
        queuedQuestionIds: stringArray(metadata.queuedQuestionIds),
        excursionQuestionIds: stringArray(metadata.excursionQuestionIds),
        askedQuestionIds: stringArray(metadata.askedQuestionIds),
        adaptiveProbeQuestions: Array.isArray(metadata.adaptiveProbeQuestions)
          ? metadata.adaptiveProbeQuestions
          : [],
        completedReason: stringOrNull(metadata.completedReason),
      } satisfies MvpPersistenceSessionSnapshot,
      messages,
      turnCount,
    };
  } catch {
    return null;
  }
}
