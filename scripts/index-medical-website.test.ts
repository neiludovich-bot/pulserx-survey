import { describe, expect, it } from "vitest";
import { extractWebsiteHtml, canonicalUrl } from "./index-medical-website";
import { allowedWebsiteIndexUrl } from "../packages/schemas/src/website-index";
describe("website extraction", () => {
  it("preserves headings, table columns and source-owned image captions while excluding navigation", () => {
    const result = extractWebsiteHtml('<html><title>Study</title><nav>Menu</nav><main><h1>Evidence</h1><p>Result with qualifiers.</p><table><tr><th>Arm</th><th>Result</th></tr><tr><td>Active</td><td>1.25</td></tr></table><figure><img src="/study.svg" alt="Study result figure"><figcaption>Population and endpoint.</figcaption></figure><a href="/label.pdf">Label</a></main></html>', 'https://www.nubeqahcp.com/');
    expect(result.content).toContain("Arm | Result"); expect(result.content).toContain("Active | 1.25"); expect(result.content).not.toContain("Menu");
    expect(result.assets[0]).toMatchObject({ url: "https://www.nubeqahcp.com/study.svg", description: "Population and endpoint." });
    expect(result.links).toContain("https://www.nubeqahcp.com/label.pdf");
  });
  it("uses a nonempty title even if h1 is whitespace", () => {
    expect(extractWebsiteHtml('<h1> </h1><title>Evidence</title>', 'https://www.nubeqahcp.com/').title).toBe('Evidence');
  });
  it("restricts exact domains, protocols and external links to linked document hosts", () => {
    expect(allowedWebsiteIndexUrl('nubeqa', 'https://labeling.bayerhealthcare.com/html/products/pi/Nubeqa_PI.pdf', true)).toBe(true);
    for (const url of ['http://www.nubeqahcp.com/', 'https://www.nubeqahcp.com.evil.test/', 'https://user:pass@www.nubeqahcp.com/', 'https://127.0.0.1/', 'https://www.padcevhcp.com/']) expect(allowedWebsiteIndexUrl('nubeqa', url, true)).toBe(false);
    expect(canonicalUrl('/dosing#section', 'https://www.nubeqahcp.com/')).toBe('https://www.nubeqahcp.com/dosing');
  });
});
