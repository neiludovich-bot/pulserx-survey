"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AdminGate } from "./AdminGate";
import { SurveyImportForm } from "./SurveyImportForm";

const IMPORT_PRESETS: Record<
  string,
  { name: string; targetMinutes: number; label: string }
> = {
  data: {
    name: "Data Survey",
    targetMinutes: 10,
    label: "Data",
  },
  padcev: {
    name: "PADCEV HCP Survey",
    targetMinutes: 10,
    label: "PADCEV",
  },
  brukinsa: {
    name: "BRUKINSA HCP Survey",
    targetMinutes: 10,
    label: "BRUKINSA",
  },
  nubeqa: {
    name: "NUBEQA HCP Survey",
    targetMinutes: 10,
    label: "NUBEQA",
  },
};

export function AdminImportClient() {
  const searchParams = useSearchParams();
  const requestedSurvey = searchParams.get("survey") ?? "";
  const preset = IMPORT_PRESETS[requestedSurvey] ?? null;

  return (
    <AdminGate>
      {(_session, { logout }) => (
        <main className="admin-page">
          <section className="admin-shell">
            <header className="admin-topbar">
              <div>
                <Link className="admin-back-link" href="/admin/">
                  Survey Admin
                </Link>
                <p className="admin-kicker">Guide Import</p>
                <h1>
                  {preset ? `Import ${preset.label}` : "Import Survey Guide"}
                </h1>
                <p>
                  Upload a DOCX or paste raw questions. The importer will
                  publish a runnable survey guide and return you to its admin
                  page.
                </p>
              </div>
              <button className="admin-button" onClick={logout} type="button">
                Sign out
              </button>
            </header>

            <SurveyImportForm
              defaultStudyName={preset?.name}
              defaultTargetDurationMinutes={preset?.targetMinutes}
              mode="admin"
            />
          </section>
        </main>
      )}
    </AdminGate>
  );
}
