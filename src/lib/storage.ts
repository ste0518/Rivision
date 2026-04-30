import type { GuidanceFile, RejectedRevisionItem, RevisionItem, ReviewSession, StudyFile } from "@/lib/types";

export type StudyState = { notesFiles: StudyFile[]; guidanceFiles: GuidanceFile[]; revisionItems: RevisionItem[]; rejectedItems: RejectedRevisionItem[]; reviewSessions: ReviewSession[]; };
export const emptyStudyState: StudyState = { notesFiles: [], guidanceFiles: [], revisionItems: [], rejectedItems: [], reviewSessions: [] };
const storageKey = "rivision.studyState.v1";
export function loadStudyState(): StudyState {
  if (typeof window === "undefined") return emptyStudyState;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return emptyStudyState;
  try { return { ...emptyStudyState, ...JSON.parse(raw) }; } catch { return emptyStudyState; }
}
export function saveStudyState(state: StudyState) { if (typeof window !== "undefined") window.localStorage.setItem(storageKey, JSON.stringify(state)); }
export function exportRevisionItems(items: RevisionItem[]) { return JSON.stringify(items, null, 2); }
export function importRevisionItems(json: string): RevisionItem[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("Imported JSON must be an array of RevisionItem objects.");
  return parsed as RevisionItem[];
}
