import { MvpCustomGptSurveyModal } from "../../../src/components/MvpCustomGptSurveyModal";

export default function PadcevSurveyPage() {
  return (
    <MvpCustomGptSurveyModal
      surveySlug="padcev"
      studyName="PADCEV HCP MVP"
      targetDurationSeconds={600}
    />
  );
}
