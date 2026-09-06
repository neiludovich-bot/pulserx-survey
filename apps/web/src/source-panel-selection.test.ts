import { describe, expect, it } from "vitest";
import type { GroundedReference, MvpCustomGptSurveyMessage } from "@interview/schemas";
import { selectAutomaticSourcePanel, selectedSourceFigure, selectedSourceSlides } from "./source-panel-selection";

function reference(url: string, assets: GroundedReference["assets"] = []): GroundedReference {
  return { citationId: url, title: "Source", url, description: null, assets };
}
function asset(url: string, assetKind = "CHART", priority = 0) {
  return { url, assetKind, title: "Selected figure", description: null, tags: [], priority };
}
function message(references: GroundedReference[]): MvpCustomGptSurveyMessage {
  return { id: "turn-1", role: "interviewer", content: "A brief orientation.", createdAt: "2026-09-05T00:00:00Z", references };
}

describe("automatic source figures", () => {
  it("collects figures across citations with their own captions and source links", () => {
    const slides = selectedSourceSlides(message([
      reference("https://example.test/pi.pdf"),
      { ...reference("https://example.test/pfs", [asset("https://example.test/pfs.png"), asset("https://example.test/pfs2.png")]), title: "PFS" },
      { ...reference("https://example.test/ddi", [{ ...asset("https://example.test/ddi.svg"), description: "Interaction table" }]), title: "DDI" },
    ]));
    expect(slides.map((slide) => [slide.index, slide.reference.title, slide.preview?.sourceUrl, slide.preview?.images.length])).toEqual([
      [2, "PFS", "https://example.test/pfs", 1],
      [2, "PFS", "https://example.test/pfs", 1],
      [3, "DDI", "https://example.test/ddi", 1],
    ]);
    expect(slides[2].preview?.images[0].alt).toBe("Interaction table");
  });

  it("does not rotate duplicate figures or add unselected resources", () => {
    const slides = selectedSourceSlides(message([
      reference("https://example.test/first", [asset("https://example.test/same.png")]),
      reference("https://example.test/second", [asset("https://example.test/same.png"), asset("https://example.test/pi.pdf", "TABLE")]),
    ]));
    expect(slides).toHaveLength(1);
    expect(slides[0].index).toBe(1);
    expect(selectedSourceSlides(message([]))).toEqual([]);
  });
  it("keeps generic ARAMIS links and full prescribing-information PDFs as citations without panels", () => {
    const input = message([
      { ...reference("https://example.test/aramis", [asset("https://example.test/aramis", "LINK")]), title: "NUBEQA ARAMIS efficacy" },
      reference("https://example.test/pi.pdf#page=23", [asset("https://example.test/pi.pdf#page=23", "PDF")]),
    ]);
    expect(selectAutomaticSourcePanel(input)).toBeNull();
    expect(input.references).toHaveLength(2);
  });

  it("opens the first source-selected figure after a citation-only source, keeping its citation number", () => {
    const selected = selectAutomaticSourcePanel(message([
      reference("https://example.test/overview", [asset("https://example.test/overview", "LINK")]),
      reference("https://example.test/interactions", [asset("https://example.test/ddi.svg")]),
    ]));
    expect(selected?.index).toBe(2);
    expect(selected?.preview?.images.map((image) => image.url)).toEqual(["https://example.test/ddi.svg"]);
    expect(selected?.preview?.documents).toEqual([]);
  });

  it("preserves selected source and figure order rather than promoting higher-priority or efficacy assets", () => {
    const selected = selectAutomaticSourcePanel(message([
      reference("https://example.test/safety", [asset("https://example.test/safety.png", "IMAGE", 1), asset("https://example.test/later.png", "CHART", 900)]),
      reference("https://example.test/pfs", [asset("https://example.test/pfs.png", "CHART", 1000)]),
    ]));
    expect(selected?.index).toBe(1);
    expect(selected?.preview?.images.map((image) => image.url)).toEqual(["https://example.test/safety.png", "https://example.test/later.png"]);
  });

  it("does not discover figures for empty selections or treat mislabeled links as images", () => {
    expect(selectAutomaticSourcePanel(message([reference("https://example.test/safety")]))).toBeNull();
    expect(selectAutomaticSourcePanel(message([reference("https://example.test/safety", [asset("https://example.test/pi.pdf"), asset("https://example.test/chart.png", "LINK")])]))).toBeNull();
  });

  it("resolves each new answer synchronously, without stale asynchronous preview results", () => {
    const old = message([reference("https://example.test/source", [asset("https://example.test/chart.svg")])]);
    expect(selectAutomaticSourcePanel(old)?.messageId).toBe("turn-1");
    expect(selectAutomaticSourcePanel({ ...old, id: "turn-2", references: [] })).toBeNull();
  });

  it("honors a manual choice or close for the current answer while allowing a new answer's figure", () => {
    const input = message([reference("https://example.test/source", [asset("https://example.test/chart.svg")])]);
    expect(selectAutomaticSourcePanel(input, input.id)).toBeNull();
    expect(selectedSourceFigure({ messageId: input.id, index: 4, reference: input.references[0] })?.index).toBe(4);
    expect(selectAutomaticSourcePanel({ ...input, id: "new-answer" }, input.id)?.messageId).toBe("new-answer");
  });
});
