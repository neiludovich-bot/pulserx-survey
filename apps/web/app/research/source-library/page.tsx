import Link from "next/link";
import { SourceLibraryClient } from "../../../src/components/SourceLibraryClient";

export default function SourceLibraryPage() {
  return (
    <main className="shell">
      <section className="page-header">
        <Link className="back-link" href="/research">
          Back to research
        </Link>
        <p className="eyebrow">Source Library</p>
        <h1>Approved Source Material</h1>
        <p className="lede">
          Add source pages, PDFs, excerpts, and priority assets that the
          adaptive interviewer can use for grounded answers and side-panel
          references.
        </p>
      </section>

      <SourceLibraryClient />
    </main>
  );
}
