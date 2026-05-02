import Dexie, { type Table } from "dexie";
import { inferStudyFileRole } from "@/lib/course-files";
import { migrateStoredCards, normalizeCuratedRevisionResult } from "@/lib/normalization";
import { segmentRevisionCandidates } from "@/lib/segmentation";
import type { GeneratedPracticeQuestion, GeneratedRevisionPack } from "@/lib/student-revision-schema";
import type {
  AssessmentMap,
  CourseKnowledgeMap,
  CourseMap,
  CourseStructureMap,
  CurationReport,
  EmbeddedRevisionItem,
  ExamPriorityMap,
  GuidanceFile,
  ParsedDocument,
  ParseDiagnostics,
  RejectedRevisionItem,
  RevisionCandidateKind,
  RevisionItem,
  RevisionPack,
  ReviewSession,
  StudyFile,
  StudyFileRole,
} from "@/lib/types";

export type StudyState = {
  /** Workspace id for the current upload/pack; changes when replacing the pack or clearing. */
  activePackId: string;
  notesFiles: StudyFile[];
  guidanceFiles: GuidanceFile[];
  revisionItems: RevisionItem[];
  rejectedItems: RejectedRevisionItem[];
  embeddedItems: EmbeddedRevisionItem[];
  reviewSessions: ReviewSession[];
  courseMap?: CourseMap;
  courseStructureMap?: CourseStructureMap;
  courseKnowledgeMap?: CourseKnowledgeMap;
  assessmentMap?: AssessmentMap;
  examPriorityMap?: ExamPriorityMap;
  revisionPack?: RevisionPack;
  /** Structured exam-focused study pack (local/heuristic); distinct from card-bundle `revisionPack`. */
  studentRevisionPack?: GeneratedRevisionPack;
  practiceQuestions?: GeneratedPracticeQuestion[];
  practiceAttempts?: Array<{ questionId: string; attemptedAt: string }>;
  curationReport?: CurationReport;
};

export type StudyProject = {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  activeFileIds: string[];
  activePackId?: string;
};

export type StoredStudyFile = {
  id: string;
  projectId: string;
  name: string;
  role: StudyFileRole;
  collection: "notes" | "guidance";
  fileType: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  blob?: Blob;
};

export type StoredParsedDocument = {
  id: string;
  projectId: string;
  fileId: string;
  sourceFile: string;
  fileType: ParsedDocument["fileType"];
  role?: StudyFileRole;
  fullTextPreview: string;
  charCount: number;
  pageCount?: number;
  diagnostics: ParseDiagnostics;
  createdAt: string;
};

export type StoredParsedPage = {
  id: string;
  projectId: string;
  documentId: string;
  pageNumber: number;
  text: string;
  charCount: number;
};

export type StoredRevisionCandidate = {
  id: string;
  projectId: string;
  documentId?: string;
  label?: string;
  number?: string;
  conceptName?: string;
  rawText: string;
  sourceLocation?: string;
  pageNumber?: number;
  candidateKind: RevisionCandidateKind;
};

type StoredCourseMaps = {
  id: string;
  projectId: string;
  courseMap?: CourseMap;
  courseStructureMap?: CourseStructureMap;
  courseKnowledgeMap?: CourseKnowledgeMap;
  curationReport?: CurationReport;
};

type StoredAssessmentMap = { id: string; projectId: string; assessmentMap?: AssessmentMap };
type StoredPriorityMap = { id: string; projectId: string; examPriorityMap?: ExamPriorityMap };
type StoredRevisionPack = {
  id: string;
  projectId: string;
  overview?: string;
  courseType?: RevisionPack["courseType"];
  topPriorityTopics?: RevisionPack["topPriorityTopics"];
  topTopics?: RevisionPack["topTopics"];
  studentRevisionPack?: GeneratedRevisionPack;
  practiceQuestions?: GeneratedPracticeQuestion[];
  practiceAttempts?: Array<{ questionId: string; attemptedAt: string }>;
  activePackId?: string;
};

export type LocalStorageKeyUsage = { key: string; bytes: number };
export type StorageUsageEstimate = {
  usageBytes?: number;
  quotaBytes?: number;
  localStorageBytes: number;
  localStorageKeys: LocalStorageKeyUsage[];
  indexedDbCounts: Record<string, number>;
};

export type RevisionStyleSetting = "concise_exam" | "detailed_guide" | "flashcard_heavy" | "problem_heavy";
export type AiStrictnessSetting = "conservative" | "balanced" | "broad";
export type MathFormattingSetting = "auto_clean" | "flag_broken";

export type StorageSettings = {
  persistDebugData: boolean;
  interfaceMode: "simple" | "advanced";
  /** When true (or interfaceMode advanced), show extraction/debug tooling. */
  developerMode: boolean;
  /** Default: new uploads replace the current lecture file(s) and generated pack. */
  uploadReplacePack: boolean;
  revisionStyle: RevisionStyleSetting;
  aiStrictness: AiStrictnessSetting;
  mathFormatting: MathFormattingSetting;
};

type LocalStudyPointer = {
  schemaVersion: 2;
  activeProjectId: string;
  settings: StorageSettings;
  updatedAt: string;
};

export function mergeStorageSettings(partial?: Partial<StorageSettings>): StorageSettings {
  return { ...defaultStorageSettings, ...partial };
}

