"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MathText } from "@/components/math-text";
import { PageHeader } from "@/components/page-header";
import { isDue } from "@/lib/srs";
import type { ReviewRating } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";
const ratings: Array<[ReviewRating, string]> = [["again", "Again"], ["hard", "Hard"], ["good", "Good"], ["easy", "Easy"]];
export default function ReviewPage() {
  const store = useStudyStore();
  const [revealed, setRevealed] = useState(false);
  const dueCards = useMemo(() => store.revisionItems.filter((item) => item.importance !== "not_required" && isDue(item)), [store.revisionItems]);
  const card = dueCards[0];
  function rate(rating: ReviewRating) { if (!card) return; store.reviewItem(card.id, rating); setRevealed(false); }
  return <div><PageHeader title="Flashcard revision" description="Answer from memory, reveal the extracted definition or theorem, then self-grade to schedule the next review." />{!card ? <Card><CardContent className="pt-6"><p className="mb-4 text-slate-600">No due cards. Add or extract more cards, or come back when scheduled reviews are due.</p><Link className="text-blue-700 underline" href="/cards">Go to cards</Link></CardContent></Card> : <Card className="mx-auto max-w-3xl"><CardHeader><div className="flex flex-wrap items-center gap-2"><Badge variant={card.importance}>{card.importance}</Badge><Badge variant="outline">{card.type}</Badge></div><CardTitle className="pt-3">{card.questionPrompt}</CardTitle><CardDescription>{dueCards.length} due card(s) · reviewed {card.reviewCount ?? 0} time(s)</CardDescription></CardHeader><CardContent className="space-y-5">{!revealed ? <Button size="lg" onClick={() => setRevealed(true)}>Show definition / theorem</Button> : <><MathText>{card.answer}</MathText><div className="rounded-lg border border-slate-200 p-4 text-sm text-slate-600"><p><strong>Source:</strong> {card.sourceLocation || "source unknown"}</p>{card.guidanceReason ? <p><strong>Guidance:</strong> {card.guidanceReason}</p> : null}</div><div className="grid gap-2 sm:grid-cols-4">{ratings.map(([value, label]) => <Button key={value} variant={value === "again" ? "destructive" : value === "easy" ? "default" : "outline"} onClick={() => rate(value)}>{label}</Button>)}</div></>}</CardContent></Card>}</div>;
}
