import { SurveyAdminClient } from "../../../../src/components/SurveyAdminClient";

export default function BrukinsaSurveyAdminPage() {
  return (
    <SurveyAdminClient
      liveHref="/surveys/brukinsa/"
      surveyMode="Adaptive HCP survey"
      surveyName="BRUKINSA HCP"
      surveySlug="brukinsa"
    />
  );
}