type FullProjectExport = {
  schemaVersion: 2;
  exportedAt: string;
  project: StudyProject;
  settings: StorageSettings;
  files: Array<Omit<StoredStudyFile, "blob"> & { blobBase64?: string }>;
  parsedDocuments: StoredParsedDocument[];
  parsedPages: StoredParsedPage[];
  revisionItems: RevisionItem[];
  rejectedItems: RejectedRevisionItem[];
  embeddedItems: EmbeddedRevisionItem[];
  reviewHistory: ReviewSession[];
  courseMaps?: StoredCourseMaps;
  assessmentMap?: AssessmentMap;
  examPriorityMap?: ExamPriorityMap;
  revisionPack?: StoredRevisionPack;
};

export const emptyStudyState: StudyState = {
  activePackId: "",
  notesFiles: [],
  guidanceFiles: [],
  revisionItems: [],
  rejectedItems: [],
  embeddedItems: [],
  reviewSessions: [],
  practiceQuestions: [],
  practiceAttempts: [],
};

export const studyStateLocalStorageKey = "rivision.studyState.v1";

const defaultProjectId = "default";
const dbName = "rivision.study.v2";
const previewLimit = 1000;
const evidenceLimit = 500;
const debugPreviewLimit = 300;
const localStorageValueLimitBytes = 100 * 1024;
const appLocalStorageLimitBytes = 200 * 1024;
const defaultStorageSettings: StorageSettings = {
  persistDebugData: false,
  interfaceMode: "simple",
  developerMode: false,
  uploadReplacePack: true,
  revisionStyle: "concise_exam",
  aiStrictness: "balanced",
  mathFormatting: "auto_clean",
};

class RivisionDatabase extends Dexie {
  projects!: Table<StudyProject, string>;
  files!: Table<StoredStudyFile, string>;
  parsedDocuments!: Table<StoredParsedDocument, string>;
  parsedPages!: Table<StoredParsedPage, string>;
  candidates!: Table<StoredRevisionCandidate, string>;
  revisionItems!: Table<RevisionItem & { projectId: string }, string>;
  rejectedItems!: Table<RejectedRevisionItem & { projectId: string }, string>;
  embeddedItems!: Table<EmbeddedRevisionItem & { projectId: string }, string>;
  courseMaps!: Table<StoredCourseMaps, string>;
  assessmentMaps!: Table<StoredAssessmentMap, string>;
  priorityMaps!: Table<StoredPriorityMap, string>;
  revisionPacks!: Table<StoredRevisionPack, string>;
  reviewEvents!: Table<ReviewSession & { projectId: string }, string>;

  constructor() {
    super(dbName);
    this.version(2).stores({
      projects: "&id, updatedAt",
      files: "&id, projectId, role, collection",
      parsedDocuments: "&id, projectId, fileId",
      parsedPages: "&id, projectId, documentId, [documentId+pageNumber]",
      candidates: "&id, projectId, documentId, candidateKind",
      revisionItems: "&id, projectId, updatedAt, isDeleted",
      rejectedItems: "&id, projectId",
      embeddedItems: "&id, projectId, parentItemId",
      courseMaps: "&id, projectId",
      assessmentMaps: "&id, projectId",
      priorityMaps: "&id, projectId",
      revisionPacks: "&id, projectId",
      reviewEvents: "&id, projectId, itemId, reviewedAt",
    });
  }
}

class StoragePersistenceError extends Error {
  constructor(message: string, cause?: unknown) {
    super(cause instanceof Error ? `${message}: ${cause.message}` : message);
    this.name = "StoragePersistenceError";
  }
}

let dbInstance: RivisionDatabase | undefined;

export async function loadStudyState(): Promise<StudyState> {
  if (!isBrowser()) return emptyStudyState;
  try {
    const migrated = await migrateLocalStorageStudyStateToIndexedDB();
    if (migrated) return migrated;
    const pointer = readLocalPointer();
    if (!pointer) return emptyStudyState;
    return await loadProjectFromIndexedDb(pointer.activeProjectId);
  } catch (error) {
    throw new StoragePersistenceError("Could not load local study data", error);
  }
}

export async function saveStudyState(state: StudyState): Promise<void> {
  if (!isBrowser()) return;
  const pointer = readLocalPointer();
  const activeProjectId = pointer?.activeProjectId ?? defaultProjectId;
  await saveStudyStateToIndexedDb(activeProjectId, state);
  writeLocalPointer(activeProjectId, mergeStorageSettings(pointer?.settings));
}

export async function migrateLocalStorageStudyStateToIndexedDB(): Promise<StudyState | undefined> {
  if (!isBrowser()) return undefined;
  const raw = window.localStorage.getItem(studyStateLocalStorageKey);
  if (!raw) return undefined;
  const pointer = parsePointer(raw);
  if (pointer) return undefined;

  let parsed: Partial<StudyState>;
  try {
    parsed = JSON.parse(raw) as Partial<StudyState>;
  } catch (error) {
    throw new StoragePersistenceError("Legacy localStorage study data is not valid JSON. Export or reset from the recovery UI", error);
  }

  const state = normalizeStoredStudyState(parsed);
  await saveStudyStateToIndexedDb(defaultProjectId, state, "Migrated local project");
  writeLocalPointer(defaultProjectId, defaultStorageSettings);
  return state;
}

