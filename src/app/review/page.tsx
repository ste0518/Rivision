"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { MathText } from "@/components/math-text";
import { PageHeader } from "@/components/page-header";
import { isDue } from "@/lib/srs";
import { hasLowLatexQuality } from "@/lib/card-render";
import type { ReviewRating } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";
const ratings: Array<[ReviewRating, string]> = [["again", "Again"], ["hard", "Hard"], ["good", "Good"], ["easy", "Easy"]];
export default function ReviewPage() {
  const store = useStudyStore();
  const [revealed, setRevealed] = useState(false);
  const [proofVisible, setProofVisible] = useState(false);
  const [deletedCardId, setDeletedCardId] = useState<string | null>(null);
  const [includeNeedsReview, setIncludeNeedsReview] = useState(false);
  const [includeMediumPriority, setIncludeMediumPriority] = useState(false);
  const dueCards = useMemo(
    () => store.revisionItems.filter((item) =>
      !item.isDeleted &&
      (item.curationDecision ?? "keep") !== "reject" &&
      (includeNeedsReview || (item.curationDecision ?? "keep") === "keep") &&
      (includeMediumPriority || item.priorityLabel === "very_high" || item.priorityLabel === "high" || item.priorityScore >= 70) &&
      item.standaloneValue !== "low" &&
      item.importance !== "not_required" &&
      !needsRepair(item) &&
      isDue(item),
    ),
    [includeMediumPriority, includeNeedsReview, store.revisionItems],
  );
  const card = dueCards[0];
  function rate(rating: ReviewRating) {
    if (!card) return;
    store.reviewItem(card.id, rating);
    setRevealed(false);
    setProofVisible(false);
  }
  function deleteCurrentCard() {
    if (!card) return;
    store.deleteRevisionItem(card.id);
    setDeletedCardId(card.id);
    setRevealed(false);
    setProofVisible(false);
  }
  function undoDelete() {
    if (!deletedCardId) return;
    store.restoreRevisionItem(deletedCardId);
    setDeletedCardId(null);
  }

  return (
    <div>
      <PageHeader title="Flashcard revision" description="Answer from memory, reveal the extracted definition or theorem, then self-grade to schedule the next review." />
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeNeedsReview} onChange={(event) => setIncludeNeedsReview(event.target.checked)} />
        Include needs review cards
      </label>
      <label className="mb-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={includeMediumPriority} onChange={(event) => setIncludeMediumPriority(event.target.checked)} />
        Include medium-priority kept cards
      </label>
      {deletedCardId ? (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-slate-950 px-4 py-3 text-sm text-white shadow-lg">
          <span>Card deleted</span>
          <Button size="sm" variant="secondary" onClick={undoDelete}>Undo</Button>
          <Button size="sm" variant="ghost" className="text-white hover:bg-slate-800" onClick={() => setDeletedCardId(null)}>Dismiss</Button>
        </div>
      ) : null}
      {!card ? (
        <Card>
          <CardContent className="pt-6">
            <p className="mb-4 text-slate-600">No due cards. Add or extract more cards, or come back when scheduled reviews are due.</p>
            <Link className="text-blue-700 underline" href="/cards">Go to cards</Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="mx-auto max-w-3xl">
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{displayLabel(card)}</Badge>
              <Badge variant="outline">{card.type}</Badge>
              <Badge variant="outline">{card.cardPurpose}</Badge>
              <Badge variant={card.importance}>{card.importance}</Badge>
              {card.extractionWarning || card.warnings?.length ? <Badge variant="unknown">check extraction</Badge> : null}
              {hasLowLatexQuality(card) ? <Badge variant="unknown">low LaTeX quality</Badge> : null}
            </div>
            <div className="pt-3">
              <MathText className="bg-transparent p-0 text-3xl font-semibold leading-tight tracking-tight text-slate-950">{card.cardFront}</MathText>
              {card.taskPrompt ? <MathText className="mt-2 bg-transparent p-0 text-sm text-slate-500">{card.taskPrompt}</MathText> : null}
            </div>
            <CardDescription>{dueCards.length} due card(s) · reviewed {card.reviewCount ?? 0} time(s)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {!revealed ? (
              <Button size="lg" onClick={() => setRevealed(true)}>Show answer</Button>
            ) : (
              <>
                <MathText>{card.answerLatex || card.statementLatex || card.answer || card.statement}</MathText>
                {card.proof && card.type !== "definition" ? (
                  <div className="rounded-lg border border-slate-200 p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-700">
                        {card.proofRequired ? "Proof required." : "Proof available, but guidance suggests it is not required."}
                      </p>
                      <Button size="sm" variant="outline" onClick={() => setProofVisible((current) => !current)}>
                        {proofVisible ? "Hide proof" : "Show proof"}
                      </Button>
                    </div>
                    {proofVisible ? <MathText className="bg-white">{card.proofLatex || card.proof}</MathText> : null}
                  </div>
                ) : null}
                <div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-600">
                  <p><strong>Source:</strong> {card.sourceLocation || "source unknown"}</p>
                  {card.guidanceReason ? <p><strong>Guidance:</strong> {card.guidanceReason}</p> : null}
                  {card.extractionWarning ? <p className="text-amber-700"><strong>Warning:</strong> {card.extractionWarning}</p> : null}
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  {ratings.map(([value, label]) => (
                    <Button key={value} variant={value === "again" ? "destructive" : value === "easy" ? "default" : "outline"} onClick={() => rate(value)}>
                      {label}
                    </Button>
                  ))}
                </div>
                <div className="flex justify-end">
                  <Button variant="outline" onClick={deleteCurrentCard}>Delete card</Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function needsRepair(item: { extractionWarning?: string; warnings?: string[] }) {
  return Boolean(
    item.extractionWarning ||
      item.warnings?.some((warning) =>
        warning.includes("Over-merged") ||
        warning.includes("Source location is missing") ||
        warning.includes("Question prompt") ||
        warning.includes("Title is unusually long") ||
        warning.includes("unrelated section") ||
        warning.includes("multiple major label"),
      ),
  );
}

function displayLabel(card: { type: string; theoremNumber?: string; sourceLocation?: string; displayTitle?: string }) {
  if (card.theoremNumber) return `${card.type.charAt(0).toUpperCase()}${card.type.slice(1)} ${card.theoremNumber}`;
  return card.sourceLocation || card.displayTitle || "source unknown";
}
