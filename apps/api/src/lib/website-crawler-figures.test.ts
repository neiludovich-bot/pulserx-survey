import { describe, expect, it } from "vitest";
import { extractWebsiteHtml } from "./website-crawler";
import { sourceContentSearchSql } from "./source-retrieval-query";
describe("website figures as attributable source text", () => {
  it("retains the publisher's figure descriptions beside qualifiers without repeating responsive variants", () => {
    const html = '<main><h1>Study results</h1><p>Confirmed objective response</p><img src="/orr.png" alt="Response rate was 50.0% in Study-X02"><img src="/orr-mobile.png" alt="Response rate was 50.0% in Study-X02"><p>Single-arm analysis; no comparative inference.</p><img src="/logo.png" alt="Company logo"></main>';
    const page = extractWebsiteHtml(html, "https://example.test/results");
    expect(page.content).toContain("Figure alternative text (provided by the website): Response rate was 50.0% in Study-X02\n\nSingle-arm analysis; no comparative inference.");
    expect(page.content.match(/50\.0%/g)).toHaveLength(1);
    expect(page.content).not.toContain("Company logo");
  });
  it("prioritizes an explicitly named trial before shared URL terms and excludes endpoint-served PDFs from website reservations", () => {
    const sql = sourceContentSearchSql("What efficacy does DESTINY-Gastric01 show in HER2-positive gastric cancer?", "enhertu", "prior lung discussion", true)!;
    expect(sql.values).toContain("%DESTINY-Gastric01%");
    expect(sql.sql).toContain("document.source_type <> 'PDF'");
    expect(sql.sql.indexOf("ORDER BY (chunk.content ILIKE")).toBeGreaterThan(0);
    expect(sourceContentSearchSql("HER2-positive disease", "enhertu")!.values).not.toContain("%HER2%");
  });
});
