import type { Metadata } from "next";
import { StructuredInterview } from "../../../src/components/StructuredInterview";

export const metadata: Metadata = {
  title: "NUBEQA HCP discussion",
  description: "A 10-minute market research interview for healthcare professionals.",
};

export default function NubeqaSurveyPage() {
  return <StructuredInterview surveySlug="nubeqa" />;
}
