import { describe, it, expect } from "vitest";
import { extractWebsiteTables } from "../../../../scripts/extract-website-tables";
import { renderWebsiteTable } from "./website-table-renderer";
import { sourceAssetAnswerEligible, sourceAssetDisplayEligible } from "./source-asset-measure";

describe("website table visuals", () => {
  it("keeps merged headers, exact rates, and footnotes with their own table", () => {
    const [table, second] = extractWebsiteTables('<main><h3>SEQUOIA (STUDY 304): Adverse reactions</h3><table><tr><th rowspan="2">Reaction</th><th colspan="2">BRUKINSA</th></tr><tr><th>All grades</th><th>Grade ≥3</th></tr><tr><td>Fatigue</td><td>14†</td><td>1</td></tr></table><p>† Initial analysis.</p><h3>Another study</h3><table><tr><th>Arm</th><th>Rate</th></tr><tr><td>Comparator</td><td>9</td></tr></table><p>Different footnote.</p></main>');
    expect(table.notes).toEqual(["† Initial analysis."]);
    expect(second.notes).toEqual(["Different footnote."]);
    expect(table.rows[0][0].rowSpan).toBe(2);
    expect(table.rows[0][1].colSpan).toBe(2);
    const svg=renderWebsiteTable(table,"https://brukinsahcp.com/cll/safety/");
    expect(svg).toContain("14†"); expect(svg).toContain("Initial analysis."); expect(svg).not.toContain("Different footnote");
    expect(sourceAssetDisplayEligible({assetKind:"TABLE",url:"https://api.pulserx.ai/website-tables/example.svg"})).toBe(true);
    expect(sourceAssetAnswerEligible({title:table.title}, "SEQUOIA adverse reactions")).toBe(true);
    expect(sourceAssetAnswerEligible({title:table.title}, "ALPINE adverse reactions")).toBe(false);
  });
  it("escapes markup and rejects out-of-bounds spans", () => {
    const table={title:'<script>alert(1)</script>', rows:[[{text:'<img src=x>',header:true,rowSpan:1,colSpan:1}],[{text:'1',header:false,rowSpan:1,colSpan:1}]],notes:[]};
    expect(renderWebsiteTable(table,"https://example.test/")).not.toContain("<script>");
    table.rows[0][0].rowSpan=3;
    expect(()=>renderWebsiteTable(table,"https://example.test/")).toThrow("spans");
  });
});
