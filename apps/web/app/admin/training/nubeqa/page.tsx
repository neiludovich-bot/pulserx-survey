import type { Metadata } from "next";
import { TrainerResults } from "../../../../src/components/TrainerResults";

export const metadata: Metadata = { title: "NUBEQA objection practice: team results" };

export default function NubeqaTrainingResultsPage() {
  return <TrainerResults program="nubeqa" />;
}
