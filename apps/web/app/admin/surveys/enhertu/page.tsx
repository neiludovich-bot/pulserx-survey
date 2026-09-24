import { SurveyAdminClient } from "../../../../src/components/SurveyAdminClient";

export default function EnhertuSurveyAdminPage() {
  return (
    <SurveyAdminClient
      liveHref="/surveys/enhertu/"
      surveyMode="Adaptive HCP survey"
      surveyName="ENHERTU HCP"
      surveySlug="enhertu"
    />
  );
}
