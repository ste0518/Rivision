"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { CardForm } from "@/components/card-form";
import { MathMarkdown } from "@/components/MathMarkdown";
import { PageHeader } from "@/components/page-header";
import { hasLowLatexQuality } from "@/lib/card-render";
import { normalizeMathNotation } from "@/lib/revision-item-utils";
import type { RevisionItem } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";

type Section = {
  id: string;
  title: string;
  categories: Array<RevisionItem["revisionPackCategory"]>;
  match?: (item: RevisionItem) => boolean;
};

const sections: Section[] = [
  { id: "must", title: "Must know", categories: ["mustKnowDefinitions", "modelsToKnow", "conceptualDistinctions"] },
  { id: "formulas", title: "Formulas", categories: ["formulasToKnow"] },
  { id: "algorithms", title: "Algorithms", categories: ["methodsAndTemplates"], match: (item) => item.type === "algorithm" || item.cardPurpose === "method_steps" },
  { id: "proofs", title: "Proofs", categories: ["proofsToKnow"] },
  { id: "examples", title: "Worked examples", categories: ["workedExamplePatterns"], match: (item) => item.cardPurpose === "calculation_template" || item.cardPurpose === "worked_example_pattern" },
  { id: "review", title: "Needs review", categories: ["needsReview"], match: (item) => item.curationDecision === "needs_review" || hasLowLatexQuality(item) },
];