export async function resetStudyStateStorage(): Promise<void> {
  if (!isBrowser()) return;
  window.localStorage.removeItem(studyStateLocalStorageKey);
  await deleteIndexedDb();
}

export async function resetAllLocalData(): Promise<void> {
  if (!isBrowser()) return;
  for (const key of rivisionLocalStorageKeys()) window.localStorage.removeItem(key);
  for (const key of rivisionSessionStorageKeys()) window.sessionStorage.removeItem(key);
  await deleteIndexedDb();
}

export function safeSetLocalStorage(key: string, value: unknown): void {
  if (!isBrowser()) return;
  const serialized = JSON.stringify(value);
  const valueBytes = byteSize(serialized);
  if (valueBytes > localStorageValueLimitBytes) {
    throw new StoragePersistenceError("Attempted to store large object in localStorage. Use IndexedDB instead.");
  }

  const totalBytes = rivisionLocalStorageKeys()
    .filter((candidate) => candidate !== key)
    .reduce((total, candidate) => total + byteSize(window.localStorage.getItem(candidate) ?? ""), valueBytes);
  if (totalBytes > appLocalStorageLimitBytes) {
    throw new StoragePersistenceError("Attempted to store large object in localStorage. Use IndexedDB instead.");
  }

  try {
    window.localStorage.setItem(key, serialized);
  } catch (error) {
    throw new StoragePersistenceError("Local storage is full. Large data should be stored in IndexedDB. Please clear cache or migrate storage", error);
  }
}

export async function estimateStorageUsage(): Promise<StorageUsageEstimate> {
  const estimate = isBrowser() && navigator.storage?.estimate ? await navigator.storage.estimate() : {};
  const localStorageKeys = isBrowser()
    ? rivisionLocalStorageKeys().map((key) => ({ key, bytes: byteSize(window.localStorage.getItem(key) ?? "") }))
    : [];
  const indexedDbCounts: Record<string, number> = {};
  if (isBrowser() && hasIndexedDb()) {
    const db = getDb();
    await Promise.all(db.tables.map(async (table) => {
      try {
        indexedDbCounts[table.name] = await table.count();
      } catch {
        indexedDbCounts[table.name] = 0;
      }
    }));
  }
  return {
    usageBytes: estimate.usage,
    quotaBytes: estimate.quota,
    localStorageBytes: localStorageKeys.reduce((total, key) => total + key.bytes, 0),
    localStorageKeys,
    indexedDbCounts,
  };
}

export async function clearDebugData(): Promise<void> {
  if (!isBrowser() || !hasIndexedDb()) return;
  const projectId = getActiveProjectId();
  await getDb().candidates.where("projectId").equals(projectId).delete();
  for (const key of rivisionSessionStorageKeys()) {
    if (key.startsWith("rivision.debug")) window.sessionStorage.removeItem(key);
  }
}

export async function clearParsedTextKeepCards(): Promise<void> {
  if (!isBrowser() || !hasIndexedDb()) return;
  const projectId = getActiveProjectId();
  const db = getDb();
  await db.transaction("rw", db.parsedDocuments, db.parsedPages, db.candidates, async () => {
    await db.parsedDocuments.where("projectId").equals(projectId).delete();
    await db.parsedPages.where("projectId").equals(projectId).delete();
    await db.candidates.where("projectId").equals(projectId).delete();
  });
}

export async function clearUploadedFilesKeepCards(): Promise<void> {
  if (!isBrowser() || !hasIndexedDb()) return;
  const projectId = getActiveProjectId();
  const db = getDb();
  await db.transaction("rw", [db.projects, db.files, db.parsedDocuments, db.parsedPages, db.candidates], async () => {
    await db.files.where("projectId").equals(projectId).delete();
    await db.parsedDocuments.where("projectId").equals(projectId).delete();
    await db.parsedPages.where("projectId").equals(projectId).delete();
    await db.candidates.where("projectId").equals(projectId).delete();
    const project = await db.projects.get(projectId);
    if (project) await db.projects.put({ ...project, activeFileIds: [], updatedAt: new Date().toISOString() });
  });
}

export async function deleteCurrentProject(): Promise<void> {
  if (!isBrowser() || !hasIndexedDb()) return;
  const projectId = getActiveProjectId();
  await deleteProjectRecords(projectId);
  writeLocalPointer(defaultProjectId, readLocalPointer()?.settings ?? defaultStorageSettings);
}

export function loadStorageSettings(): StorageSettings {
  return mergeStorageSettings(readLocalPointer()?.settings);
}

export function saveStorageSettings(settings: StorageSettings): void {
  const activeProjectId = getActiveProjectId();
  writeLocalPointer(activeProjectId, mergeStorageSettings(settings));
  if (isBrowser()) window.dispatchEvent(new CustomEvent("rivision-settings"));
}

/** UI that should stay hidden until the user opts into developer tools. */
export function isDeveloperUiEnabled(): boolean {
  const s = loadStorageSettings();
  return Boolean(s.developerMode);
}

