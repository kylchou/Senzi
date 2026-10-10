import type { Provenance, SourceId } from "@/lib/model/types";
import type { StudyStatus } from "./types";

/** JSON shape of GET /api/studies/:studyId/preview. Dates are ISO strings. */
export interface StudyPreview {
  id: string;
  marketId: string | null;
  question: string;
  status: StudyStatus;
  deadline: string;
  startupName: string | null;
  model: number | null;
  crowd: number | null;
  verified: number | null;
  participants: number;
  history: {
    at: string;
    modelValue: number | null;
    yesShare: number | null;
    specializedPrice: number | null;
    totalCredits: number;
    participantCount: number;
  }[];
  /** Data the model was fit to, with where it came from. */
  sources: { label: string; source: SourceId; url: string | null; provenance: Provenance; simulated: boolean }[];
}
