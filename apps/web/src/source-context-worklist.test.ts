import { describe, expect, it } from "vitest";
import {
  buildSourceContextWorklist,
  formatSourceContextReferenceDraft,
  parseSourceContextReferenceDraft,
  parseSourceContextWorklistNotes,
  type SourceContextQuestion,
} from "./source-context-worklist";

const questions: SourceContextQuestion[] = [
  {
    nodeId: "node_1",
    nodeKey: "sequoia_reaction",
    title: "SEQUOIA reaction",
    prompt:
      "After reviewing the SEQUOIA study details, what stands out as most important?",
    moduleTitle: "CLL/SLL",
    sourceContextDetected: true,
    sourceContextOverride: null,
    sourceContextHint: null,
    sourceContextReferences: [],
    assetTitle: "BRUKINSA HCP Website",
  },
  {
    nodeId: "node_2",
    nodeKey: "alpine_reaction",
    title: "ALPINE reaction",
    prompt:
      "After reviewing the ALPINE study details, what stands out as most important?",
    moduleTitle: "CLL/SLL",
    sourceContextDetected: true,
    sourceContextOverride: null,
    sourceContextHint: null,
    sourceContextReferences: [],
    assetTitle: "BRUKINSA HCP Website",
  },
];

describe("source context worklist helpers", () => {
  it("builds a worklist with editable approved source note lines", () => {
    const worklist = buildSourceContextWorklist("study_1", questions);

    expect(worklist).toContain("Approved source note:");
    expect(worklist).toContain("Approved reference:");
    expect(worklist).toContain(
      "Reference format: Approved reference: Title | URL | Description",
    );
  });

  it("keeps saved notes without references in the needs-detail worklist", () => {
    const worklist = buildSourceContextWorklist("study_1", [
      {
        ...questions[0],
        sourceContextHint: "Saved SEQUOIA note without a source reference.",
        sourceContextReferences: [],
      },
      {
        ...questions[1],
        sourceContextHint: "Referenced ALPINE note.",
        sourceContextReferences: [
          {
            citationId: "customgpt:alpine",
            title: "ALPINE source",
            url: "https://example.test/alpine",
            description: null,
          },
        ],
      },
    ]);

    expect(worklist).toContain("Questions needing source detail: 1 of 2");
    expect(worklist).toContain("Status: Needs approved reference");
    expect(worklist).toContain(
      "Approved source note: Saved SEQUOIA note without a source reference.",
    );
    expect(worklist).not.toContain("Referenced ALPINE note.");
  });

  it("parses single-line and multiline approved source notes by node key", () => {
    const parsed = parseSourceContextWorklistNotes(
      [
        "1. SEQUOIA reaction",
        "Node: sequoia_reaction",
        "Prompt: After reviewing the SEQUOIA study details, what stands out?",
        "Approved source note: SEQUOIA approved note.",
        "",
        "2. ALPINE reaction",
        "Node: alpine_reaction",
        "Approved source note:",
        "ALPINE approved note line 1.",
        "ALPINE approved note line 2.",
      ].join("\n"),
      questions,
    );

    expect(parsed).toEqual([
      {
        nodeId: "node_1",
        nodeKey: "sequoia_reaction",
        sourceContextHint: "SEQUOIA approved note.",
        sourceContextReferences: [],
      },
      {
        nodeId: "node_2",
        nodeKey: "alpine_reaction",
        sourceContextHint:
          "ALPINE approved note line 1.\nALPINE approved note line 2.",
        sourceContextReferences: [],
      },
    ]);
  });

  it("parses approved source references from completed worklists", () => {
    const parsed = parseSourceContextWorklistNotes(
      [
        "1. SEQUOIA reaction",
        "Node: sequoia_reaction",
        "Approved source note: SEQUOIA source summary.",
        "Approved reference: BRUKINSA SEQUOIA HCP page | https://www.brukinsahcp.com/cll-sll/sequoia | Official HCP source page.",
        "Approved reference: https://www.brukinsahcp.com/ | BRUKINSA HCP website.",
      ].join("\n"),
      questions,
    );

    expect(parsed).toEqual([
      {
        nodeId: "node_1",
        nodeKey: "sequoia_reaction",
        sourceContextHint: "SEQUOIA source summary.",
        sourceContextReferences: [
          {
            citationId: "worklist:sequoia_reaction:1",
            title: "BRUKINSA SEQUOIA HCP page",
            url: "https://www.brukinsahcp.com/cll-sll/sequoia",
            description: "Official HCP source page.",
          },
          {
            citationId: "worklist:sequoia_reaction:2",
            title: null,
            url: "https://www.brukinsahcp.com/",
            description: "BRUKINSA HCP website.",
          },
        ],
      },
    ]);
  });

  it("formats and parses manual approved reference drafts", () => {
    const draft = formatSourceContextReferenceDraft([
      {
        citationId: "customgpt:sequoia",
        title: "SEQUOIA source",
        url: "https://example.test/sequoia",
        description: "Official source detail.",
      },
      {
        citationId: "customgpt:home",
        title: null,
        url: "https://example.test",
        description: "Main HCP website.",
      },
    ]);

    expect(draft).toBe(
      [
        "SEQUOIA source | https://example.test/sequoia | Official source detail.",
        "https://example.test | Main HCP website.",
      ].join("\n"),
    );
    expect(
      parseSourceContextReferenceDraft(
        "sequoia_reaction",
        [
          "SEQUOIA source | https://example.test/sequoia | Official source detail.",
          "Approved reference: https://example.test | Main HCP website.",
        ].join("\n"),
      ),
    ).toEqual([
      {
        citationId: "worklist:sequoia_reaction:1",
        title: "SEQUOIA source",
        url: "https://example.test/sequoia",
        description: "Official source detail.",
      },
      {
        citationId: "worklist:sequoia_reaction:2",
        title: null,
        url: "https://example.test",
        description: "Main HCP website.",
      },
    ]);
  });

  it("ignores empty placeholders and needed-detail guidance", () => {
    expect(
      parseSourceContextWorklistNotes(
        [
          "1. SEQUOIA reaction",
          "Node: sequoia_reaction",
          "Approved source note:",
          "Needed source detail: upload/approve the clinical study.",
        ].join("\n"),
        questions,
      ),
    ).toEqual([]);
  });
});
