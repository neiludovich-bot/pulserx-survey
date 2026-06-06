import Link from "next/link";
import { getStudies } from "../src/api";

export default async function HomePage() {
  const studies = await getStudies();
  const featuredStudy = studies[0] ?? null;

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Adaptive Market Research Interviewing</p>
        <h1>Interview Agent</h1>
        <p className="lede">
          Run a seeded interview end to end in the browser, then inspect the
          exact question graph, transcript, analyses, and decisions in the
          researcher console.
        </p>
        <div className="callout-grid">
          <article className="card">
            <span className="label">Researcher Console</span>
            <strong>Study graph + audit trail</strong>
            <Link className="text-link" href="/research">
              Open researcher view
            </Link>
          </article>
          <article className="card">
            <span className="label">Seeded Study</span>
            <strong>{featuredStudy?.name ?? "No studies seeded yet"}</strong>
            {featuredStudy ? (
              <Link
                className="text-link"
                href={`/research/studies/${featuredStudy.id}`}
              >
                Inspect graph
              </Link>
            ) : null}
          </article>
        </div>
      </section>
    </main>
  );
}
