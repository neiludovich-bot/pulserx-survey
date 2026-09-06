import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
const mocks = vi.hoisted(() => ({ findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), chunks: vi.fn(), assets: vi.fn(), lock: vi.fn(), transaction: vi.fn() }));
vi.mock("./prisma", () => ({ prisma: { $transaction: mocks.transaction } }));
import { applyWebsiteIndex, prepareWebsiteIndex } from "./website-index-service";
import { chunkSourceText } from "./source-text-chunks";
const content = "The website describes the study population and its limitations.";
const snapshot = () => ({ version: 1, surveySlug: "nubeqa", rootUrl: "https://www.nubeqahcp.com/", fetchedAt: "2026-09-06T12:00:00.000Z", pages: [{ url: "https://www.nubeqahcp.com/dosing", discoveredFrom: "https://www.nubeqahcp.com/", title: "Dosing", content, sourceType: "URL", hash: createHash("sha256").update(content).digest("hex"), assets: [] }], issues: [], discoveredUrls: ["https://www.nubeqahcp.com/dosing"], truncated: false });
beforeEach(() => {
  vi.resetAllMocks(); mocks.findMany.mockResolvedValue([]); mocks.create.mockResolvedValue({ id: "new" }); mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(fn => fn({ $executeRaw: mocks.lock, sourceDocument: { findMany: mocks.findMany, create: mocks.create, updateMany: mocks.updateMany }, sourceChunk: { createMany: mocks.chunks }, sourceAsset: { createMany: mocks.assets } }));
});
describe("website ingestion", () => {
  it("preserves long clinical sentences, decimals and qualifiers across chunk boundaries", () => {
    const sentence = `${"Context ".repeat(170)}Only if the stated condition is met, the label describes 1.25 mg/kg, up to 125 mg.`;
    const chunks = chunkSourceText(`Heading\n\n${sentence}\n\nAnother complete sentence.`);
    expect(chunks).toContain(sentence); expect(chunks.join("\n\n")).toContain("1.25 mg/kg, up to 125 mg.");
  });
  it("rejects corrupt hashes and evidence from another bot before starting a transaction", async () => {
    const wrong = snapshot(); wrong.pages[0].content += " invented";
    await expect(applyWebsiteIndex(wrong)).rejects.toThrow("hash"); expect(mocks.transaction).not.toHaveBeenCalled();
    const cross = snapshot(); cross.pages[0].url = "https://www.padcevhcp.com/";
    expect(() => prepareWebsiteIndex(cross)).toThrow("outside");
  });
  it("versions changed pages and archives only the prior crawler-owned page without deleting chunks", async () => {
    mocks.findMany.mockResolvedValue([{ id: "old", url: snapshot().pages[0].url, tags: ["website-index:v1", "version:old"] }]);
    const result = await applyWebsiteIndex(snapshot());
    expect(result).toMatchObject({ created: 1, archived: 1, unchanged: 0 });
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tags: { has: "website-index:v1" }, id: { in: ["old"] } }), data: { status: "ARCHIVED" } }));
    expect(mocks.chunks.mock.calls[0][0].data[0].metadata).toMatchObject({ sourceUrl: snapshot().pages[0].url });
    expect(mocks.create.mock.calls.at(-1)?.[0].data.status).toBe("DRAFT");
  });
  it("is idempotent for unchanged evidence and retains absent pages on incomplete crawls", async () => {
    const prepared = prepareWebsiteIndex(snapshot());
    mocks.findMany.mockResolvedValue([{ id: "same", url: snapshot().pages[0].url, tags: [`version:${prepared.pages[0].versionHash}`] }, { id: "missing", url: "https://www.nubeqahcp.com/safety", tags: [] }]);
    expect(await applyWebsiteIndex({ ...snapshot(), truncated: true })).toMatchObject({ created: 0, archived: 0, unchanged: 1, truncated: true });
    expect(mocks.chunks).not.toHaveBeenCalled(); expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
