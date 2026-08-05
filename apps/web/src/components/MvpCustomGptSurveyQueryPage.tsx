"use client";

import { useEffect, useState } from "react";
import { MvpCustomGptSurveyModal } from "./MvpCustomGptSurveyModal";

function readSurveySlug() {
  if (typeof window === "undefined") {
    return "brukinsa";
  }

  const survey = new URLSearchParams(window.location.search)
    .get("survey")
    ?.trim()
    .toLowerCase();

  if (survey === "padcev" || survey === "data" || survey === "nubeqa") {
    return survey;
  }

  return "brukinsa";
}

export function MvpCustomGptSurveyQueryPage() {
  const [surveySlug, setSurveySlug] = useState<
    "brukinsa" | "padcev" | "data" | "nubeqa" | null
  >(null);

  useEffect(() => {
    setSurveySlug(readSurveySlug());
  }, []);

  if (!surveySlug) {
    return null;
  }

  if (surveySlug === "padcev") {
    return (
      <MvpCustomGptSurveyModal
        surveySlug="padcev"
        studyName="PADCEV HCP MVP"
        targetDurationSeconds={600}
      />
    );
  }

  if (surveySlug === "data") {
    return (
      <MvpCustomGptSurveyModal
        surveySlug="data"
        studyName="Data Survey"
        targetDurationSeconds={600}
      />
    );
  }

  if (surveySlug === "nubeqa") {
    return (
      <MvpCustomGptSurveyModal
        surveySlug="nubeqa"
        studyName="NUBEQA HCP MVP"
        targetDurationSeconds={600}
      />
    );
  }

  return (
    <MvpCustomGptSurveyModal
      surveySlug="brukinsa"
      studyName="BRUKINSA HCP MVP"
      targetDurationSeconds={600}
    />
  );
}
