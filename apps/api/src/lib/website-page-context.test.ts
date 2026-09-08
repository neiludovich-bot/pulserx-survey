import { describe, expect, it } from "vitest";
import { websitePageContext } from "./website-page-context";

describe("source-owned figure page context", () => {
  it("keeps original page bytes including qualifications, even if search hit the bibliography", () => {
    const content = 'Study A results.\n\nStudy B results.\n\nExploratory analysis, not a confirmatory comparison.\n\nReferences: Study B.';
    const result = websitePageContext(content, 'References: Study B.', true)!;
    expect(result.text).toBe(content.slice(result.start, result.end));
    expect(result.text).toContain('Exploratory analysis');
  });
  it("follows a narrow question to later page content instead of always sending the beginning", () => {
    const early = Array.from({length:15},(_,n)=>`Other section ${n}: ${'x'.repeat(900)}`).join('\n\n');
    const target = 'Specific trial adverse reactions and the conditions applying to those rates.';
    const content = `${early}\n\n${target}\n\nThese results apply only to the named regimen.`;
    const result = websitePageContext(content, `Page title\n\n${target}`, false)!;
    expect(result.text).toContain(target);
    expect(result.text).toContain('only to the named regimen');
    expect(result.text).toBe(content.slice(result.start, result.end));
    expect(result.text.length).toBeLessThanOrEqual(6500);
  });
  it("does not cut a paragraph or silently truncate an oversized qualification", () => {
    const content = Array.from({length:10},(_,n)=>`Section ${n}: ${'x'.repeat(900)}`).join('\n\n');
    const result = websitePageContext(content, '', true)!;
    expect(content.slice(result.end)).toMatch(/^\n\nSection/);
    expect(websitePageContext('x'.repeat(12001), '', true)).toBeNull();
  });
});
