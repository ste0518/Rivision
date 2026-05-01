import { migrateStoredCards, normalizeCuratedRevisionResult } from "@/lib/normalization";
import type { CourseKnowledgeMap, CourseStructureMap, CurationReport, EmbeddedRevisionItem, GuidanceFile, RejectedRevisionItem, RevisionItem, ReviewSession, StudyFile } from "@/lib/types";

export type StudyState = {
  notesFiles: StudyFile[];
  guidanceFiles: GuidanceFile[];
  revisionItems: RevisionItem[];
  rejectedItems: RejectedRevisionItem[];
  embeddedItems: EmbeddedRevisionItem[];
  reviewSessions: ReviewSession[];
  courseStructureMap?: CourseStructureMap;
  courseKnowledgeMap?: CourseKnowledgeMap;
  curationReport?: CurationReport;
};
export const emptyStudyState: StudyState = { notesFiles: [], guidanceFiles: [], revisionItems: [], rejectedItems: [], embeddedItems: [], reviewSessions: [] };
const storageKey = "rivision.studyState.v1";
export function loadStudyState(): StudyState {
  if (typeof window === "undefined") return emptyStudyState;
  const raw = window.localStorage.getItem(storageKey);
  if (!raw) return emptyStudyState;
  try {
    const parsed = JSON.parse(raw) as Partial<StudyState>;
    const normalizedCuration = normalizeCuratedRevisionResult(parsed);
    return {
      ...emptyStudyState,
      ...parsed,
      notesFiles: Array.isArray(parsed.notesFiles) ? parsed.notesFiles : [],
      guidanceFiles: Array.isArray(parsed.guidanceFiles) ? parsed.guidanceFiles : [],
      revisionItems: migrateStoredCards(parsed.revisionItems),
      rejectedItems: normalizedCuration.rejectedItems,
      embeddedItems: normalizedCuration.embeddedItems,
      reviewSessions: Array.isArray(parsed.reviewSessions) ? parsed.reviewSessions : [],
      courseStructureMap: parsed.courseStructureMap ? normalizedCuration.courseStructureMap : undefined,
      courseKnowledgeMap: parsed.courseKnowledgeMap ? normalizedCuration.courseKnowledgeMap : undefined,
      curationReport: parsed.curationReport ? normalizedCuration.curationReport : undefined,
    };
  } catch {
    return emptyStudyState;
  }
}
export function saveStudyState(state: StudyState) { if (typeof window !== "undefined") window.localStorage.setItem(storageKey, JSON.stringify(state)); }
export function resetStudyStateStorage() { if (typeof window !== "undefined") window.localStorage.removeItem(storageKey); }
export function exportRevisionItems(items: RevisionItem[]) { return JSON.stringify(items, null, 2); }
export function importRevisionItems(json: string): RevisionItem[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("Imported JSON must be an array of RevisionItem objects.");
  return migrateStoredCards(parsed);
}
