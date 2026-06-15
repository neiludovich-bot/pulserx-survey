import { MvpCustomGptSurveyModal } from "../../../src/components/MvpCustomGptSurveyModal";

export default function DataSurveyPage() {
  return (
    <MvpCustomGptSurveyModal
      surveySlug="data"
      studyName="Data Survey"
      targetDurationSeconds={600}
    />
  );
}
