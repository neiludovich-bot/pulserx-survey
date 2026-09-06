"use client";

import { useEffect, useState, type FormEvent } from "react";
import { WEBSITE_PROFILES, websiteRefreshSettingsSchema, type WebsiteRefreshState } from "@interview/schemas";
import { getWebsiteRefreshes, saveWebsiteRefreshSettings, refreshSurveyWebsite } from "../api";

export function WebsiteRefreshPanel() {
  const [websites, setWebsites] = useState<WebsiteRefreshState[]>([]);
  const [slug, setSlug] = useState("nubeqa");
  const [root, setRoot] = useState<string>(WEBSITE_PROFILES.nubeqa.rootUrl);
  const [hosts, setHosts] = useState<string>(WEBSITE_PROFILES.nubeqa.hosts.join(", "));
  const [documents, setDocuments] = useState<string>(WEBSITE_PROFILES.nubeqa.documentHosts.join(", "));
  const [intervalHours, setIntervalHours] = useState(168);
  const [enabled, setEnabled] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const reload = async () => setWebsites((await getWebsiteRefreshes()).websites);
  useEffect(() => {
    let active = true;
    const load = async () => { try { const result = await getWebsiteRefreshes(); if (active) setWebsites(result.websites); } catch (e) { if (active) setError(e instanceof Error ? e.message : "Unable to load website status"); } };
    void load(); const timer = setInterval(() => { void load(); }, 15000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  function edit(value: string) {
    setSlug(value);
    const saved = websites.find(w => w.surveySlug === value);
    const profile = saved?.profile ?? WEBSITE_PROFILES[value as keyof typeof WEBSITE_PROFILES];
    setRoot(profile?.rootUrl ?? ""); setHosts(profile?.hosts.join(", ") ?? ""); setDocuments(profile?.documentHosts.join(", ") ?? "");
    setIntervalHours(saved?.intervalHours ?? 168); setEnabled(saved?.enabled ?? true);
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setMessage(null);
    try {
      const split = (value: string) => value.split(",").map(h => h.trim().toLowerCase()).filter(Boolean);
      const input = websiteRefreshSettingsSchema.parse({ surveySlug: slug.trim(), profile: { rootUrl: root.trim(), hosts: split(hosts), documentHosts: split(documents) }, intervalHours, enabled });
      await saveWebsiteRefreshSettings(input); await reload(); setMessage("Website saved. Initial refresh queued; text, images and tables are included automatically.");
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to save website"); } finally { setBusy(false); }
  }
  async function refresh(value: string) {
    setBusy(true); setError(null);
    try { await refreshSurveyWebsite(value); await reload(); setMessage("Refresh queued. This page will update as it runs."); }
    catch (e) { setError(e instanceof Error ? e.message : "Unable to queue refresh"); } finally { setBusy(false); }
  }
  const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Not yet";
  return <section className="panel stack-md" aria-label="Website indexing and refresh">
    <h2>Survey websites &amp; automatic refresh</h2>
    <p>Every index includes website text, images and data tables. Relevant figures appear alongside answers and rotate every four seconds when more than one is selected.</p>
    <p>Save a website to start its first index. Weekly refresh is the default. Earlier source versions remain available for existing citations. Website setup supplies the survey’s evidence; its interview guide is configured separately.</p>
    {error && <p role="alert">{error}</p>}{message && <p role="status">{message}</p>}
    <form className="stack-md" onSubmit={save}>
      <div className="form-grid">
        <label className="form-field"><span>Existing website</span><select aria-label="Existing website" value={slug in WEBSITE_PROFILES || websites.some(w=>w.surveySlug===slug) ? slug : "new"} onChange={e=>edit(e.target.value === "new" ? "" : e.target.value)}>
          {[...new Set([...Object.keys(WEBSITE_PROFILES), ...websites.map(w=>w.surveySlug)])].map(s=><option key={s} value={s}>{s.toUpperCase()}</option>)}<option value="new">Add a new survey website</option>
        </select></label>
        <label className="form-field"><span>Survey slug</span><input required value={slug} onChange={e=>setSlug(e.target.value)} placeholder="new-survey" /></label>
        <label className="form-field"><span>Medical website URL</span><input required type="url" value={root} onChange={e=>setRoot(e.target.value)} placeholder="https://www.examplehcp.com/" /></label>
        <label className="form-field"><span>Approved website hostnames (comma separated)</span><input required value={hosts} onChange={e=>setHosts(e.target.value)} placeholder="www.examplehcp.com, examplehcp.com" /></label>
        <label className="form-field"><span>Linked PDF hostnames (optional)</span><input value={documents} onChange={e=>setDocuments(e.target.value)} /></label>
        <label className="form-field"><span>Refresh frequency</span><select value={intervalHours} onChange={e=>setIntervalHours(Number(e.target.value))}><option value={24}>Daily</option><option value={168}>Weekly</option><option value={720}>Every 30 days</option></select></label>
      </div>
      <label className="checkbox-field"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)} />Enable scheduled refreshes</label>
      <button className="admin-button" type="submit" disabled={busy}>Save website &amp; index</button>
    </form>
    {websites.map(website=><article className="panel stack-sm" key={website.surveySlug}>
      <h3>{website.surveySlug.toUpperCase()} — {website.status}</h3>
      <p>{website.profile.rootUrl}</p>
      <p>Last finished: {date(website.lastFinishedAt)} · Next scheduled: {website.enabled ? date(website.nextRunAt) : "Paused"}</p>
      {website.summary && <><p>{website.summary.pages} pages · {website.summary.images} images · {website.summary.tables} tables · {website.summary.issueCount} crawl issues{website.summary.truncated ? " · Crawl limit reached" : ""}</p>{website.summary.issueCount > 0 && <details><summary>Coverage issues (first 20)</summary><ul>{website.summary.issues.map((issue,i)=><li key={i}>{issue.url}: {issue.reason}</li>)}</ul></details>}</>}
      {website.lastError && <p>{website.lastError}</p>}
      <div className="button-row"><button type="button" className="admin-button" disabled={busy || website.status === "running" || website.status === "queued"} onClick={()=>void refresh(website.surveySlug)}>Refresh {website.surveySlug.toUpperCase()} now</button><button type="button" className="admin-button" onClick={()=>edit(website.surveySlug)}>Edit {website.surveySlug.toUpperCase()}</button></div>
    </article>)}
  </section>;
}
