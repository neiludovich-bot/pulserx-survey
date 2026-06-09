import Link from "next/link";
import { Suspense } from "react";
import { MvpAuditClient } from "../../../src/components/MvpAuditClient";

export default function MvpAuditPage() {
  return (
    <main className="shell">
      <section className="page-header">
        <Link className="back-link" href="/research">
          Back to research
        </Link>
        <p className="eyebrow">MVP Survey Audit</p>
        <h1>Interview Traces</h1>
        <p className="lede">
          Review hosted CustomGPT survey sessions with the participant turns,
          interviewer turns, and selection decisions captured for QA.
        </p>
      </section>

      <Suspense
        fallback={
          <section className="panel stack-sm">
            <h2>Loading Audit</h2>
            <p className="muted-copy">Fetching recent MVP survey traces...</p>
          </section>
        }
      >
        <MvpAuditClient />
      </Suspense>
    </main>
  );
}
