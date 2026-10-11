import type { Metadata } from "next";
import { ObjectionTrainer } from "../../../src/components/ObjectionTrainer";

export const metadata: Metadata = {
  title: "NUBEQA objection practice",
  description: "Practice responding to common HCP objections with coaching and approved evidence.",
};

export default function NubeqaTrainingPage() {
  return <ObjectionTrainer program="nubeqa" />;
}
