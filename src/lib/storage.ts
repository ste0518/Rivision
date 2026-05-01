import { migrateStoredCards, normalizeCuratedRevisionResult } from "@/lib/normalization";
import { inferStudyFileRole } from "@/lib/course-files";
import type { CourseKnowledgeMap, CourseStructureMap, CurationReport, EmbeddedRevisionItem, ExamPriorityMap, GuidanceFile, RejectedRevisionItem, RevisionItem, RevisionPack, ReviewSession, StudyFile } from "@/lib/types";

export type StudyState = {
  notesFiles: StudyFile[];
  guidanceFiles: GuidanceFile[];
  revisionItems: RevisionItem[];
  rejectedItems: RejectedRevisionItem[];
  embeddedItems: EmbeddedRevisionItem[];
  reviewSessions: ReviewSession[];
  courseStructureMap?: CourseStructureMap;
  courseKnowledgeMap?: CourseKnowledgeMap;
  examPriorityMap?: ExamPriorityMap;
  revisionPack?: RevisionPack;
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
      notesFiles: normalizeStudyFiles(parsed.notesFiles, "lecture_notes"),
      guidanceFiles: normalizeStudyFiles(parsed.guidanceFiles, "exam_guidance") as GuidanceFile[],
      revisionItems: migrateStoredCards(parsed.revisionItems),
      rejectedItems: normalizedCuration.rejectedItems,
      embeddedItems: normalizedCuration.embeddedItems,
      reviewSessions: Array.isArray(parsed.reviewSessions) ? parsed.reviewSessions : [],
      courseStructureMap: parsed.courseStructureMap ? normalizedCuration.courseStructureMap : undefined,
      courseKnowledgeMap: parsed.courseKnowledgeMap ? normalizedCuration.courseKnowledgeMap : undefined,
      examPriorityMap: parsed.examPriorityMap ? normalizedCuration.examPriorityMap : undefined,
      revisionPack: parsed.revisionPack ? normalizedCuration.revisionPack : undefined,
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

function normalizeStudyFiles(raw: unknown, fallbackRole: StudyFile["role"]): StudyFile[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((file) => {
    if (!file || typeof file !== "object") return [];
    const value = file as StudyFile;
    const role = value.role ?? inferStudyFileRole(value.name || "") ?? fallbackRole;
    return [{ ...value, role, parsedDocument: value.parsedDocument ? { ...value.parsedDocument, role } : value.parsedDocument }];
  });
}
