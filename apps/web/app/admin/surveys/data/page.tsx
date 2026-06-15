import { SurveyAdminClient } from "../../../../src/components/SurveyAdminClient";

export default function DataSurveyAdminPage() {
  return (
    <SurveyAdminClient
      liveHref="/surveys/data/"
      surveyMode="Fixed-flow one-off"
      surveyName="Data Survey"
      surveySlug="data"
    />
  );
}
