"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AdminGate } from "./AdminGate";
import { SourceLibraryClient } from "./SourceLibraryClient";

export function AdminSourceLibraryClient() {
  const searchParams = useSearchParams();
  const initialSurveySlug = searchParams.get("survey") ?? "padcev";

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
                <p className="admin-kicker">Source Library</p>
                <h1>Approved Source Material</h1>
                <p>
                  Import source packs, add approved excerpts, and attach source
                  assets used by grounded survey answers.
                </p>
              </div>
              <button className="admin-button" onClick={logout} type="button">
                Sign out
              </button>
            </header>

            <SourceLibraryClient initialSurveySlug={initialSurveySlug} />
          </section>
        </main>
      )}
    </AdminGate>
  );
}
