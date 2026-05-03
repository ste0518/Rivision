"use client";

import { useEffect, useMemo, useState } from "react";
import { mathStatusFromValidation, validateLatexSnippet } from "@/lib/latex-validate";
import { createMockRevisionItems } from "@/lib/mock-data";
import {
  clearDebugData,
  clearParsedTextKeepCards,
  clearUploadedFilesKeepCards,
  emptyStudyState,
  exportActiveCardsJson,
  loadStudyState,
  migrateLocalStorageStudyStateToIndexedDB,
  resetStudyStateStorage,
  saveStudyState,
  type StudyState,
} from "@/lib/storage";
import { createId } from "@/lib/utils";
import type { GeneratedPracticeQuestion, GeneratedRevisionPack, MathStatus } from "@/lib/student-revision-schema";
import type { AssessmentMap, CourseKnowledgeMap, CourseMap, CourseStructureMap, CurationReport, EmbeddedRevisionItem, ExamPriorityMap, GuidanceFile, RejectedRevisionItem, RevisionItem, RevisionPack, ReviewRating, ReviewSession, StudyFile } from "@/lib/types";
import { applyReviewRating } from "@/lib/srs";
import { withValidation } from "@/lib/validation";

export function useStudyStore() {
  const [state, setState] = useState<StudyState>(emptyStudyState);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      loadStudyState()
        .then((loaded) => {
          if (cancelled) return;
          setState({ ...loaded, revisionItems: loaded.revisionItems.map(withValidation) });
          setStorageError("");
        })
        .catch((error) => {
          if (cancelled) return;
          setStorageError(error instanceof Error ? error.message : "Could not load local study data.");
        })
        .finally(() => {
          if (!cancelled) setReady(true);
        });
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    saveStudyState(state)
      .then(() => {
        if (!cancelled) setStorageError("");
      })
      .catch((error) => {
        if (!cancelled) setStorageError(error instanceof Error ? error.message : "Could not save local study data.");
      });
    return () => {
      cancelled = true;
    };
  }, [ready, state]);

  const actions = useMemo(() => ({
    addNotesFiles(files: StudyFile[]) { setState((current) => ({ ...current, notesFiles: [...current.notesFiles, ...files] })); },
    addGuidanceFiles(files: GuidanceFile[]) { setState((current) => ({ ...current, guidanceFiles: [...current.guidanceFiles, ...files] })); },
    updateFileRole(id: string, role: StudyFile["role"]) {
      setState((current) => ({
        ...current,
        notesFiles: current.notesFiles.map((file) => file.id === id ? { ...file, role, parsedDocument: file.parsedDocument ? { ...file.parsedDocument, role } : file.parsedDocument } : file),
        guidanceFiles: current.guidanceFiles.map((file) => file.id === id ? { ...file, role, parsedDocument: file.parsedDocument ? { ...file.parsedDocument, role } : file.parsedDocument } : file),
      }));
    },
    removeNotesFile(id: string) { setState((current) => ({ ...current, notesFiles: current.notesFiles.filter((file) => file.id !== id) })); },
    removeGuidanceFile(id: string) { setState((current) => ({ ...current, guidanceFiles: current.guidanceFiles.filter((file) => file.id !== id) })); },
    setRevisionItems(items: RevisionItem[], rejectedItems?: RejectedRevisionItem[], curation?: { embeddedItems?: EmbeddedRevisionItem[]; courseMap?: CourseMap; courseStructureMap?: CourseStructureMap; courseKnowledgeMap?: CourseKnowledgeMap; assessmentMap?: AssessmentMap; examPriorityMap?: ExamPriorityMap; revisionPack?: RevisionPack; curationReport?: CurationReport; studentRevisionPack?: GeneratedRevisionPack }) {
      setState((current) => ({
        ...current,
        revisionItems: items.map(withValidation),
        rejectedItems: rejectedItems ?? current.rejectedItems,
        embeddedItems: curation?.embeddedItems ?? current.embeddedItems,
        courseMap: curation?.courseMap ?? current.courseMap,
        courseStructureMap: curation?.courseStructureMap ?? current.courseStructureMap,
        courseKnowledgeMap: curation?.courseKnowledgeMap ?? current.courseKnowledgeMap,
        assessmentMap: curation?.assessmentMap ?? current.assessmentMap,
        examPriorityMap: curation?.examPriorityMap ?? current.examPriorityMap,
        revisionPack: curation?.revisionPack ?? current.revisionPack,
        curationReport: curation?.curationReport ?? current.curationReport,
        studentRevisionPack: curation?.studentRevisionPack ?? current.studentRevisionPack,
      }));
    },
    setStudentRevisionPack(pack: GeneratedRevisionPack | undefined) {
      setState((current) => ({ ...current, studentRevisionPack: pack }));
    },
    setPracticeQuestions(questions: GeneratedPracticeQuestion[]) {
      setState((current) => ({ ...current, practiceQuestions: questions }));
    },
    appendPracticeQuestions(extra: GeneratedPracticeQuestion[]) {
      setState((current) => ({ ...current, practiceQuestions: [...(current.practiceQuestions ?? []), ...extra] }));
    },
    recordPracticeAttempt(questionId: string) {
      const attemptedAt = new Date().toISOString();
      setState((current) => ({
        ...current,
        practiceAttempts: [...(current.practiceAttempts ?? []), { questionId, attemptedAt }],
      }));
    },
    patchStudentPackFormulaMathStatus(formulaId: string, mathStatus: MathStatus) {
      setState((current) => {
        const pack = current.studentRevisionPack;
        if (!pack) return current;
        return {
          ...current,
          studentRevisionPack: {
            ...pack,
            formulas: pack.formulas.map((f) => (f.id === formulaId ? { ...f, mathStatus } : f)),
          },
        };
      });
    },
    updateStudentPackFormulaLatex(formulaId: string, latex: string) {
      setState((current) => {
        const pack = current.studentRevisionPack;
        if (!pack) return current;
        const mathStatus = mathStatusFromValidation(validateLatexSnippet(latex));
        return {
          ...current,
          studentRevisionPack: {
            ...pack,
            formulas: pack.formulas.map((f) => (f.id === formulaId ? { ...f, latex, mathStatus } : f)),
          },
        };
      });
    },
    setRejectedItems(rejectedItems: RejectedRevisionItem[]) {
      setState((current) => ({ ...current, rejectedItems }));
    },
    upsertRevisionItem(item: RevisionItem) {
      setState((current) => {
        const existing = current.revisionItems.some((candidate) => candidate.id === item.id);
        const validated = withValidation({ ...item, updatedAt: new Date().toISOString() });
        return { ...current, revisionItems: existing ? current.revisionItems.map((candidate) => candidate.id === item.id ? validated : candidate) : [validated, ...current.revisionItems] };
      });
    },
    restoreRejectedItem(id: string) {
      setState((current) => {
        const rejected = current.rejectedItems.find((item) => item.id === id);
        if (!rejected?.originalItem) return current;
        return {
          ...current,
          rejectedItems: current.rejectedItems.filter((item) => item.id !== id),
          revisionItems: [withValidation({ ...rejected.originalItem, isDeleted: false, deletedAt: undefined, updatedAt: new Date().toISOString() }), ...current.revisionItems],
        };
      });
    },
    rejectRevisionItem(id: string, reason = "Rejected during manual review.") {
      setState((current) => {
        const item = current.revisionItems.find((candidate) => candidate.id === id);
        if (!item) return current;
        const rejected: RejectedRevisionItem = {
          id: `rejected_${id}`,
          originalCandidateId: item.relevanceScore?.candidateId,
          originalItem: withValidation({ ...item, curationDecision: "reject", curationReason: reason }),
          title: item.displayTitle || item.title,
          type: item.type,
          rawText: item.originalRawText || item.statement,
          rejectionCategory: "low_value",
          rejectionReason: reason,
          confidence: "medium",
          sourceLocation: item.sourceLocation,
        };
        return {
          ...current,
          revisionItems: current.revisionItems.filter((candidate) => candidate.id !== id),
          rejectedItems: [rejected, ...current.rejectedItems],
        };
      });
    },
    permanentlyDeleteRejectedItem(id: string) {
      setState((current) => ({ ...current, rejectedItems: current.rejectedItems.filter((item) => item.id !== id) }));
    },
    deleteRevisionItem(id: string) {
      const deletedAt = new Date().toISOString();
      setState((current) => ({
        ...current,
        revisionItems: current.revisionItems.map((item) => item.id === id ? withValidation({ ...item, isDeleted: true, deletedAt, updatedAt: deletedAt }) : item),
      }));
    },
    deleteRevisionItems(ids: string[]) {
      const idSet = new Set(ids);
      const deletedAt = new Date().toISOString();
      setState((current) => ({
        ...current,
        revisionItems: current.revisionItems.map((item) => idSet.has(item.id) ? withValidation({ ...item, isDeleted: true, deletedAt, updatedAt: deletedAt }) : item),
      }));
    },
    restoreRevisionItem(id: string) {
      const updatedAt = new Date().toISOString();
      setState((current) => ({
        ...current,
        revisionItems: current.revisionItems.map((item) => item.id === id ? withValidation({ ...item, isDeleted: false, deletedAt: undefined, updatedAt }) : item),
      }));
    },
    restoreRevisionItems(ids: string[]) {
      const idSet = new Set(ids);
      const updatedAt = new Date().toISOString();
      setState((current) => ({
        ...current,
        revisionItems: current.revisionItems.map((item) => idSet.has(item.id) ? withValidation({ ...item, isDeleted: false, deletedAt: undefined, updatedAt }) : item),
      }));
    },
    permanentlyDeleteRevisionItem(id: string) { setState((current) => ({ ...current, revisionItems: current.revisionItems.filter((item) => item.id !== id) })); },
    reviewItem(id: string, rating: ReviewRating) {
      setState((current) => {
        let session: ReviewSession | undefined;
        const revisionItems = current.revisionItems.map((item) => {
          if (item.id !== id) return item;
          const result = applyReviewRating(item, rating);
          session = result.session;
          return result.updatedItem;
        });
        return { ...current, revisionItems, reviewSessions: session ? [session, ...current.reviewSessions] : current.reviewSessions };
      });
    },
    seedMockData() {
      setState((current) => ({
        ...current,
        activePackId: current.activePackId || createId("ws"),
        revisionItems: createMockRevisionItems().map(withValidation),
      }));
    },
    resetAll() {
      void resetStudyStateStorage();
      setState(emptyStudyState);
    },
    /** Clears uploads, generated pack, cards, practice, progress — empty Study Pack state. */
    clearCurrentPack() {
      setState({ ...emptyStudyState, activePackId: createId("ws") });
    },
    ensureActivePackId() {
      setState((current) => (current.activePackId ? current : { ...current, activePackId: createId("ws") }));
    },
    /** Clear derived pack state before a fresh generation run (uploaded files unchanged). */
    resetDerivedPackState() {
      setState((current) => ({
        ...current,
        revisionItems: [],
        rejectedItems: [],
        embeddedItems: [],
        reviewSessions: [],
        courseMap: undefined,
        courseStructureMap: undefined,
        courseKnowledgeMap: undefined,
        assessmentMap: undefined,
        examPriorityMap: undefined,
        revisionPack: undefined,
        curationReport: undefined,
        studentRevisionPack: undefined,
        practiceQuestions: [],
        practiceAttempts: [],
      }));
    },
    /** Replace lecture files and wipe generated content; keeps assessment uploads when `keepGuidance` is true (default). */
    replaceNotesAndClearGenerated(notesFiles: StudyFile[], keepGuidance = true) {
      setState((current) => ({
        ...emptyStudyState,
        activePackId: createId("ws"),
        notesFiles,
        guidanceFiles: keepGuidance ? current.guidanceFiles : [],
      }));
    },
    replaceGuidanceAndClearGenerated(guidanceFiles: GuidanceFile[]) {
      setState((current) => ({
        ...emptyStudyState,
        activePackId: createId("ws"),
        notesFiles: current.notesFiles,
        guidanceFiles,
      }));
    },
    async migrateLocalStorage() {
      const migrated = await migrateLocalStorageStudyStateToIndexedDB();
      if (migrated) setState({ ...migrated, revisionItems: migrated.revisionItems.map(withValidation) });
      setStorageError("");
    },
    async clearDebugData() {
      await clearDebugData();
      setStorageError("");
    },
    async clearParsedTextKeepCards() {
      await clearParsedTextKeepCards();
      setState((current) => ({
        ...current,
        notesFiles: current.notesFiles.map((file) => ({ ...file, content: "", parsedDocument: undefined })),
        guidanceFiles: current.guidanceFiles.map((file) => ({ ...file, content: "", parsedDocument: undefined })),
      }));
      setStorageError("");
    },
    async clearUploadedFilesKeepCards() {
      await clearUploadedFilesKeepCards();
      setState((current) => ({ ...current, notesFiles: [], guidanceFiles: [] }));
      setStorageError("");
    },
    async exportActiveCardsJson() {
      return exportActiveCardsJson();
    },
  }), []);

  return { ...state, ready, storageError, ...actions };
}
