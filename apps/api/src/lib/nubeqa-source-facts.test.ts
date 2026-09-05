import { afterEach, describe, expect, it, vi } from "vitest";
import { askControlledRagForSurveyInterviewerTurn, controlledRagTestInternals } from "./controlled-rag-service";
import { CONTROLLED_RAG_CHUNKS } from "./controlled-rag-source-packs";

vi.mock("./prisma", () => ({ prisma: {
  sourceChunk: { findMany: vi.fn(async () => []) },
  sourceAsset: { findMany: vi.fn(async () => []) },
} }));
vi.mock("./model-gateway", () => ({ getOptionalOpenAIGateway: () => null }));

const sourceInput = {
  surveySlug: "nubeqa" as const,
  surveyContext: "Approved NUBEQA source evidence.",
  currentQuestion: null,
  selectedNextQuestion: null,
  selectedQuestionSourceContext: null,
  responseMode: "answer_only" as const,
};

describe("NUBEQA source facts", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    "What is the exact UTI incidence with NUBEQA?",
    "How does NUBEQA relate to urinary tract infections?",
    "What are the all-grade and Grade 3 or 4 UTI rates in ARANOTE without docetaxel?",
  ])("answers from the ARANOTE table instead of generic dosing for %s", async (participantMessage) => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("No network calls in fact fixtures."); }));
    const result = await askControlledRagForSurveyInterviewerTurn({ ...sourceInput, participantMessage });
    expect(result.enabled).toBe(true);
    expect(result.references[0]?.title).toContain("ARANOTE Urinary Tract Infection Rates");
    expect(result.references[0]?.url).toBe("https://www.nubeqahcp.com/safety/mcspc");
    expect(result.references[0]?.assets?.[0]?.url).toContain("mcspc-all-grades-3-and-4-ar_0.svg");
    expect(result.answer).toContain("12%");
    expect(result.answer).toContain("8%");
    expect(result.answer).toContain("1.8%");
    expect(result.answer).toContain("0.5%");
    expect(result.answer).toContain("Grade 3 or 4");
    expect(result.answer).not.toContain("600 mg");
    expect(result.answer).not.toContain("incidence is unavailable");
  });

  it.each(["ARASENS", "ARAMIS"])("does not relabel ARANOTE UTI rates as %s results", (trial) => {
    const card = controlledRagTestInternals.buildClinicalEvidenceCard({
      ...sourceInput, participantMessage: `What are the urinary tract infection rates in ${trial}?`,
    }, CONTROLLED_RAG_CHUNKS.filter((chunk) => chunk.surveySlug === "nubeqa"));
    expect(card?.id).not.toBe("nubeqa-aranote-uti");
  });

  it("retrieves dedicated DDI evidence with an official interaction diagram", async () => {
    const result = await askControlledRagForSurveyInterviewerTurn({
      ...sourceInput, participantMessage: "What are the drug interactions with NUBEQA?",
    });
    expect(result.references[0]?.url).toBe("https://www.nubeqahcp.com/safety/ddi-profile");
    expect(result.references[0]?.assets?.[0]?.url).toContain("drug-interactions-of-nubeqa_1.svg");
    expect(result.references.flatMap((reference) => reference.assets ?? []).filter(
      (asset) => asset.assetKind !== "LINK" &&
        /adverse reactions|urinary tract infection/i.test(`${asset.title} ${asset.tags?.join(" ")}`),
    )).toEqual([]);
    expect(result.answer).toContain("CYP3A4");
    expect(result.answer).toContain("BCRP");
    expect(result.answer).toContain("OATP1B1");
    expect(result.answer).not.toContain("urinary tract infection occurred");
    const source = CONTROLLED_RAG_CHUNKS.find((chunk) => chunk.id === "nubeqa-ddi-profile")!;
    expect(source.assets).toHaveLength(1);
    expect(source.assets?.[0]?.url).toContain("drug-interactions-of-nubeqa_1.svg");
    expect(source.assets?.[0]?.tags).toContain("ddi");
  });
});
