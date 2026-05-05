"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { MathText } from "@/components/math-text";
import { PageHeader } from "@/components/page-header";
import { isDue } from "@/lib/srs";
import { hasLowLatexQuality } from "@/lib/card-render";
import { normalizeMathNotation } from "@/lib/revision-item-utils";
import { revisionPackCategories, type ReviewRating, type RevisionItem } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";
const ratings: Array<[ReviewRating, string]> = [["again", "Again"], ["hard", "Hard"], ["good", "Good"], ["easy", "Easy"]];
export default function ReviewPage() {
  const store = useStudyStore();
  const [revealed, setRevealed] = useState(false);
  const [proofVisible, setProofVisible] = useState(false);
  const [sourceVisible, setSourceVisible] = useState(false);
  const [deletedCardId, setDeletedCardId] = useState<string | null>(null);
  const [includeNeedsReview, setIncludeNeedsReview] = useState(false);
  const [includeMediumPriority, setIncludeMediumPriority] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [mathStatus, setMathStatus] = useState("");
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings-status")
      .then((res) => res.json() as Promise<{ openaiConfigured?: boolean }>)
      .then((json) => {
        if (!cancelled) setApiOk(Boolean(json.openaiConfigured));
      })
      .catch(() => {
        if (!cancelled) setApiOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const requestedCardId = typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("card") ?? "";
  const dueCards = useMemo(
    () => store.revisionItems.filter((item) =>
      !item.isDeleted &&
      (item.curationDecision ?? "keep") !== "reject" &&
      (includeNeedsReview || (item.curationDecision ?? "keep") === "keep") &&
      (includeMediumPriority || item.priorityLabel === "very_high" || item.priorityLabel === "high" || item.priorityScore >= 70) &&
      (categoryFilter === "all" || item.revisionPackCategory === categoryFilter) &&
      item.standaloneValue !== "low" &&
      item.answer.length <= 1800 &&
      item.importance !== "not_required" &&
      !needsRepair(item) &&
      (requestedCardId ? item.id === requestedCardId : isDue(item)),
    ),
    [categoryFilter, includeMediumPriority, includeNeedsReview, requestedCardId, store.revisionItems],
  );
  const card = dueCards[0];
  function rate(rating: ReviewRating) {
    if (!card) return;
    store.reviewItem(card.id, rating);
    setRevealed(false);
    setProofVisible(false);
    setSourceVisible(false);
  }
  function deleteCurrentCard() {
    if (!card) return;
    store.deleteRevisionItem(card.id);
    setDeletedCardId(card.id);
    setRevealed(false);
    setProofVisible(false);
    setSourceVisible(false);
  }
  function undoDelete() {
    if (!deletedCardId) return;
    store.restoreRevisionItem(deletedCardId);
    setDeletedCardId(null);
  }

  function fixCurrentMath() {
    if (!card) return;
    store.upsertRevisionItem({
      ...card,
      statementLatex: normalizeMathNotation(card.statement, card.mathNormalizationProfile ?? "auto", card.cardFront),
      answerLatex: normalizeMathNotation(card.answer, card.mathNormalizationProfile ?? "auto", card.cardFront),
      proofLatex: card.proof ? normalizeMathNotation(card.proof, card.mathNormalizationProfile ?? "auto", card.cardFront) : undefined,
      latexQuality: "medium",
      updatedAt: new Date().toISOString(),
    });
    setMathStatus("Math cleaned locally.");
  }

  async function aiCleanCurrentMath() {
    if (!card) return;
    setMathStatus("");
    const response = await fetch("/api/ai-clean-math", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${card.statement}\n\n${card.answer}\n\n${card.proof ?? ""}`.trim() }),
    });
    const payload = (await response.json()) as { markdown?: string; error?: string; issues?: string[]; latexQuality?: RevisionItem["latexQuality"] };
    if (!response.ok || !payload.markdown) {
      setMathStatus(payload.error || "AI math cleanup failed.");
      return;
    }
    store.upsertRevisionItem({
      ...card,
      answerLatex: payload.markdown,
      latexQuality: payload.latexQuality ?? (payload.issues?.length ? "low" : "high"),
      warnings: [...(card.warnings ?? []), ...(payload.issues ?? [])],
      updatedAt: new Date().toISOString(),
    });
    setMathStatus(payload.issues?.length ? "AI cleaned math, but KaTeX still reported issues." : "AI cleaned math.");
  }

  return (
    <div>
      <PageHeader title="Flashcard revision" description="Answer from memory, reveal a clean answer, then self-grade." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select className="max-w-xs" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="all">All categories</option>
          {revisionPackCategories.filter((category) => category !== "rejected").map((category) => <option key={category} value={category}>{category}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeNeedsReview} onChange={(event) => setIncludeNeedsReview(event.target.checked)} />
          Include needs review
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeMediumPriority} onChange={(event) => setIncludeMediumPriority(event.target.checked)} />
          Include medium priority
        </label>
      </div>
      {mathStatus ? <p className="mb-4 text-sm text-slate-600">{mathStatus}</p> : null}
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
              <Badge variant="outline">{card.revisionPackCategory ?? card.type}</Badge>
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
            {hasLowLatexQuality(card) ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <span className="font-medium">Math quality warning.</span>{" "}
                <Button size="sm" className="ml-2" variant="outline" type="button" onClick={fixCurrentMath}>Fix math</Button>{" "}
                <Link className="ml-2 font-medium text-blue-800 underline" href="/cards?tab=low_math">All low-math cards</Link>
              </div>
            ) : null}
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
                <details className="rounded-lg border border-slate-200 p-4 text-sm text-slate-600" open={sourceVisible} onToggle={(event) => setSourceVisible(event.currentTarget.open)}>
                  <summary className="cursor-pointer font-medium text-slate-800">Show source</summary>
                  <div className="mt-3 space-y-1">
                    <p><strong>Source:</strong> {card.sourceLocation || "source unknown"}</p>
                    {card.guidanceReason ? <p><strong>Guidance:</strong> {card.guidanceReason}</p> : null}
                    {card.extractionWarning ? <p className="text-amber-700"><strong>Warning:</strong> {card.extractionWarning}</p> : null}
                  </div>
                </details>
                <div className="grid gap-2 sm:grid-cols-4">
                  {ratings.map(([value, label]) => (
                    <Button key={value} variant={value === "again" ? "destructive" : value === "easy" ? "default" : "outline"} onClick={() => rate(value)}>
                      {label}
                    </Button>
                  ))}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50" href="/cards">Edit</Link>
                  <Button variant="outline" onClick={deleteCurrentCard}>Delete</Button>
                  <Button variant="outline" onClick={() => rate("hard")}>Skip</Button>
                  <Button variant="outline" onClick={fixCurrentMath}>Fix math</Button>
                  {apiOk ? <Button variant="outline" onClick={() => void aiCleanCurrentMath()}>AI clean math</Button> : null}
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