export async function persistRevisionCandidates(documents: ParsedDocument[]): Promise<void> {
  if (!isBrowser() || !hasIndexedDb()) return;
  const projectId = getActiveProjectId();
  const db = getDb();
  const bySource = await db.parsedDocuments.where("projectId").equals(projectId).toArray();
  const documentIdBySource = new Map(bySource.map((document) => [document.sourceFile, document.id]));
  const candidates = segmentRevisionCandidates(documents).map((candidate): StoredRevisionCandidate => ({
    id: candidate.id,
    projectId,
    documentId: documentIdBySource.get(candidate.sourceFile),
    label: candidate.label,
    number: candidate.number,
    conceptName: candidate.conceptName ?? candidate.title,
    rawText: capText(candidate.rawText, evidenceLimit),
    sourceLocation: candidate.sourceLocation,
    pageNumber: candidate.pageNumber,
    candidateKind: candidate.candidateKind ?? "ordinary_text",
  }));
  await db.transaction("rw", db.candidates, async () => {
    await db.candidates.where("projectId").equals(projectId).delete();
    if (candidates.length) await db.candidates.bulkPut(candidates);
  });
}

export async function exportActiveCardsJson(): Promise<string> {
  const state = await loadStudyState();
  return exportRevisionItems(state.revisionItems.filter((item) => !item.isDeleted));
}

export async function exportFullProjectJson(options: { includeSourceFiles?: boolean } = {}): Promise<string> {
  if (!isBrowser() || !hasIndexedDb()) return JSON.stringify({ schemaVersion: 2, revisionItems: [] }, null, 2);
  const projectId = getActiveProjectId();
  const db = getDb();
  const [project, files, parsedDocuments, parsedPages, revisionItems, rejectedItems, embeddedItems, reviewHistory, courseMaps, assessmentMap, examPriorityMap, revisionPack] = await Promise.all([
    db.projects.get(projectId),
    db.files.where("projectId").equals(projectId).toArray(),
    db.parsedDocuments.where("projectId").equals(projectId).toArray(),
    db.parsedPages.where("projectId").equals(projectId).toArray(),
    db.revisionItems.where("projectId").equals(projectId).toArray(),
    db.rejectedItems.where("projectId").equals(projectId).toArray(),
    db.embeddedItems.where("projectId").equals(projectId).toArray(),
    db.reviewEvents.where("projectId").equals(projectId).toArray(),
    db.courseMaps.get(mapRecordId(projectId, "course")),
    db.assessmentMaps.get(mapRecordId(projectId, "assessment")),
    db.priorityMaps.get(mapRecordId(projectId, "priority")),
    db.revisionPacks.get(mapRecordId(projectId, "pack")),
  ]);
  const exportedFiles = await Promise.all(files.map(async (file) => {
    const { blob, ...metadata } = file;
    return {
      ...metadata,
      blobBase64: options.includeSourceFiles && blob ? await blobToBase64(blob) : undefined,
    };
  }));
  const payload: FullProjectExport = {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    project: project ?? { id: projectId, name: "Rivision project", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), activeFileIds: [] },
    settings: loadStorageSettings(),
    files: exportedFiles,
    parsedDocuments,
    parsedPages,
    revisionItems: revisionItems.map(stripProjectId),
    rejectedItems: rejectedItems.map(stripProjectId),
    embeddedItems: embeddedItems.map(stripProjectId),
    reviewHistory: reviewHistory.map(stripProjectId),
    courseMaps,
    assessmentMap: assessmentMap?.assessmentMap,
    examPriorityMap: examPriorityMap?.examPriorityMap,
    revisionPack,
  };
  return JSON.stringify(payload, null, 2);
}

export async function importFullProjectJson(json: string): Promise<StudyState> {
  const parsed = JSON.parse(json) as Partial<FullProjectExport> & Partial<StudyState>;
  const projectId = parsed.project?.id || `project_${Date.now()}`;
  const state = stateFromProjectImport(parsed);
  await saveStudyStateToIndexedDb(projectId, state, parsed.project?.name ?? "Imported project");
  if (parsed.files?.some((file) => file.blobBase64)) {
    const filesWithBlobs = await Promise.all(parsed.files.map(async (file) => {
      const { blobBase64, ...metadata } = file;
      return {
        ...metadata,
        projectId,
        blob: blobBase64 ? base64ToBlob(blobBase64, file.mimeType) : undefined,
      };
    }));
    await getDb().files.bulkPut(filesWithBlobs);
  }
  writeLocalPointer(projectId, parsed.settings ?? defaultStorageSettings);
  return state;
}

export function exportRevisionItems(items: RevisionItem[]) {
  return JSON.stringify(items, null, 2);
}

export function importRevisionItems(json: string): RevisionItem[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error("Imported JSON must be an array of RevisionItem objects.");
  return migrateStoredCards(parsed);
}

