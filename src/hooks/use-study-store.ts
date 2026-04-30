"use client";

import { useEffect, useMemo, useState } from "react";
import { createMockRevisionItems } from "@/lib/mock-data";
import { emptyStudyState, loadStudyState, saveStudyState, type StudyState } from "@/lib/storage";
import type { GuidanceFile, RejectedRevisionItem, RevisionItem, ReviewRating, ReviewSession, StudyFile } from "@/lib/types";
import { applyReviewRating } from "@/lib/srs";
import { withValidation } from "@/lib/validation";

export function useStudyStore() {
  const [state, setState] = useState<StudyState>(emptyStudyState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      const loaded = loadStudyState();
      setState({ ...loaded, revisionItems: loaded.revisionItems.map(withValidation) });
      setReady(true);
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => { if (ready) saveStudyState(state); }, [ready, state]);

  const actions = useMemo(() => ({
    addNotesFiles(files: StudyFile[]) { setState((current) => ({ ...current, notesFiles: [...current.notesFiles, ...files] })); },
    addGuidanceFiles(files: GuidanceFile[]) { setState((current) => ({ ...current, guidanceFiles: [...current.guidanceFiles, ...files] })); },
    removeNotesFile(id: string) { setState((current) => ({ ...current, notesFiles: current.notesFiles.filter((file) => file.id !== id) })); },
    removeGuidanceFile(id: string) { setState((current) => ({ ...current, guidanceFiles: current.guidanceFiles.filter((file) => file.id !== id) })); },
    setRevisionItems(items: RevisionItem[], rejectedItems?: RejectedRevisionItem[]) {
      setState((current) => ({ ...current, revisionItems: items.map(withValidation), rejectedItems: rejectedItems ?? current.rejectedItems }));
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
        if (!rejected) return current;
        return {
          ...current,
          rejectedItems: current.rejectedItems.filter((item) => item.id !== id),
          revisionItems: [withValidation({ ...rejected.originalItem, isDeleted: false, deletedAt: undefined, updatedAt: new Date().toISOString() }), ...current.revisionItems],
        };
      });
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
    seedMockData() { setState((current) => ({ ...current, revisionItems: createMockRevisionItems().map(withValidation) })); },
    resetAll() { setState(emptyStudyState); },
  }), []);

  return { ...state, ready, ...actions };
}
