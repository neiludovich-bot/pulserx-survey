import { describe, expect, it } from "vitest";
import { getSuggestedCustomGptSitemapUrl } from "./customgpt-source-url";

describe("CustomGPT sitemap URL suggestions", () => {
  it("turns a root website URL into the expected sitemap URL", () => {
    expect(
      getSuggestedCustomGptSitemapUrl("https://www.brukinsahcp.com/"),
    ).toBe("https://www.brukinsahcp.com/sitemap.xml");
  });

  it("keeps an explicit sitemap URL unchanged", () => {
    expect(
      getSuggestedCustomGptSitemapUrl(
        "https://www.brukinsahcp.com/sitemap_index.xml",
      ),
    ).toBe("https://www.brukinsahcp.com/sitemap_index.xml");
  });

  it("leaves non-website values alone", () => {
    expect(getSuggestedCustomGptSitemapUrl("db://study-assets/source.pdf")).toBe(
      "db://study-assets/source.pdf",
    );
  });
});