async function loadProjectFromIndexedDb(projectId: string): Promise<StudyState> {
  if (!hasIndexedDb()) return emptyStudyState;
  const db = getDb();
  const [files, documents, pages, revisionItems, rejectedItems, embeddedItems, reviewSessions, courseMaps, assessmentMap, priorityMap, revisionPack] = await Promise.all([
    db.files.where("projectId").equals(projectId).toArray(),
    db.parsedDocuments.where("projectId").equals(projectId).toArray(),
    db.parsedPages.where("projectId").equals(projectId).toArray(),
    db.revisionItems.where("projectId").equals(projectId).toArray(),
    db.rejectedItems.where("projectId").equals(projectId).toArray(),
    db.embeddedItems.where("projectId").equals(projectId).toArray(),
    db.reviewEvents.where("projectId").equals(projectId).toArray(),
    db.courseMaps.get(mapRecordId(projectId, "course")),
    db.assessmentMaps.get(mapRecordId(projectId, "assessment")),
    db.priorityMaps.get(mapRecordId(projectId, "priority")),
    db.revisionPacks.get(mapRecordId(projectId, "pack")),
  ]);
  const documentsByFileId = new Map(documents.map((document) => [document.fileId, document]));
  const pagesByDocumentId = groupBy(pages, (page) => page.documentId);
  const hydratedFiles = files.map((file) => hydrateStudyFile(file, documentsByFileId.get(file.id), pagesByDocumentId.get(documentIdForFile(file.id)) ?? []));
  const cleanRevisionItems = migrateStoredCards(revisionItems.map(stripProjectId));
  const normalizedCuration = normalizeCuratedRevisionResult({
    revisionItems: cleanRevisionItems,
    rejectedItems: rejectedItems.map(stripProjectId),
    embeddedItems: embeddedItems.map(stripProjectId),
    courseStructureMap: courseMaps?.courseStructureMap,
    courseKnowledgeMap: courseMaps?.courseKnowledgeMap,
    examPriorityMap: priorityMap?.examPriorityMap,
    revisionPack: reconstructRevisionPack(revisionPack, cleanRevisionItems, rejectedItems.map(stripProjectId), embeddedItems.map(stripProjectId)),
    curationReport: courseMaps?.curationReport,
  });
  return {
    notesFiles: hydratedFiles.filter((file) => file.collection === "notes").map(stripCollection),
    guidanceFiles: hydratedFiles.filter((file) => file.collection === "guidance").map((file) => ({ ...stripCollection(file), kind: "guidance" }) as GuidanceFile),
    revisionItems: cleanRevisionItems,
    rejectedItems: normalizedCuration.rejectedItems,
    embeddedItems: normalizedCuration.embeddedItems,
    reviewSessions: reviewSessions.map(stripProjectId).sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt)),
    courseMap: courseMaps?.courseMap,
    courseStructureMap: normalizedCuration.courseStructureMap,
    courseKnowledgeMap: normalizedCuration.courseKnowledgeMap,
    assessmentMap: assessmentMap?.assessmentMap,
    examPriorityMap: normalizedCuration.examPriorityMap,
    revisionPack: normalizedCuration.revisionPack,
    studentRevisionPack: revisionPack?.studentRevisionPack,
    practiceQuestions: revisionPack?.practiceQuestions ?? [],
    practiceAttempts: revisionPack?.practiceAttempts ?? [],
    curationReport: normalizedCuration.curationReport,
    activePackId: revisionPack?.activePackId ?? "",
  };
}

async function saveStudyStateToIndexedDb(projectId: string, state: StudyState, projectName = "Rivision project"): Promise<void> {
  if (!hasIndexedDb()) throw new StoragePersistenceError("IndexedDB is unavailable in this browser.");
  const db = getDb();
  const now = new Date().toISOString();
  const existingProject = await db.projects.get(projectId);
  const files = [
    ...state.notesFiles.map((file) => toStoredFile(file, projectId, "notes")),
    ...state.guidanceFiles.map((file) => toStoredFile(file, projectId, "guidance")),
  ];
  const { documents, pages } = toStoredParsedRecords(projectId, [...state.notesFiles, ...state.guidanceFiles]);

  await db.transaction(
    "rw",
    [
      db.projects,
      db.files,
      db.parsedDocuments,
      db.parsedPages,
      db.revisionItems,
      db.rejectedItems,
      db.embeddedItems,
      db.courseMaps,
      db.assessmentMaps,
      db.priorityMaps,
      db.revisionPacks,
      db.reviewEvents,
    ],
    async () => {
      await db.projects.put({
        id: projectId,
        name: existingProject?.name ?? projectName,
        createdAt: existingProject?.createdAt ?? now,
        updatedAt: now,
        activeFileIds: files.map((file) => file.id),
        activePackId: state.revisionPack ? mapRecordId(projectId, "pack") : undefined,
      });
      await replaceProjectRows(db.files, projectId, files);
      await replaceProjectRows(db.parsedDocuments, projectId, documents);
      await replaceProjectRows(db.parsedPages, projectId, pages);
      await replaceProjectRows(db.revisionItems, projectId, state.revisionItems.map((item) => ({ ...compactRevisionItem(item), projectId })));
      await replaceProjectRows(db.rejectedItems, projectId, state.rejectedItems.map((item) => ({ ...compactRejectedItem(item), projectId })));
      await replaceProjectRows(db.embeddedItems, projectId, state.embeddedItems.map((item) => ({ ...compactEmbeddedItem(item), projectId })));
      await replaceProjectRows(db.reviewEvents, projectId, state.reviewSessions.map((session) => ({ ...session, projectId })));
      await db.courseMaps.put({
        id: mapRecordId(projectId, "course"),
        projectId,
        courseMap: state.courseMap,
        courseStructureMap: state.courseStructureMap,
        courseKnowledgeMap: state.courseKnowledgeMap,
        curationReport: state.curationReport ? compactCurationReport(state.curationReport) : undefined,
      });
      await db.assessmentMaps.put({ id: mapRecordId(projectId, "assessment"), projectId, assessmentMap: state.assessmentMap });
      await db.priorityMaps.put({ id: mapRecordId(projectId, "priority"), projectId, examPriorityMap: state.examPriorityMap });
      await db.revisionPacks.put(toStoredRevisionPack(projectId, state));
    },
  );
}

