"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { CardForm } from "@/components/card-form";
import { MathMarkdown } from "@/components/MathMarkdown";
import { PageHeader } from "@/components/page-header";
import { hasLowLatexQuality } from "@/lib/card-render";
import { normalizeMathNotation } from "@/lib/revision-item-utils";
import type { RevisionItem } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";

type SectionId = "core" | "formulas" | "algorithms" | "proofs" | "worked" | "exercises" | "needs_review" | "low_math";

type Section = {
  id: SectionId;
  title: string;
  match: (item: RevisionItem) => boolean;
};

const sections: Section[] = [
  {
    id: "core",
    title: "Core concepts",
    match: (item) =>
      ["mustKnowDefinitions", "modelsToKnow", "conceptualDistinctions", "theoremStatements"].includes(item.revisionPackCategory ?? "") ||
      (item.type === "definition" && (item.curationDecision ?? "keep") === "keep"),
  },
  {
    id: "formulas",
    title: "Key formulas",
    match: (item) => item.revisionPackCategory === "formulasToKnow" || item.cardPurpose === "formula_recall",
  },
  {
    id: "algorithms",
    title: "Algorithms",
    match: (item) => item.type === "algorithm" || item.cardPurpose === "method_steps",
  },
  {
    id: "proofs",
    title: "Proofs",
    match: (item) => item.revisionPackCategory === "proofsToKnow" || item.cardPurpose === "proof_recall" || item.type === "proof",
  },
  {
    id: "worked",
    title: "Worked examples",
    match: (item) => item.revisionPackCategory === "workedExamplePatterns" || item.cardPurpose === "worked_example_pattern",
  },
  {
    id: "exercises",
    title: "Exercises",
    match: (item) => item.cardPurpose === "calculation_template" && item.revisionPackCategory !== "workedExamplePatterns",
  },
  {
    id: "low_math",
    title: "Low math quality",
    match: (item) => hasLowLatexQuality(item),
  },
  {
    id: "needs_review",
    title: "Needs review",
    match: (item) => (item.curationDecision ?? "keep") === "needs_review",
  },
];

