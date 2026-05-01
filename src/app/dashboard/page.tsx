"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { hasLowLatexQuality } from "@/lib/card-render";
import { isDue } from "@/lib/srs";
import { todayKey } from "@/lib/utils";
import { useStudyStore } from "@/hooks/use-study-store";

export default function DashboardPage() {
  const store = useStudyStore();
  const parsedPageCount = useMemo(
    () =>
      [...store.notesFiles, ...store.guidanceFiles].reduce(
        (sum, file) => sum + (file.parsedDocument?.pages?.length ?? file.parsedDocument?.diagnostics?.pageCount ?? 0),
        0,
      ),
    [store.guidanceFiles, store.notesFiles],
  );

  const stats = useMemo(() => {
    const today = todayKey();
    const activeItems = store.revisionItems.filter((item) => !item.isDeleted);
    const kept = activeItems.filter((item) => (item.curationDecision ?? "keep") === "keep");
    const needsReview = activeItems.filter((item) => (item.curationDecision ?? "keep") === "needs_review");
    const rejected = store.rejectedItems.length + activeItems.filter((item) => item.curationDecision === "reject").length;
    const lowMath = activeItems.filter(hasLowLatexQuality).length;
    const activeIds = new Set(activeItems.map((item) => item.id));
    const dueKept = kept.filter((item) => item.importance !== "not_required" && isDue(item)).length;
    const mustKnowDue = kept.filter((item) => item.importance === "must_know" && isDue(item)).length;
    const reviewedToday = store.reviewSessions.filter((session) => activeIds.has(session.itemId) && session.reviewedAt.startsWith(today)).length;
    const assessmentEmpty = (store.assessmentMap?.topicFrequency.length ?? 0) === 0;
    const localHeuristicFallback =
      store.curationReport?.notes?.some((note) => note.toLowerCase().includes("local heuristic")) ?? false;
    const pack = store.curationReport;
    const fewCards =
      parsedPageCount > 50 && kept.length < Math.max(12, Math.floor(parsedPageCount * 0.3));
    const lowCoverage = (pack?.candidateCoverageScore ?? 100) < 45;
    const lowLatexScore = (pack?.latexQualityScore ?? 100) < 45;
    const topTopics = (store.examPriorityMap?.topics ?? store.curationReport?.mainTopics ?? []).slice(0, 8);
    return {
      kept,
      needsReview,
      rejected,
      lowMath,
      dueKept,
      mustKnowDue,
      reviewedToday,
      assessmentEmpty,
      localHeuristicFallback,
      pack,
      fewCards,
      lowCoverage,
      lowLatexScore,
      topTopics,
      courseTitle: store.courseMap?.courseTitle ?? store.revisionPack?.topTopics?.[0]?.topicName ?? "Your study pack",
    };
  }, [store, parsedPageCount]);

  const warnings: string[] = [];
  if (stats.fewCards) warnings.push("Too few cards for the amount of notes text parsed.");
  if (stats.lowCoverage) warnings.push("Low candidate coverage — extraction may have missed labelled items.");
  if (stats.lowLatexScore || stats.lowMath > 0) warnings.push("Low math quality on some cards — fix LaTeX before reviewing.");
  if (stats.assessmentEmpty) warnings.push("No assessment evidence uploaded (past papers / problem sheets).");
  if (stats.localHeuristicFallback) warnings.push("Last analysis used local heuristic mode only — configure OPENAI_API_KEY on the server for full AI analysis.");

  return (
    <div className="space-y-8">
      <PageHeader
        title="Home"
        description="Upload notes, run analysis once, then use your study pack and reviews. Here is what to do next."
      />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-950">Continue studying</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <ActionCard
            title="Start due review"
            hint={stats.dueKept > 0 ? `${stats.dueKept} card(s) due` : "Nothing due right now"}
            href="/review"
            primary
          />
          <ActionCard title="Review must-know cards" hint="High-priority deck" href="/review" />
          <ActionCard
            title="Fix low-quality cards"
            hint={stats.lowMath > 0 ? `${stats.lowMath} with math issues` : "All clear"}
            href="/cards?tab=low_math"
            muted={stats.lowMath === 0}
          />
          <ActionCard
            title="Resolve needs-review cards"
            hint={stats.needsReview.length > 0 ? `${stats.needsReview.length} waiting` : "None pending"}
            href="/cards?tab=needs_review"
            muted={stats.needsReview.length === 0}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-950">Current study pack</h2>
        <Card>
          <CardHeader>
            <CardTitle>{stats.courseTitle}</CardTitle>
            <CardDescription>Snapshot from your last analysis run.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Completeness" value={`${stats.pack?.packCompletenessScore ?? 0}%`} />
            <Stat label="Kept cards" value={String(stats.kept.length)} />
            <Stat label="Needs review" value={String(stats.needsReview.length)} warn={stats.needsReview.length > 0} />
            <Stat label="Rejected" value={String(stats.rejected)} />
            <Stat label="Low LaTeX quality" value={String(stats.lowMath)} warn={stats.lowMath > 0} />
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top revision topics</CardTitle>
            <CardDescription>Detected from your notes and assessment files.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {stats.topTopics.length === 0 ? (
              <p className="text-sm text-slate-500">Run analysis after uploading notes to see topics here.</p>
            ) : (
              stats.topTopics.map((topic) => (
                <div key={typeof topic === "string" ? topic : topic.topicName} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                  <span>{typeof topic === "string" ? topic : topic.topicName}</span>
                  {typeof topic !== "string" && topic.priorityLabel ? (
                    <Badge variant="outline">{topic.priorityLabel}</Badge>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quality warnings</CardTitle>
            <CardDescription>Issues worth fixing before exams.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {warnings.length === 0 ? (
              <p className="text-sm text-slate-500">No major warnings.</p>
            ) : (
              warnings.map((warning) => (
                <p key={warning} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {warning}
                </p>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-slate-950">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50" href="/upload">
            Upload more files
          </Link>
          <Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white hover:bg-blue-800" href="/pack">
            Open study pack
          </Link>
          <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50" href="/cards">
            Export cards
          </Link>
          <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50" href="/settings/storage">
            Storage manager
          </Link>
        </div>
        <p className="mt-2 text-xs text-slate-500">
          Reviewed today: {stats.reviewedToday} · Due (kept): {stats.dueKept}
          {stats.mustKnowDue ? ` · Must-know due: ${stats.mustKnowDue}` : ""}
        </p>
      </section>

      {store.revisionItems.length === 0 && store.notesFiles.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Files are uploaded but no cards yet. Go to <Link className="font-medium underline" href="/extract">Extract</Link> to analyse your notes.
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warn ? "border-amber-200 bg-amber-50" : ""}`}>
      <p className="text-2xl font-semibold text-slate-950">{value}</p>
      <p className="text-xs text-slate-500">{label}</p>
    </div>
  );
}

function ActionCard({
  title,
  hint,
  href,
  primary,
  muted,
}: {
  title: string;
  hint: string;
  href: string;
  primary?: boolean;
  muted?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 transition hover:bg-slate-50 ${primary ? "border-blue-300 bg-blue-50/50" : "border-slate-200"} ${muted ? "opacity-70" : ""}`}
    >
      <p className="font-medium text-slate-950">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{hint}</p>
    </Link>
  );
}