function normalizeStoredStudyState(parsed: Partial<StudyState>): StudyState {
  const normalizedCuration = normalizeCuratedRevisionResult(parsed);
  return {
    ...emptyStudyState,
    ...parsed,
    activePackId: typeof parsed.activePackId === "string" ? parsed.activePackId : "",
    notesFiles: normalizeStudyFiles(parsed.notesFiles, "lecture_notes"),
    guidanceFiles: normalizeStudyFiles(parsed.guidanceFiles, "exam_guidance") as GuidanceFile[],
    revisionItems: migrateStoredCards(parsed.revisionItems),
    rejectedItems: normalizedCuration.rejectedItems,
    embeddedItems: normalizedCuration.embeddedItems,
    reviewSessions: Array.isArray(parsed.reviewSessions) ? parsed.reviewSessions : [],
    courseMap: parsed.courseMap,
    courseStructureMap: parsed.courseStructureMap ? normalizedCuration.courseStructureMap : undefined,
    courseKnowledgeMap: parsed.courseKnowledgeMap ? normalizedCuration.courseKnowledgeMap : undefined,
    assessmentMap: parsed.assessmentMap,
    examPriorityMap: parsed.examPriorityMap ? normalizedCuration.examPriorityMap : undefined,
    revisionPack: parsed.revisionPack ? normalizedCuration.revisionPack : undefined,
    studentRevisionPack: parsed.studentRevisionPack,
    practiceQuestions: Array.isArray(parsed.practiceQuestions) ? parsed.practiceQuestions : [],
    practiceAttempts: Array.isArray(parsed.practiceAttempts) ? parsed.practiceAttempts : [],
    curationReport: parsed.curationReport ? normalizedCuration.curationReport : undefined,
  };
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

function toStoredFile(file: StudyFile, projectId: string, collection: "notes" | "guidance"): StoredStudyFile {
  return {
    id: file.id,
    projectId,
    name: file.name,
    role: file.role,
    collection,
    fileType: file.parsedDocument?.fileType ?? file.mimeType ?? "unknown",
    mimeType: file.mimeType || "unknown",
    sizeBytes: file.size,
    createdAt: file.uploadedAt,
    blob: file.blob,
  };
}

function toStoredParsedRecords(projectId: string, files: StudyFile[]) {
  const documents: StoredParsedDocument[] = [];
  const pages: StoredParsedPage[] = [];
  for (const file of files) {
    if (!file.parsedDocument && !file.content) continue;
    const parsedDocument = file.parsedDocument ?? legacyParsedDocument(file.name, file.content, file.role);
    const documentId = documentIdForFile(file.id);
    const documentPages = parsedDocument.pages?.length
      ? parsedDocument.pages
      : parsedDocument.fullText
        ? [{ pageNumber: 1, text: parsedDocument.fullText, charCount: parsedDocument.fullText.length }]
        : [];
    documents.push({
      id: documentId,
      projectId,
      fileId: file.id,
      sourceFile: parsedDocument.sourceFile || file.name,
      fileType: parsedDocument.fileType || "unknown",
      role: file.role ?? parsedDocument.role,
      fullTextPreview: capText(parsedDocument.fullText, previewLimit),
      charCount: parsedDocument.diagnostics?.charCount ?? parsedDocument.fullText.length,
      pageCount: parsedDocument.diagnostics?.pageCount ?? documentPages.length,
      diagnostics: compactDiagnostics(parsedDocument.diagnostics, parsedDocument.fullText.length, documentPages.length),
      createdAt: file.uploadedAt,
    });
    pages.push(...documentPages.map((page) => ({
      id: `${documentId}:page:${page.pageNumber}`,
      projectId,
      documentId,
      pageNumber: page.pageNumber,
      text: page.text,
      charCount: page.charCount ?? page.text.length,
    })));
  }
  return { documents, pages };
}

function hydrateStudyFile(file: StoredStudyFile, document: StoredParsedDocument | undefined, pages: StoredParsedPage[]) {
  const sortedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  const fullText = sortedPages.length ? sortedPages.map((page) => page.text).join("\n\n") : document?.fullTextPreview ?? "";
  const parsedDocument: ParsedDocument | undefined = document
    ? {
        sourceFile: document.sourceFile,
        fileType: document.fileType,
        role: document.role ?? file.role,
        fullText,
        pages: sortedPages.map((page) => ({ pageNumber: page.pageNumber, text: page.text, charCount: page.charCount })),
        sections: [],
        diagnostics: document.diagnostics,
      }
    : undefined;
  return {
    id: file.id,
    name: file.name,
    role: file.role,
    mimeType: file.mimeType,
    size: file.sizeBytes,
    uploadedAt: file.createdAt,
    content: fullText,
    parsedDocument,
    blob: file.blob,
    collection: file.collection,
  };
}

function legacyParsedDocument(sourceFile: string, fullText: string, role?: StudyFileRole): ParsedDocument {
  return {
    sourceFile,
    fileType: "unknown",
    role,
    fullText,
    diagnostics: {
      success: Boolean(fullText.trim()),
      charCount: fullText.length,
      warnings: fullText ? ["Legacy file without diagnostics. Re-upload for full parser diagnostics."] : [],
      errors: [],
      extractionQuality: fullText.trim() ? "medium" : "failed",
    },
  };
}

function compactDiagnostics(diagnostics: ParseDiagnostics | undefined, charCount: number, pageCount?: number): ParseDiagnostics {
  return {
    success: diagnostics?.success ?? charCount > 0,
    charCount: diagnostics?.charCount ?? charCount,
    pageCount: diagnostics?.pageCount ?? pageCount,
    warnings: (diagnostics?.warnings ?? []).map((warning) => capText(warning, evidenceLimit)),
    errors: (diagnostics?.errors ?? []).map((error) => capText(error, evidenceLimit)),
    likelyScannedPdf: diagnostics?.likelyScannedPdf,
    extractionQuality: diagnostics?.extractionQuality ?? (charCount > 0 ? "medium" : "failed"),
  };
}

function compactRevisionItem(item: RevisionItem): RevisionItem {
  return {
    ...item,
    originalRawText: item.originalRawText ? capText(item.originalRawText, evidenceLimit) : undefined,
    guidanceEvidence: item.guidanceEvidence?.map((value) => capText(value, evidenceLimit)),
    uncertaintyNote: item.uncertaintyNote ? capText(item.uncertaintyNote, evidenceLimit) : undefined,
    extractionWarning: item.extractionWarning ? capText(item.extractionWarning, evidenceLimit) : undefined,
    curationReason: item.curationReason ? capText(item.curationReason, evidenceLimit) : undefined,
    relevanceReason: item.relevanceReason ? capText(item.relevanceReason, evidenceLimit) : undefined,
    relevanceScore: item.relevanceScore ? { ...item.relevanceScore, evidence: item.relevanceScore.evidence.map((value) => capText(value, evidenceLimit)) } : undefined,
    warnings: item.warnings?.map((warning) => capText(warning, evidenceLimit)),
  };
}

function compactRejectedItem(item: RejectedRevisionItem): RejectedRevisionItem {
  return {
    ...item,
    rawText: item.rawText ? capText(item.rawText, evidenceLimit) : undefined,
    rejectionReason: capText(item.rejectionReason, evidenceLimit),
    originalItem: item.originalItem ? compactRevisionItem(item.originalItem) : undefined,
  };
}

function compactEmbeddedItem(item: EmbeddedRevisionItem): EmbeddedRevisionItem {
  return {
    ...item,
    content: capText(item.content, evidenceLimit),
    reason: capText(item.reason, evidenceLimit),
  };
}

function compactCurationReport(report: CurationReport): CurationReport {
  return {
    ...report,
    mainTopics: report.mainTopics.map((topic) => capText(topic, evidenceLimit)),
    weakParsingWarnings: report.weakParsingWarnings.map((warning) => capText(warning, evidenceLimit)),
    pipelineStages: report.pipelineStages?.map((stage) => ({ ...stage, detail: capText(stage.detail, evidenceLimit) })),
    notes: report.notes.map((note) => capText(note, evidenceLimit)),
  };
}

function toStoredRevisionPack(projectId: string, state: StudyState): StoredRevisionPack {
  const revisionPack = state.revisionPack;
  return {
    id: mapRecordId(projectId, "pack"),
    projectId,
    overview: revisionPack?.overview ? capText(revisionPack.overview, previewLimit) : undefined,
    courseType: revisionPack?.courseType,
    topPriorityTopics: revisionPack?.topPriorityTopics,
    topTopics: revisionPack?.topTopics ?? [],
    studentRevisionPack: state.studentRevisionPack,
    practiceQuestions: state.practiceQuestions,
    practiceAttempts: state.practiceAttempts,
    activePackId: state.activePackId || undefined,
  };
}

function reconstructRevisionPack(
  stored: StoredRevisionPack | undefined,
  items: RevisionItem[],
  rejectedItems: RejectedRevisionItem[],
  embeddedItems: EmbeddedRevisionItem[],
): RevisionPack | undefined {
  if (!stored && items.length === 0 && rejectedItems.length === 0) return undefined;
  const byCategory = (category: RevisionItem["revisionPackCategory"]) => items.filter((item) => item.revisionPackCategory === category);
  return {
    overview: stored?.overview ?? "Revision pack reconstructed from stored cards.",
    courseType: stored?.courseType,
    topPriorityTopics: stored?.topPriorityTopics,
    topTopics: stored?.topTopics ?? [],
    mustKnowDefinitions: byCategory("mustKnowDefinitions"),
    modelsToKnow: byCategory("modelsToKnow"),
    conditionsAndEquivalences: byCategory("conditionsAndEquivalences"),
    keyFormulas: byCategory("formulasToKnow"),
    theoremStatements: byCategory("theoremStatements"),
    testStatisticsAndDiagnostics: byCategory("testStatisticsAndDiagnostics"),
    proofsToKnow: byCategory("proofsToKnow"),
    formulasToKnow: byCategory("formulasToKnow"),
    methodsAndTemplates: byCategory("methodsAndTemplates"),
    conceptualDistinctions: byCategory("conceptualDistinctions"),
    workedExamplePatterns: byCategory("workedExamplePatterns"),
    needsReview: items.filter((item) => item.revisionPackCategory === "needsReview" || item.curationDecision === "needs_review"),
    rejected: rejectedItems,
    embedded: embeddedItems,
  };
}

function stateFromProjectImport(parsed: Partial<FullProjectExport> & Partial<StudyState>): StudyState {
  if (Array.isArray(parsed.revisionItems) && !parsed.files) return normalizeStoredStudyState(parsed);
  const pagesByDocumentId = groupBy(parsed.parsedPages ?? [], (page) => page.documentId);
  const documentsByFileId = new Map((parsed.parsedDocuments ?? []).map((document) => [document.fileId, document]));
  const files = (parsed.files ?? []).map((file) => hydrateStudyFile({ ...file, blob: undefined }, documentsByFileId.get(file.id), pagesByDocumentId.get(documentIdForFile(file.id)) ?? []));
  const revisionItems = migrateStoredCards(parsed.revisionItems ?? []);
  return {
    notesFiles: files.filter((file) => file.collection === "notes").map(stripCollection),
    guidanceFiles: files.filter((file) => file.collection === "guidance").map((file) => ({ ...stripCollection(file), kind: "guidance" }) as GuidanceFile),
    revisionItems,
    rejectedItems: parsed.rejectedItems ?? [],
    embeddedItems: parsed.embeddedItems ?? [],
    reviewSessions: parsed.reviewHistory ?? [],
    courseMap: parsed.courseMaps?.courseMap,
    courseStructureMap: parsed.courseMaps?.courseStructureMap,
    courseKnowledgeMap: parsed.courseMaps?.courseKnowledgeMap,
    curationReport: parsed.courseMaps?.curationReport,
    assessmentMap: parsed.assessmentMap,
    examPriorityMap: parsed.examPriorityMap,
    revisionPack: reconstructRevisionPack(parsed.revisionPack, revisionItems, parsed.rejectedItems ?? [], parsed.embeddedItems ?? []),
    studentRevisionPack: parsed.revisionPack?.studentRevisionPack,
    practiceQuestions: parsed.revisionPack?.practiceQuestions ?? [],
    practiceAttempts: parsed.revisionPack?.practiceAttempts ?? [],
    activePackId: parsed.revisionPack?.activePackId ?? "",
  };
}

async function replaceProjectRows<T extends { projectId: string }>(table: Table<T, string>, projectId: string, rows: T[]) {
  await table.where("projectId").equals(projectId).delete();
  if (rows.length) await table.bulkPut(rows);
}

async function deleteProjectRecords(projectId: string) {
  const db = getDb();
  await db.transaction("rw", db.tables, async () => {
    await Promise.all(db.tables.map(async (table) => {
      if (table.name === "projects") await db.projects.delete(projectId);
      else await table.where("projectId").equals(projectId).delete();
    }));
  });
}

async function deleteIndexedDb() {
  if (!hasIndexedDb()) return;
  if (dbInstance?.isOpen()) dbInstance.close();
  dbInstance = undefined;
  await Dexie.delete(dbName);
}

function getDb() {
  if (!hasIndexedDb()) throw new StoragePersistenceError("IndexedDB is unavailable in this browser.");
  dbInstance ??= new RivisionDatabase();
  return dbInstance;
}

function readLocalPointer(): LocalStudyPointer | undefined {
  if (!isBrowser()) return undefined;
  return parsePointer(window.localStorage.getItem(studyStateLocalStorageKey));
}

function parsePointer(raw: string | null): LocalStudyPointer | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalStudyPointer>;
    if (parsed.schemaVersion !== 2 || typeof parsed.activeProjectId !== "string") return undefined;
    return {
      schemaVersion: 2,
      activeProjectId: parsed.activeProjectId,
      settings: mergeStorageSettings(parsed.settings as Partial<StorageSettings> | undefined),
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    };
  } catch {
    return undefined;
  }
}