export default function PackPage() {
  const store = useStudyStore();
  const [editing, setEditing] = useState<RevisionItem | undefined>();
  const [filter, setFilter] = useState("all");
  const [mathStatus, setMathStatus] = useState("");
  const activeCards = useMemo(() => store.revisionItems.filter((item) => !item.isDeleted), [store.revisionItems]);
  const reviewedCount = activeCards.filter((item) => (item.reviewCount ?? 0) > 0).length;
  const title = store.courseMap?.courseTitle || store.revisionPack?.topTopics?.[0]?.topicName || inferPackTitle(activeCards);

  function fixMath(item: RevisionItem) {
    store.upsertRevisionItem({
      ...item,
      statementLatex: normalizeMathNotation(item.statement, item.mathNormalizationProfile ?? "auto", item.cardFront),
      answerLatex: normalizeMathNotation(item.answer, item.mathNormalizationProfile ?? "auto", item.cardFront),
      proofLatex: item.proof ? normalizeMathNotation(item.proof, item.mathNormalizationProfile ?? "auto", item.cardFront) : undefined,
      latexQuality: "medium",
      updatedAt: new Date().toISOString(),
    });
  }

  async function aiCleanMath(item: RevisionItem) {
    setMathStatus("");
    const response = await fetch("/api/ai-clean-math", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `${item.statement}\n\n${item.answer}\n\n${item.proof ?? ""}`.trim() }),
    });
    const payload = (await response.json()) as { markdown?: string; error?: string; issues?: string[]; latexQuality?: RevisionItem["latexQuality"] };
    if (!response.ok || !payload.markdown) {
      setMathStatus(payload.error || "AI math cleanup failed.");
      return;
    }
    store.upsertRevisionItem({
      ...item,
      answerLatex: payload.markdown,
      latexQuality: payload.latexQuality ?? (payload.issues?.length ? "low" : "high"),
      warnings: [...(item.warnings ?? []), ...(payload.issues ?? [])],
      updatedAt: new Date().toISOString(),
    });
    setMathStatus(payload.issues?.length ? "AI cleaned math, but KaTeX still reported issues." : "AI cleaned math.");
  }

  const visibleSections = sections.filter((section) => filter === "all" || section.id === filter);

  return (
    <div>
      <PageHeader title="Study Pack" description="A one-page revision checklist for the cards generated from your notes." />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{reviewedCount}/{activeCards.length} cards reviewed</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-5">
          <PackStat label="Formulas" value={count(activeCards, (item) => item.revisionPackCategory === "formulasToKnow")} />
          <PackStat label="Algorithms" value={count(activeCards, (item) => item.type === "algorithm" || item.cardPurpose === "method_steps")} />
          <PackStat label="Proofs" value={count(activeCards, (item) => item.revisionPackCategory === "proofsToKnow")} />
          <PackStat label="Worked examples" value={count(activeCards, (item) => item.revisionPackCategory === "workedExamplePatterns" || item.cardPurpose === "calculation_template")} />
          <PackStat label="Needs review" value={count(activeCards, (item) => item.curationDecision === "needs_review" || hasLowLatexQuality(item))} warning />
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" href="/review">Start reviewing</Link>
        <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50" href="/cards">Edit deck</Link>
        <Select className="max-w-xs" value={filter} onChange={(event) => setFilter(event.target.value)}>
          <option value="all">All sections</option>
          {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
        </Select>
      </div>
      {mathStatus ? <p className="mb-4 text-sm text-slate-600">{mathStatus}</p> : null}

      <div className="space-y-6">
        {visibleSections.map((section) => {
          const cards = cardsForSection(activeCards, section);
          return (
            <Card key={section.id}>
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                <CardDescription>{cards.length} card(s)</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {cards.length === 0 ? <p className="text-sm text-slate-500">No cards in this section yet.</p> : null}
                {cards.map((item) => (
                  <CompactPackCard
                    key={item.id}
                    item={item}
                    onEdit={() => setEditing(item)}
                    onDelete={() => store.deleteRevisionItem(item.id)}
                    onFixMath={() => fixMath(item)}
                    onAiCleanMath={() => void aiCleanMath(item)}
                  />
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editing ? (
        <Dialog open onOpenChange={(open) => { if (!open) setEditing(undefined); }}>
          <DialogContent>
            <h2 className="mb-4 text-xl font-semibold">Edit card</h2>
            <CardForm
              item={editing}
              onCancel={() => setEditing(undefined)}
              onSave={(item) => { store.upsertRevisionItem(item); setEditing(undefined); }}
              onDelete={() => { store.deleteRevisionItem(editing.id); setEditing(undefined); }}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function CompactPackCard({ item, onEdit, onDelete, onFixMath, onAiCleanMath }: { item: RevisionItem; onEdit: () => void; onDelete: () => void; onFixMath: () => void; onAiCleanMath: () => void }) {
  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <MathMarkdown content={item.cardFront} className="bg-transparent p-0 text-base font-semibold text-slate-950" />
          {item.taskPrompt ? <p className="mt-1 text-xs text-slate-500">{item.taskPrompt}</p> : null}
        </div>
        <Badge variant={item.importance}>{item.importance}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        <Badge variant="outline">{labelForCategory(item)}</Badge>
        <Badge variant="outline">page {item.pageNumber ?? "?"}</Badge>
        {hasLowLatexQuality(item) ? <Badge variant="unknown">Fix math</Badge> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50" href={`/review?card=${item.id}`}>Review</Link>
        <Button size="sm" variant="outline" onClick={onEdit}>Edit</Button>
        <Button size="sm" variant="outline" onClick={onFixMath}>Fix math</Button>
        <Button size="sm" variant="outline" onClick={onAiCleanMath}>AI clean math</Button>
        <Button size="sm" variant="destructive" onClick={onDelete}>Delete</Button>
      </div>
    </div>
  );
}

function PackStat({ label, value, warning }: { label: string; value: number; warning?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warning && value > 0 ? "border-amber-200 bg-amber-50" : "bg-white"}`}>
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-slate-500">{label}</p>
    </div>
  );
}

function cardsForSection(cards: RevisionItem[], section: Section) {
  return cards.filter((item) =>
    section.categories.includes(item.revisionPackCategory) ||
    Boolean(section.match?.(item))
  );
}

function count(cards: RevisionItem[], predicate: (item: RevisionItem) => boolean) {
  return cards.filter(predicate).length;
}

function labelForCategory(item: RevisionItem) {
  return (item.revisionPackCategory ?? item.cardPurpose).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

function inferPackTitle(cards: RevisionItem[]) {
  if (cards.some((item) => /monte carlo|importance sampling/i.test(`${item.cardFront} ${item.answer}`))) return "Monte Carlo Integration";
  return "Revision Pack";
}
