import { SurveyAdminClient } from "../../../../src/components/SurveyAdminClient";

export default function PadcevSurveyAdminPage() {
  return (
    <SurveyAdminClient
      liveHref="/surveys/padcev/"
      surveyMode="Adaptive HCP survey"
      surveyName="PADCEV HCP"
      surveySlug="padcev"
    />
  );
}
