import { describe, expect, it } from "vitest";
import { websitePageContext } from "./website-page-context";

describe("source-owned figure page context", () => {
  it.each(['What is the PFS data?', 'what is the data on PSF show', 'progression-free survival'])('finds the results instead of a matched glossary for %s', query => {
    const results = 'Combination treatment nearly doubled mPFS vs chemotherapy.\n\nReduced risk of progression or death (HR=0.45).';
    const filler = Array.from({length:15},(_,n)=>`Patient characteristic ${n}: ${'x'.repeat(800)}`).join('\n\n');
    const glossary = 'PFS=progression-free survival; OS=overall survival; ORR=objective response rate; ECOG=performance status.';
    const content = `${results}\n\n${filler}\n\n${glossary}`;
    const result = websitePageContext(content, glossary, false, query)!;
    expect(result.text).toContain(results);
    expect(result.text).not.toContain(glossary);
    expect(result.text).toBe(content.slice(result.start,result.end));
  });
  it('does not anchor endpoint questions to abbreviation definitions before the findings', () => {
    const glossary = 'PFS=progression-free survival; OS=overall survival; ORR=objective response rate.';
    const filler = Array.from({length:12},()=> 'Intro '.repeat(140)).join('\n\n');
    const results = 'Progression‑free survival was measured in the trial.\n\nThe analysis was exploratory.';
    const result = websitePageContext(`${glossary}\n\n${filler}\n\n${results}`,glossary,false,'PFS')!;
    expect(result.text).toContain(results);
    expect(result.text).not.toContain(glossary);
  });
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
