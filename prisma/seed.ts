import { PrismaClient } from "@prisma/client";
import {
  demoStudySeed,
  medicalSurveySeed,
  type StudySeed,
} from "../packages/engine/src/index";

const prisma = new PrismaClient();

async function clearStudy(studyId: string) {
  await prisma.$transaction([
    prisma.evalRun.deleteMany({ where: { studyId } }),
    prisma.assetReaction.deleteMany({ where: { studyId } }),
    prisma.artifact.deleteMany({ where: { studyId } }),
    prisma.candidateAction.deleteMany({ where: { studyId } }),
    prisma.decision.deleteMany({ where: { studyId } }),
    prisma.analysis.deleteMany({ where: { studyId } }),
    prisma.sessionAsset.deleteMany({ where: { studyId } }),
    prisma.turn.deleteMany({ where: { studyId } }),
    prisma.session.deleteMany({ where: { studyId } }),
    prisma.respondent.deleteMany({ where: { studyId } }),
    prisma.assetStageRule.deleteMany({ where: { studyId } }),
    prisma.actionRule.deleteMany({ where: { studyId } }),
    prisma.studyAction.deleteMany({ where: { studyId } }),
    prisma.branchRule.deleteMany({ where: { studyId } }),
    prisma.questionNode.deleteMany({ where: { studyId } }),
    prisma.studyAsset.deleteMany({ where: { studyId } }),
    prisma.studyModule.deleteMany({ where: { studyId } }),
    prisma.evalCase.deleteMany({ where: { studyId } }),
  ]);
}

async function seedStudy(seed: StudySeed) {
  const study = await prisma.study.upsert({
    where: {
      slug: seed.study.slug,
    },
    update: {
      name: seed.study.name,
      description: seed.study.description,
      status: seed.study.status,
      version: seed.study.version,
      config: seed.study.config ?? {},
    },
    create: {
      id: seed.study.id,
      slug: seed.study.slug,
      name: seed.study.name,
      description: seed.study.description,
      status: seed.study.status,
      version: seed.study.version,
      config: seed.study.config ?? {},
    },
  });

  await clearStudy(study.id);

  await prisma.studyModule.createMany({
    data: seed.modules.map((module) => ({ ...module })),
  });

  await prisma.studyAsset.createMany({
    data: seed.studyAssets.map((asset) => ({ ...asset })),
  });

  await prisma.questionNode.createMany({
    data: seed.questionNodes.map((node) => ({ ...node })),
  });

  await prisma.branchRule.createMany({
    data: seed.branchRules.map((rule) => ({ ...rule })),
  });

  await prisma.studyAction.createMany({
    data: seed.studyActions.map((action) => ({ ...action })),
  });

  await prisma.actionRule.createMany({
    data: seed.actionRules.map((rule) => ({ ...rule })),
  });

  await prisma.assetStageRule.createMany({
    data: seed.assetStageRules.map((rule) => ({ ...rule })),
  });

  await prisma.respondent.create({
    data: seed.respondent,
  });

  await prisma.session.create({
    data: {
      ...seed.session,
      startedAt: new Date(seed.session.startedAt),
    },
  });

  if (seed.turns.length > 0) {
    await prisma.turn.createMany({
      data: seed.turns.map((turn) => ({ ...turn })),
    });
  }

  if (seed.analyses.length > 0) {
    await prisma.analysis.createMany({
      data: seed.analyses.map((analysis) => ({ ...analysis })),
    });
  }

  if (seed.decisions.length > 0) {
    await prisma.decision.createMany({
      data: seed.decisions.map((decision) => ({ ...decision })),
    });
  }

  if (seed.artifacts.length > 0) {
    await prisma.artifact.createMany({
      data: seed.artifacts.map((artifact) => ({ ...artifact })),
    });
  }

  if (seed.sessionAssets.length > 0) {
    await prisma.sessionAsset.createMany({
      data: seed.sessionAssets.map((sessionAsset) => ({
        ...sessionAsset,
        shownAt: new Date(sessionAsset.shownAt),
        dismissedAt: sessionAsset.dismissedAt
          ? new Date(sessionAsset.dismissedAt)
          : null,
      })),
    });
  }

  if (seed.candidateActions.length > 0) {
    await prisma.candidateAction.createMany({
      data: seed.candidateActions.map((candidateAction) => ({
        ...candidateAction,
      })),
    });
  }

  if (seed.assetReactions.length > 0) {
    await prisma.assetReaction.createMany({
      data: seed.assetReactions.map((reaction) => ({ ...reaction })),
    });
  }

  if (seed.evalCases.length > 0) {
    await prisma.evalCase.createMany({
      data: seed.evalCases.map((evalCase) => ({ ...evalCase })),
    });
  }

  if (seed.evalRuns.length > 0) {
    await prisma.evalRun.createMany({
      data: seed.evalRuns.map((run) => ({
        ...run,
        startedAt: new Date(run.startedAt),
        finishedAt: new Date(run.finishedAt),
      })),
    });
  }

  return study;
}

async function main() {
  const seededStudies = [];

  for (const seed of [demoStudySeed, medicalSurveySeed]) {
    const study = await seedStudy(seed);
    seededStudies.push(`"${study.name}" (${study.slug})`);
  }

  console.log(
    `Seeded ${seededStudies.length} studies: ${seededStudies.join(", ")}.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
