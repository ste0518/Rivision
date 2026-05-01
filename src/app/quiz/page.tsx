"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MathText } from "@/components/math-text";
import { PageHeader } from "@/components/page-header";
import {
  generateExamStyleQuestions,
  generateQuickPracticeQuestions,
  generateWeakTopicDrill,
} from "@/lib/revision-pack-generator";
import type { GeneratedPracticeQuestion } from "@/lib/student-revision-schema";
import { isDue } from "@/lib/srs";
import type { ReviewRating } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";

const ratings: Array<[ReviewRating, string]> = [["again", "Again"], ["hard", "Hard"], ["good", "Good"], ["easy", "Easy"]];

type PracticeMode = "quick" | "exam" | "weak";

export default function QuizPage() {
  const store = useStudyStore();
  const [mode, setMode] = useState<PracticeMode>("quick");
  const [sessionQuestions, setSessionQuestions] = useState<GeneratedPracticeQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [practiceAnswer, setPracticeAnswer] = useState("");
  const [practiceRevealed, setPracticeRevealed] = useState(false);

  const [srAnswer, setSrAnswer] = useState("");
  const [srCompare, setSrCompare] = useState(false);

  const dueCards = useMemo(
    () => store.revisionItems.filter((item) => !item.isDeleted && (item.curationDecision ?? "keep") === "keep" && item.importance !== "not_required" && isDue(item)),
    [store.revisionItems],
  );
  const dueCard = dueCards[0];

  const pack = store.studentRevisionPack;
  const current = sessionQuestions[idx];

  function rateDue(rating: ReviewRating) {
    if (!dueCard) return;
    store.reviewItem(dueCard.id, rating);
    setSrAnswer("");
    setSrCompare(false);
  }

  function loadQuick() {
    if (!pack) return;
    setSessionQuestions(generateQuickPracticeQuestions(pack, 6));
    setIdx(0);
    setPracticeAnswer("");
    setPracticeRevealed(false);
  }

  function loadExam() {
    if (!pack) return;
    setSessionQuestions(generateExamStyleQuestions(pack, 4));
    setIdx(0);
    setPracticeAnswer("");
    setPracticeRevealed(false);
  }

  function loadWeak() {
    if (!pack) return;
    setSessionQuestions(generateWeakTopicDrill(pack, 5));
    setIdx(0);
    setPracticeAnswer("");
    setPracticeRevealed(false);
  }

  function loadFromBank() {
    const bank = store.practiceQuestions ?? [];
    setSessionQuestions(bank);
    setIdx(0);
    setPracticeAnswer("");
    setPracticeRevealed(false);
  }

  function nextQuestion() {
    if (idx + 1 < sessionQuestions.length) {
      setIdx((i) => i + 1);
      setPracticeAnswer("");
      setPracticeRevealed(false);
    }
  }

  function recordPracticeAttempt() {
    if (current) store.recordPracticeAttempt(current.id);
    setPracticeRevealed(true);
  }

  return (
    <div className="space-y-8">
      <PageHeader title="Practice" description="Quick drills and exam-style prompts — generated locally. Use Review for spaced repetition scheduling." />

      <Card>
        <CardHeader>
          <CardDescription className="text-base font-medium text-slate-900">Practice modes</CardDescription>
          <p className="text-sm text-slate-600">You don&apos;t need due cards to practise now.</p>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button type="button" variant={mode === "quick" ? "default" : "outline"} onClick={() => setMode("quick")}>Quick recall</Button>
          <Button type="button" variant={mode === "exam" ? "default" : "outline"} onClick={() => setMode("exam")}>Exam-style questions</Button>
          <Button type="button" variant={mode === "weak" ? "default" : "outline"} onClick={() => setMode("weak")}>Weak topic drill</Button>
        </CardContent>
      </Card>

      {!pack ? (
        <Card>
          <CardContent className="py-8 text-center text-sm text-slate-600">
            Generate a study pack from the Upload page to unlock tailored practice. You can still use due-card review below if you have cards.
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-4xl">
          <CardHeader>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{mode === "quick" ? "Quick recall" : mode === "exam" ? "Exam-style" : "Weak topics"}</Badge>
              {current ? <Badge variant="outline">{current.difficulty}</Badge> : null}
            </div>
            <p className="text-sm text-slate-500">
              {sessionQuestions.length ? `Question ${idx + 1} of ${sessionQuestions.length}` : "Generate a set to begin."}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => {
                  if (mode === "quick") loadQuick();
                  if (mode === "exam") loadExam();
                  if (mode === "weak") loadWeak();
                }}
              >
                {mode === "quick" ? "Generate quick recall quiz" : mode === "exam" ? "Generate exam-style questions" : "Drill weak topics"}
              </Button>
              {(store.practiceQuestions?.length ?? 0) > 0 ? (
                <Button type="button" variant="outline" onClick={loadFromBank}>
                  Use saved practice bank ({store.practiceQuestions?.length})
                </Button>
              ) : null}
            </div>

            {current ? (
              <>
                <MathText className="bg-transparent p-0 text-xl font-semibold text-slate-950">{current.question}</MathText>
                <p className="text-xs text-slate-500">Topic: {current.topic} · {current.sourceBasis}</p>
                <Textarea value={practiceAnswer} onChange={(e) => setPracticeAnswer(e.target.value)} placeholder="Your answer…" className="min-h-32" />
                {!practiceRevealed ? (
                  <Button type="button" onClick={recordPracticeAttempt}>Check / reveal marking points</Button>
                ) : (
                  <>
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm">
                      <p className="font-medium text-slate-900">Expected answer / marking points</p>
                      <MathText className="mt-2">{current.expectedAnswer}</MathText>
                      {current.hints?.length ? (
                        <ul className="mt-3 list-inside list-disc text-xs text-slate-600">
                          {current.hints.map((h) => (
                            <li key={h}>{h}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                    <Button type="button" onClick={nextQuestion} disabled={idx + 1 >= sessionQuestions.length}>
                      Next question
                    </Button>
                  </>
                )}
              </>
            ) : (
              <p className="text-sm text-slate-500">Click generate to start this mode.</p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="max-w-4xl border-slate-200">
        <CardHeader>
          <CardDescription className="font-medium text-slate-900">Spaced repetition (due cards)</CardDescription>
          <p className="text-sm text-slate-600">{dueCards.length === 0 ? "No due cards yet. You can still practise above." : `${dueCards.length} card(s) due`}</p>
        </CardHeader>
        {!dueCard ? (
          <CardContent className="text-sm text-slate-500">Nothing due — keep generating practice or review early cards from the Review tab.</CardContent>
        ) : (
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Badge variant="outline">{dueCard.type}</Badge>
              <Badge variant={dueCard.importance}>{dueCard.importance}</Badge>
            </div>
            <MathText className="bg-transparent p-0 text-2xl font-semibold text-slate-950">{dueCard.cardFront}</MathText>
            <p className="text-sm text-slate-500">{dueCard.taskPrompt || dueCard.sourceLocation || ""}</p>
            <Textarea value={srAnswer} onChange={(e) => setSrAnswer(e.target.value)} placeholder="Type your answer from memory…" className="min-h-40" />
            <Button type="button" variant="outline" onClick={() => setSrCompare(true)}>Compare with answer</Button>
            {srCompare ? (
              <>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium">Official answer</p>
                  <MathText className="mt-2">{dueCard.answerLatex || dueCard.statementLatex || dueCard.answer || dueCard.statement}</MathText>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  {ratings.map(([value, label]) => (
                    <Button key={value} variant={value === "again" ? "destructive" : value === "easy" ? "default" : "outline"} onClick={() => rateDue(value)}>
                      {label}
                    </Button>
                  ))}
                </div>
              </>
            ) : null}
          </CardContent>
        )}
      </Card>
    </div>
  );
}