export default function PackPage() {
  const store = useStudyStore();
  const [editing, setEditing] = useState<RevisionItem | undefined>();
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

  const activeCards = useMemo(() => store.revisionItems.filter((item) => !item.isDeleted), [store.revisionItems]);
  const title =
    store.courseMap?.courseTitle ||
    store.revisionPack?.topTopics?.[0]?.topicName ||
    inferPackTitle(activeCards);

  const lowMathCount = useMemo(() => activeCards.filter(hasLowLatexQuality).length, [activeCards]);
  const needsReviewOnlyCount = useMemo(
    () => activeCards.filter((item) => (item.curationDecision ?? "keep") === "needs_review").length,
    [activeCards],
  );

  const sectionBuckets = useMemo(() => {
    const placed = new Set<string>();
    const buckets: Partial<Record<SectionId, RevisionItem[]>> = {};
    for (const section of sections) {
      const list: RevisionItem[] = [];
      for (const item of activeCards) {
        if (placed.has(item.id)) continue;
        if (section.match(item)) {
          placed.add(item.id);
          list.push(item);
        }
      }
      buckets[section.id] = list;
    }
    return buckets;
  }, [activeCards]);

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
    if (!apiOk) return;
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

  return (
    <div>
      <PageHeader
        title="Study pack"
        description="Your course summary and card checklist. Triage “Needs review” and “Low math quality” before normal revision."
      />

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
          <CardDescription>
            {activeCards.length} card{activeCards.length === 1 ? "" : "s"} total
            {store.curationReport ? ` · pack completeness about ${store.curationReport.packCompletenessScore ?? 0}%` : ""}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-4 lg:grid-cols-7">
          <PackStat label="Cards" value={activeCards.length} />
          <PackStat label="Needs review" value={needsReviewOnlyCount} warning={needsReviewOnlyCount > 0} />
          <PackStat label="Low math quality" value={lowMathCount} warning={lowMathCount > 0} />
          <PackStat label="Kept" value={activeCards.filter((item) => (item.curationDecision ?? "keep") === "keep").length} />
          <PackStat label="Rejected (total)" value={store.rejectedItems.length + activeCards.filter((i) => i.curationDecision === "reject").length} />
        </CardContent>
        <CardContent className="flex flex-wrap gap-2 border-t pt-4">
          <Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" href="/review">
            Start reviewing
          </Link>
          <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50" href="/cards">
            Edit deck
          </Link>
          <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50" href="/cards?tab=needs_review">
            Review issues
          </Link>
          {lowMathCount > 0 ? (
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-950 hover:bg-amber-100"
              href="/cards?tab=low_math"
            >
              Fix math issues ({lowMathCount})
            </Link>
          ) : null}
        </CardContent>
      </Card>

      {mathStatus ? <p className="mb-4 text-sm text-slate-600">{mathStatus}</p> : null}
      {apiOk === false ? <p className="mb-4 text-xs text-slate-500">AI math cleanup is unavailable without a server API key. Local “Fix math” still works.</p> : null}

      <div className="space-y-8">
        {sections.map((section) => {
          const cards = sectionBuckets[section.id] ?? [];
          if (cards.length === 0) return null;
          return (
            <Card key={section.id}>
              <CardHeader>
                <CardTitle>{section.title}</CardTitle>
                <CardDescription>{cards.length} card(s)</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {cards.map((item) => (
                  <CompactPackCard
                    key={item.id}
                    item={item}
                    showAiClean={Boolean(apiOk)}
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

      {activeCards.length === 0 ? (
        <Card className="mt-6 border-dashed">
          <CardContent className="py-8 text-center text-sm text-slate-600">
            No cards yet.{" "}
            <Link className="font-medium text-blue-700 underline" href="/upload">
              Upload notes
            </Link>{" "}
            and{" "}
            <Link className="font-medium text-blue-700 underline" href="/extract">
              run analysis
            </Link>
            .
          </CardContent>
        </Card>
      ) : null}

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

function CompactPackCard({
  item,
  onEdit,
  onDelete,
  onFixMath,
  onAiCleanMath,
  showAiClean,
}: {
  item: RevisionItem;
  onEdit: () => void;
  onDelete: () => void;
  onFixMath: () => void;
  onAiCleanMath: () => void;
  showAiClean: boolean;
}) {
  const preview = (item.answer ?? item.statement ?? "").replace(/\s+/g, " ").trim().slice(0, 140);

  return (
    <div className="rounded-lg border bg-white p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <MathMarkdown content={item.cardFront} className="bg-transparent p-0 text-base font-semibold text-slate-950" />
          {preview ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{preview}{preview.length >= 140 ? "…" : ""}</p> : null}
        </div>
        <Badge variant={item.importance}>{item.importance}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        <Badge variant="outline">{labelForCategory(item)}</Badge>
        <Badge variant="outline">priority {item.priorityScore ?? "—"}</Badge>
        <Badge variant="outline">{item.pageNumber != null ? `p. ${item.pageNumber}` : "page ?"}</Badge>
        {hasLowLatexQuality(item) ? <Badge variant="unknown">Math</Badge> : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link className="inline-flex h-8 items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium hover:bg-slate-50" href={`/review?card=${item.id}`}>
          Review
        </Link>
        <Button size="sm" variant="outline" type="button" onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="outline" type="button" onClick={onFixMath}>
          Fix math
        </Button>
        {showAiClean ? (
          <Button size="sm" variant="outline" type="button" onClick={onAiCleanMath}>
            AI clean math
          </Button>
        ) : null}
        <Button size="sm" variant="destructive" type="button" onClick={onDelete}>
          Delete
        </Button>
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

function labelForCategory(item: RevisionItem) {
  const raw = item.revisionPackCategory ?? item.cardPurpose ?? item.type;
  return String(raw).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

function inferPackTitle(cards: RevisionItem[]) {
  if (cards.some((item) => /monte carlo|importance sampling/i.test(`${item.cardFront} ${item.answer}`))) return "Monte Carlo Integration";
  return "Revision pack";
}
