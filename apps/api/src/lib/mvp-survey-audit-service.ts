import {
  mvpSurveyAuditDetailResponseSchema,
  mvpSurveyAuditListResponseSchema,
} from "@interview/schemas";
import { prisma } from "./prisma";

const MVP_STUDY_SLUG_PREFIX = "mvp-customgpt-";

function dbAuditConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function iso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function metadataString(metadata: unknown, key: string) {
  return nullableString(asRecord(metadata)[key]);
}

function mapSessionSummary(session: {
  id: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
  metadata: unknown;
  study: {
    name: string;
    slug: string;
  };
  _count: {
    turns: number;
    decisions: number;
  };
}) {
  return {
    id: session.id,
    studyName: session.study.name,
    studySlug: session.study.slug,
    status: session.status,
    startedAt: iso(session.startedAt),
    completedAt: iso(session.completedAt),
    surveySlug: metadataString(session.metadata, "surveySlug"),
    sourceBrand: metadataString(session.metadata, "sourceBrand"),
    surveyIntentLabel: metadataString(session.metadata, "surveyIntentLabel"),
    currentQuestionId: metadataString(session.metadata, "currentQuestionId"),
    currentQuestion: metadataString(session.metadata, "currentQuestion"),
    completedReason: metadataString(session.metadata, "completedReason"),
    turnCount: session._count.turns,
    decisionCount: session._count.decisions,
  };
}

export async function listMvpSurveyAuditSessions(limit = 50) {
  if (!dbAuditConfigured()) {
    return mvpSurveyAuditListResponseSchema.parse({
      dbConfigured: false,
      generatedAt: new Date().toISOString(),
      sessions: [],
    });
  }

  const sessions = await prisma.session.findMany({
    where: {
      study: {
        slug: {
          startsWith: MVP_STUDY_SLUG_PREFIX,
        },
      },
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    take: Math.min(Math.max(limit, 1), 100),
    include: {
      study: {
        select: {
          name: true,
          slug: true,
        },
      },
      _count: {
        select: {
          turns: true,
          decisions: true,
        },
      },
    },
  });

  return mvpSurveyAuditListResponseSchema.parse({
    dbConfigured: true,
    generatedAt: new Date().toISOString(),
    sessions: sessions.map(mapSessionSummary),
  });
}

export async function getMvpSurveyAuditSession(sessionId: string) {
  if (!dbAuditConfigured()) {
    return null;
  }

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      study: {
        slug: {
          startsWith: MVP_STUDY_SLUG_PREFIX,
        },
      },
    },
    include: {
      study: {
        select: {
          name: true,
          slug: true,
        },
      },
      turns: {
        orderBy: {
          sequence: "asc",
        },
      },
      decisions: {
        orderBy: {
          createdAt: "asc",
        },
      },
      _count: {
        select: {
          turns: true,
          decisions: true,
        },
      },
    },
  });

  if (!session) {
    return null;
  }

  return mvpSurveyAuditDetailResponseSchema.parse({
    dbConfigured: true,
    generatedAt: new Date().toISOString(),
    session: mapSessionSummary(session),
    turns: session.turns.map((turn) => ({
      id: turn.id,
      sequence: turn.sequence,
      role: turn.role,
      content: turn.content,
      createdAt: turn.createdAt.toISOString(),
      payload: turn.payload ?? null,
    })),
    decisions: session.decisions.map((decision) => ({
      id: decision.id,
      kind: decision.kind,
      status: decision.status,
      rationale: decision.rationale,
      createdAt: decision.createdAt.toISOString(),
      input: decision.input ?? null,
      output: decision.output ?? null,
    })),
  });
}
