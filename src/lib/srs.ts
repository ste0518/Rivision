import type { ReviewRating, RevisionItem, ReviewSession } from "@/lib/types";
import { createId } from "@/lib/utils";

const dayMs = 24 * 60 * 60 * 1000;
export function nextDueDate(rating: ReviewRating, from = new Date()) {
  const delay = rating === "again" ? 0 : rating === "hard" ? 1 : rating === "good" ? 3 : 7;
  return new Date(from.getTime() + delay * dayMs).toISOString();
}
export function applyReviewRating(item: RevisionItem, rating: ReviewRating) {
  const reviewedAt = new Date().toISOString();
  const session: ReviewSession = { id: createId("review"), itemId: item.id, rating, reviewedAt };
  const updatedItem: RevisionItem = { ...item, latestRating: rating, reviewCount: (item.reviewCount ?? 0) + 1, dueAt: nextDueDate(rating, new Date(reviewedAt)), lastReviewedAt: reviewedAt, updatedAt: reviewedAt };
  return { updatedItem, session };
}
export function isDue(item: RevisionItem, now = new Date()) { return !item.dueAt || new Date(item.dueAt) <= now; }
