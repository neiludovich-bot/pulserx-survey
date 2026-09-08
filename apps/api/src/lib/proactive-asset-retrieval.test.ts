import { describe, expect, it } from "vitest";
import { controlledRagTestInternals } from "./controlled-rag-service";
import { sourceContentSearchTerms } from "./source-retrieval-query";

describe("proactive visual candidates", () => {
  const assets = [
    {title:"ALPINE progression-free survival",description:"ALPINE PFS curve",url:"https://example.com/pfs.png",assetKind:"IMAGE" as const,tags:[],priority:10},
    {title:"Tablet administration",description:"Scored tablet dosing",url:"https://example.com/dose.png",assetKind:"IMAGE" as const,tags:[],priority:10},
  ];
  it("retains a retrieved page's figures for semantic selection even without literal caption overlap", () => {
    expect(controlledRagTestInternals.rankAssets(assets,["advantages","other","btk"],[],true)).toHaveLength(2);
    expect(controlledRagTestInternals.rankAssets(assets,["advantages","other","btk"])).toHaveLength(0);
  });
  it("still ranks a matching caption first instead of forcing unrelated figures into the answer", () => {
    expect(controlledRagTestInternals.rankAssets(assets,["dosing"],[],true)[0].url).toContain("dose.png");
  });
  it("reserves candidate space for distinct figures before repeated responsive captions", () => {
    const title = "Detailed study response chart comparing two treatment groups over several years";
    const variants = Array.from({length:6},(_,i)=>({...assets[0],title,description:title,url:`https://example.com/variant-${i}.png`}));
    const ranked = controlledRagTestInternals.rankAssets([...variants,assets[1]],["study"],[],true);
    expect(ranked).toHaveLength(6);
    expect(ranked[1].url).toBe(assets[1].url);
  });
  it("expands broad comparisons for every bot without broadening endpoint-specific questions", () => {
    for (const slug of ["brukinsa","nubeqa","padcev"]) expect(sourceContentSearchTerms(`what advantages does ${slug} have over other therapies`,slug)).toContain("efficacy");
    expect(sourceContentSearchTerms("compare the DDI profile","brukinsa")).not.toContain("efficacy");
    expect(sourceContentSearchTerms("compare PFS","brukinsa")).not.toContain("safety");
  });
});
