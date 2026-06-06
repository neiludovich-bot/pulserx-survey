import Link from "next/link";
import { SurveyImportForm } from "../../../src/components/SurveyImportForm";

export default function SurveyImportPage() {
  return (
    <main className="shell">
      <section className="page-header">
        <Link className="back-link" href="/research">
          Back to studies
        </Link>
        <p className="eyebrow">Survey Import</p>
        <h1>Create Study</h1>
        <p className="lede">
          Turn a DOCX question list or pasted raw guide into a runnable adaptive
          browser survey.
        </p>
      </section>

      <SurveyImportForm />
    </main>
  );
}
