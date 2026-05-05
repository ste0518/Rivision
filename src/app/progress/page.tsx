"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { hasLowLatexQuality } from "@/lib/card-render";
import { useStudyStore } from "@/hooks/use-study-store";

export default function ProgressPage() {
  const store = useStudyStore();
  const active = useMemo(() => store.revisionItems.filter((i) => !i.isDeleted), [store.revisionItems]);
  const kept = useMemo(() => active.filter((i) => (i.curationDecision ?? "keep") === "keep"), [active]);

  const reviewedSets = useMemo(() => {
    const reviewedIds = new Set(store.reviewSessions.map((s) => s.itemId));
    const count = (pred: (i: (typeof kept)[0]) => boolean) => {
      const subset = kept.filter(pred);
      const done = subset.filter((i) => reviewedIds.has(i.id)).length;
      return { done, total: subset.length };
    };
    return {
      definitions: count((i) => i.type === "definition" || i.revisionPackCategory === "mustKnowDefinitions"),
      formulas: count((i) => i.type === "formula" || i.revisionPackCategory === "formulasToKnow"),
      proofs: count((i) => i.type === "proof" || i.revisionPackCategory === "proofsToKnow"),
    };
  }, [kept, store.reviewSessions]);

  if (!store.studentRevisionPack) {
    return (
      <div className="space-y-8">
        <PageHeader title="Progress" description="High-level view of how your revision is going across review and practice." />
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-slate-600">
            <p>No exam pack yet. Upload files and generate an exam pack first.</p>
            <Link className="mt-4 inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white" href="/upload">
              Upload &amp; generate
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const practiceAttempted = store.practiceAttempts?.length ?? 0;
  const practiceBank = store.practiceQuestions?.length ?? 0;

  const pack = store.studentRevisionPack!;
  const weakTopics = pack.courseMap.filter((t) => t.importance !== "high").slice(0, 8);
  const filesCount = store.notesFiles.length + store.guidanceFiles.length;
  const pastCoverage = store.guidanceFiles.some((f) => f.role === "past_paper");

  return (
    <div className="space-y-8">
      <PageHeader title="Progress" description="High-level view of how your revision is going across review and practice." />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Exam pack</CardTitle>
            <CardDescription>Structured exam overview and sections.</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Exam pack generated" value="Yes" />
            <Row label="Files uploaded" value={String(filesCount)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review coverage</CardTitle>
            <CardDescription>Based on cards you have opened in Review mode.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <ReviewCoverageRow label="Definitions reviewed" done={reviewedSets.definitions.done} total={reviewedSets.definitions.total} />
            <ReviewCoverageRow label="Formulas reviewed" done={reviewedSets.formulas.done} total={reviewedSets.formulas.total} />
            <ReviewCoverageRow label="Proofs reviewed" done={reviewedSets.proofs.done} total={reviewedSets.proofs.total} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Practice</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Practice questions attempted (sessions logged)" value={`${practiceAttempted}${practiceBank ? ` / ${practiceBank} generated` : ""}`} />
            <p className="mt-2 text-xs text-slate-500">Attempts are recorded when you submit practice on the Practice page.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quality snapshot</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <Row label="Cards needing math check" value={String(kept.filter(hasLowLatexQuality).length)} />
            <Row label="Past paper files uploaded" value={pastCoverage ? "Yes" : "Not yet"} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Weak topics</CardTitle>
          <CardDescription>Topics estimated as lower emphasis — spend extra time here.</CardDescription>
        </CardHeader>
        <CardContent>
          {weakTopics.length === 0 ? (
            <p className="text-sm text-slate-500">Generate an exam pack after uploading files to see weak topics, or you&apos;re in good shape on emphasis.</p>
          ) : (
            <ul className="list-inside list-disc space-y-1 text-sm text-slate-800">
              {weakTopics.map((t) => (
                <li key={t.id}>{t.title}</li>
              ))}
            </ul>
          )}
          <Link className="mt-4 inline-block text-sm font-medium text-blue-700 underline" href="/quiz">
            Practice weak topic drill
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-2 last:border-0">
      <span className="text-slate-600">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function ReviewCoverageRow({ label, done, total }: { label: string; done: number; total: number }) {
  const value = total === 0 ? "— (no cards in this category yet)" : `${done}/${total}`;
  return <Row label={label} value={value} />;
}