function writeLocalPointer(activeProjectId: string, settings: StorageSettings) {
  safeSetLocalStorage(studyStateLocalStorageKey, {
    schemaVersion: 2,
    activeProjectId,
    settings: mergeStorageSettings(settings),
    updatedAt: new Date().toISOString(),
  } satisfies LocalStudyPointer);
}

function getActiveProjectId() {
  return readLocalPointer()?.activeProjectId ?? defaultProjectId;
}

function documentIdForFile(fileId: string) {
  return `doc_${fileId}`;
}

function mapRecordId(projectId: string, kind: "course" | "assessment" | "priority" | "pack") {
  return `${projectId}:${kind}`;
}

function stripProjectId<T extends { projectId?: string }>(value: T): Omit<T, "projectId"> {
  const rest = { ...value };
  delete rest.projectId;
  return rest;
}

function stripCollection<T extends { collection?: "notes" | "guidance" }>(value: T): Omit<T, "collection"> {
  const rest = { ...value };
  delete rest.collection;
  return rest;
}

function groupBy<T, K>(items: T[], getKey: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = getKey(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
}

function capText(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}

function byteSize(value: string) {
  return new Blob([value]).size;
}

function rivisionLocalStorageKeys() {
  if (!isBrowser()) return [];
  return Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith("rivision.")));
}

function rivisionSessionStorageKeys() {
  if (!isBrowser()) return [];
  return Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith("rivision.")));
}

function isBrowser() {
  return typeof window !== "undefined";
}

function hasIndexedDb() {
  return typeof indexedDB !== "undefined";
}

async function blobToBase64(blob: Blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBlob(base64: string, mimeType: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

export const storageDebugLimits = {
  evidenceLimit,
  previewLimit,
  debugPreviewLimit,
  localStorageValueLimitBytes,
  appLocalStorageLimitBytes,
};
