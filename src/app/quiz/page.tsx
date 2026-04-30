"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MathText } from "@/components/math-text";
import { PageHeader } from "@/components/page-header";
import { isDue } from "@/lib/srs";
import type { ReviewRating } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";
const ratings: Array<[ReviewRating, string]> = [["again", "Again"], ["hard", "Hard"], ["good", "Good"], ["easy", "Easy"]];
export default function QuizPage() {
  const store = useStudyStore();
  const [answer, setAnswer] = useState("");
  const [comparing, setComparing] = useState(false);
  const dueCards = useMemo(() => store.revisionItems.filter((item) => item.importance !== "not_required" && isDue(item)), [store.revisionItems]);
  const card = dueCards[0];
  function rate(rating: ReviewRating) { if (!card) return; store.reviewItem(card.id, rating); setAnswer(""); setComparing(false); }
  return <div><PageHeader title="Quiz mode" description="Type your answer first, then compare it with the official extracted answer. No automatic grading is applied." />{!card ? <Card><CardContent className="pt-6 text-slate-600">No due quiz cards.</CardContent></Card> : <Card className="max-w-4xl"><CardHeader><div className="flex gap-2"><Badge variant={card.importance}>{card.importance}</Badge><Badge variant="outline">{card.type}</Badge></div><CardTitle>{card.questionPrompt}</CardTitle><CardDescription>{card.sourceLocation || "source unknown"}</CardDescription></CardHeader><CardContent className="space-y-4"><Textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer from memory..." className="min-h-40" /><Button onClick={() => setComparing(true)}>Compare with original</Button>{comparing ? <><div><h3 className="mb-2 font-medium">Official answer</h3><MathText>{card.answer}</MathText></div><div className="grid gap-2 sm:grid-cols-4">{ratings.map(([value, label]) => <Button key={value} variant={value === "again" ? "destructive" : value === "easy" ? "default" : "outline"} onClick={() => rate(value)}>{label}</Button>)}</div></> : null}</CardContent></Card>}</div>;
}
