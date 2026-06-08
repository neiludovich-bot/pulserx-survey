import { afterEach, describe, expect, it, vi } from "vitest";
import { previewSourceImages, resetSourcePreviewCache } from "./source-preview-service";

afterEach(() => {
  resetSourcePreviewCache();
  vi.unstubAllGlobals();
});

describe("source preview service", () => {
  it("ranks SEQUOIA efficacy chart images above generic site artwork", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `
          <html>
            <head>
              <title>BRUKINSA efficacy in CLL</title>
              <meta property="og:image" content="https://brukinsahcp.com/wp-content/uploads/logo.png" />
            </head>
            <body>
              <img src="/wp-content/uploads/logo.png" alt="BRUKINSA logo" />
              <section id="first">
                <h2>1L: SEQUOIA</h2>
                <h3>SUPERIOR PFS vs BR IN PATIENTS WITHOUT DEL(17p)</h3>
                <p>72% relative risk reduction in disease progression or death with BRUKINSA vs BR at ~6 years.</p>
                <picture class="chartimg midsize">
                  <source srcset="/wp-content/uploads/2025/11/cohort-1-scaled.png" media="(min-width: 768px)" />
                  <img src="/wp-content/themes/brukinsa/assets/images/swipe-to-scroll.png" alt="KM curve showing superior PFS data vs BR for SEQUOIA" />
                </picture>
              </section>
            </body>
          </html>
          `,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 200,
          },
        ),
      ),
    );

    const preview = await previewSourceImages({
      url: "https://brukinsahcp.com/cll/efficacy/#first",
      title: "BRUKINSA efficacy in CLL",
    });

    expect(preview.images[0]).toMatchObject({
      url: "https://brukinsahcp.com/wp-content/uploads/2025/11/cohort-1-scaled.png",
      alt: "KM curve showing superior PFS data vs BR for SEQUOIA",
    });
    expect(preview.images.map((image) => image.url)).not.toContain(
      "https://brukinsahcp.com/wp-content/uploads/logo.png",
    );
  });

  it("uses the largest useful srcset image instead of a thumbnail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `
          <html>
            <head>
              <title>FL Resources for HCPs</title>
            </head>
            <body>
              <main>
                <h1>Patient Management Guide</h1>
                <p>Resources for BRUKINSA patient management and support.</p>
                <img
                  src="/wp-content/uploads/patient-management-300x420.png"
                  srcset="/wp-content/uploads/patient-management-300x420.png 300w, /wp-content/uploads/patient-management-768x1075.png 768w, /wp-content/uploads/patient-management.png 1400w"
                  alt="Patient Management Guide cover"
                  width="300"
                  height="420"
                />
              </main>
            </body>
          </html>
          `,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 200,
          },
        ),
      ),
    );

    const preview = await previewSourceImages({
      url: "https://brukinsahcp.com/fl/resources/",
      title: "FL Resources for HCPs",
    });

    expect(preview.images[0]).toMatchObject({
      url: "https://brukinsahcp.com/wp-content/uploads/patient-management.png",
      alt: "Patient Management Guide cover",
    });
  });

  it("suppresses lifestyle and product-shot imagery while keeping clinical figures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `
          <html>
            <head>
              <title>BRUKINSA BTK Inhibitor</title>
            </head>
            <body>
              <img src="/wp-content/uploads/hero-splash.jpg" alt="Man and boy jumping into water and making a splash" />
              <img src="/wp-content/uploads/2025/09/tablet1.png" alt="BRUKINSA dosing options" />
              <section>
                <h2>SEQUOIA efficacy</h2>
                <p>Hazard ratio and PFS data from the CLL/SLL study.</p>
                <img src="/wp-content/uploads/sequoia-pfs-chart.png" alt="KM curve showing superior PFS data vs BR for SEQUOIA" />
              </section>
            </body>
          </html>
          `,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 200,
          },
        ),
      ),
    );

    const preview = await previewSourceImages({
      url: "https://brukinsahcp.com/",
      title: "BRUKINSA BTK Inhibitor",
    });

    expect(preview.images.map((image) => image.url)).toEqual([
      "https://brukinsahcp.com/wp-content/uploads/sequoia-pfs-chart.png",
    ]);
  });

  it("returns no source figures when a page exposes only marketing images", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `
          <html>
            <head>
              <title>BRUKINSA BTK Inhibitor</title>
            </head>
            <body>
              <img src="/wp-content/uploads/hero-splash.jpg" alt="Man and boy jumping into water and making a splash" />
              <img src="/wp-content/uploads/2025/09/tablet1.png" alt="BRUKINSA dosing options" />
            </body>
          </html>
          `,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 200,
          },
        ),
      ),
    );

    const preview = await previewSourceImages({
      url: "https://brukinsahcp.com/",
      title: "BRUKINSA BTK Inhibitor",
    });

    expect(preview.images).toEqual([]);
    expect(preview.documents).toEqual([]);
    expect(preview.reason).toBe(
      "No useful image or document assets were found on this source page.",
    );
  });

  it("suppresses promotional mechanism graphics while keeping clinical tables", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `
          <html>
            <head>
              <title>The BRUKINSA Difference in MCL</title>
            </head>
            <body>
              <section>
                <h2>BTK inhibitor profile</h2>
                <img src="/wp-content/uploads/btk-stays-on.png" alt="BRUKINSA stays on, so BTK stays off" />
                <img src="/wp-content/uploads/up-to-100-percent.png" alt="Up to 100%" />
              </section>
              <section>
                <h2>Adverse reactions table</h2>
                <img src="/wp-content/uploads/mcl-adverse-reactions-table.png" alt="Table of adverse reactions in MCL" />
              </section>
            </body>
          </html>
          `,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 200,
          },
        ),
      ),
    );

    const preview = await previewSourceImages({
      url: "https://brukinsahcp.com/mcl/brukinsa-difference/",
      title: "The BRUKINSA Difference in MCL",
    });

    expect(preview.images.map((image) => image.url)).toEqual([
      "https://brukinsahcp.com/wp-content/uploads/mcl-adverse-reactions-table.png",
    ]);
  });

  it("suppresses travel hero artwork while keeping dosing guide covers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `
          <html>
            <head>
              <title>Official HCP Site for PADCEV</title>
            </head>
            <body>
              <section>
                <h1>Official HCP Site for PADCEV</h1>
                <img src="/assets/hero-airplane.png" alt="Airplane flying through sky" />
              </section>
              <section>
                <h2>Dosing and Administration Guide</h2>
                <p>PADCEV dosing and administration guide for HCPs.</p>
                <img src="/Content/hcp/pdf/dosing-admin-guide-cover.png" alt="PADCEV Dosing and Administration Guide cover" />
              </section>
            </body>
          </html>
          `,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 200,
          },
        ),
      ),
    );

    const preview = await previewSourceImages({
      url: "https://padcevhcp.com/",
      title: "Official HCP Site for PADCEV",
    });

    expect(preview.images.map((image) => image.url)).toEqual([
      "https://padcevhcp.com/Content/hcp/pdf/dosing-admin-guide-cover.png",
    ]);
  });

  it("surfaces PADCEV clinical resource PDFs when marketing imagery is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          `
          <html>
            <head>
              <title>Official HCP Site for PADCEV</title>
            </head>
            <body>
              <section>
                <h1>Official HCP Site for PADCEV</h1>
                <img src="/assets/hero-airplane.png" alt="Airplane flying through sky" />
              </section>
              <section>
                <h2>PADCEV resources</h2>
                <p>Resources to help monitor adverse reactions during PADCEV treatment.</p>
                <a href="/Content/hcp/pdf/adverse-reactions-monitoring-checklist.pdf">
                  Adverse Reactions Monitoring Checklist
                </a>
                <a href="/Content/hcp/pdf/dosing-and-administration-guide.pdf">
                  Dosing and Administration Guide
                </a>
              </section>
            </body>
          </html>
          `,
          {
            headers: { "content-type": "text/html; charset=utf-8" },
            status: 200,
          },
        ),
      ),
    );

    const preview = await previewSourceImages({
      url: "https://padcevhcp.com/",
      title: "Official HCP Site for PADCEV",
    });

    expect(preview.images).toEqual([]);
    expect(preview.documents.map((document) => document.title)).toEqual([
      "Adverse Reactions Monitoring Checklist",
      "Dosing and Administration Guide",
    ]);
    expect(preview.documents.map((document) => document.url)).toEqual([
      "https://padcevhcp.com/Content/hcp/pdf/adverse-reactions-monitoring-checklist.pdf",
      "https://padcevhcp.com/Content/hcp/pdf/dosing-and-administration-guide.pdf",
    ]);
  });
});
