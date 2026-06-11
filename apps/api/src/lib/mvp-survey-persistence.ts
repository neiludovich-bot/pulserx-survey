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

type MvpPersistenceSessionSnapshot = {
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
  activeDiseaseAreas: string[];
  primaryDiseaseArea: string | null;
  queuedQuestionIds: string[];
  excursionQuestionIds: string[];
  askedQuestionIds: string[];
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
  needsCustomGpt?: boolean;
  customGptStatus?: string | null;
  customGptReason?: string | null;
  sourceProvider?: string | null;
  sourceProviderShadow?: Record<string, unknown> | null;
  droppedReferences?: Array<
    Pick<GroundedReference, "citationId" | "title" | "url">
  >;
  references?: Array<Pick<GroundedReference, "citationId" | "title" | "url">>;
  nextAction: string;
  remainingSeconds: number;
  rejectionReason?: string | null;
  completedReason?: string | null;
};

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
    activeDiseaseAreas: session.activeDiseaseAreas,
    primaryDiseaseArea: session.primaryDiseaseArea,
    queuedQuestionIds: session.queuedQuestionIds,
    excursionQuestionIds: session.excursionQuestionIds,
    askedQuestionIds: session.askedQuestionIds,
    completedReason: session.completedReason,
  };
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
          payload: {
            runtime: "mvp-customgpt-survey",
            eventType: input.turn.eventType,
            currentQuestionBefore: input.turn.currentQuestionBefore,
          },
        },
        update: {
          content: input.turn.participantMessage,
          payload: {
            runtime: "mvp-customgpt-survey",
            eventType: input.turn.eventType,
            currentQuestionBefore: input.turn.currentQuestionBefore,
          },
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
          payload: {
            runtime: "mvp-customgpt-survey",
            ...input.turn,
          },
        },
        update: {
          content: input.turn.assistantMessage,
          payload: {
            runtime: "mvp-customgpt-survey",
            ...input.turn,
          },
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
          input: {
            runtime: "mvp-customgpt-survey",
            participantMessage: input.turn.participantMessage,
            currentQuestionBefore: input.turn.currentQuestionBefore,
            sourceContextRequirement: input.turn.sourceContextRequirement,
            turnRouteDecision: input.turn.turnRouteDecision ?? null,
          },
          output: {
            selectedQuestionId: input.turn.selectedQuestionId,
            selectedQuestion: input.turn.selectedQuestion,
            actualAskedQuestionId: input.turn.actualAskedQuestionId,
            actualAskedQuestion: input.turn.actualAskedQuestion,
            nextAction: input.turn.nextAction,
            customGptStatus: input.turn.customGptStatus,
            sourceProvider: input.turn.sourceProvider ?? null,
            sourceProviderShadow: input.turn.sourceProviderShadow ?? null,
            references: input.turn.references ?? [],
            droppedReferences: input.turn.droppedReferences ?? [],
          },
        },
      }),
    ]);
  } catch {
    // DB audit must not block the respondent-facing MVP survey.
  }
}
