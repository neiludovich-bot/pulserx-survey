import { SurveyAdminClient } from "../../../../src/components/SurveyAdminClient";

export default function NubeqaSurveyAdminPage() {
  return (
    <SurveyAdminClient
      liveHref="/surveys/nubeqa/"
      surveyMode="Adaptive HCP survey"
      surveyName="NUBEQA HCP"
      surveySlug="nubeqa"
    />
  );
}
