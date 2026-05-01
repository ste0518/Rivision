"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { hasLowLatexQuality } from "@/lib/card-render";
import { isDue } from "@/lib/srs";
import { todayKey } from "@/lib/utils";
import { useStudyStore } from "@/hooks/use-study-store";
export default function DashboardPage() {
  const store = useStudyStore();
  const stats = useMemo(() => {
    const today = todayKey();
    const byImportance = { must_know: 0, partial: 0, not_required: 0, unknown: 0 };
    const activeItems = store.revisionItems.filter((item) => !item.isDeleted);
    const keptActiveCards = activeItems.filter((item) => (item.curationDecision ?? "keep") === "keep");
    const needsReviewCards = activeItems.filter((item) => (item.curationDecision ?? "keep") === "needs_review");
    const rejectedCards = store.rejectedItems.length + activeItems.filter((item) => item.curationDecision === "reject").length;
    const lowLatexQuality = activeItems.filter(hasLowLatexQuality).length;
    const activeIds = new Set(activeItems.map((item) => item.id));
    for (const item of activeItems) if (item.importance in byImportance) byImportance[item.importance] += 1;
    const reviewedToday = store.reviewSessions.filter((session) => activeIds.has(session.itemId) && session.reviewedAt.startsWith(today)).length;
    const dueCards = keptActiveCards.filter((item) => item.importance !== "not_required" && isDue(item)).length;
    const deletedCards = store.revisionItems.filter((item) => item.isDeleted).length;
    const packCounts = {
      definitions: activeItems.filter((item) => item.revisionPackCategory === "mustKnowDefinitions").length,
      theorems: activeItems.filter((item) => item.revisionPackCategory === "theoremStatements").length,
      proofs: activeItems.filter((item) => item.revisionPackCategory === "proofsToKnow").length,
      formulas: activeItems.filter((item) => item.revisionPackCategory === "formulasToKnow").length,
      methods: activeItems.filter((item) => item.revisionPackCategory === "methodsAndTemplates").length,
      distinctions: activeItems.filter((item) => item.revisionPackCategory === "conceptualDistinctions").length,
    };
    const weak = new Map<string, number>();
    for (const session of store.reviewSessions.filter((s) => activeIds.has(s.itemId) && (s.rating === "again" || s.rating === "hard"))) { const item = activeItems.find((candidate) => candidate.id === session.itemId); const section = item?.section || "source unknown"; weak.set(section, (weak.get(section) ?? 0) + 1); }
    return { byImportance, reviewedToday, dueCards, deletedCards, activeItems, keptActiveCards, needsReviewCards, rejectedCards, lowLatexQuality, packCounts, weakSections: Array.from(weak.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5) };
  }, [store.revisionItems, store.rejectedItems.length, store.reviewSessions]);
  return <div><PageHeader title="Dashboard" description="Track the revision pack, priorities, due reviews, and weak sections from self-assessments." />{stats.activeItems.length === 0 && store.notesFiles.length > 0 ? <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Uploaded files exist, but there are no cards yet. Run extraction or check parsing diagnostics.</div> : null}<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Stat title="Kept active cards" value={stats.keptActiveCards.length} /><Stat title="Needs review" value={stats.needsReviewCards.length} /><Stat title="Rejected" value={stats.rejectedCards} /><Stat title="Deleted" value={stats.deletedCards} /><Stat title="Low LaTeX quality" value={stats.lowLatexQuality} /><Stat title="Reviewed today" value={stats.reviewedToday} /><Stat title="Due kept cards" value={stats.dueCards} /><Stat title="Must know" value={stats.byImportance.must_know} /></div><div className="mt-6 grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle>Top priority topics</CardTitle><CardDescription>From guidance, past papers, problem sheets, and solutions.</CardDescription></CardHeader><CardContent className="space-y-2">{(store.examPriorityMap?.topics ?? []).slice(0, 8).length === 0 ? <p className="text-sm text-slate-500">No priority map yet.</p> : (store.examPriorityMap?.topics ?? []).slice(0, 8).map((topic) => <div key={topic.topicName} className="rounded-lg border border-slate-200 p-3"><div className="flex items-center justify-between gap-3"><span>{topic.topicName}</span><Badge variant={topic.priority === "very_high" || topic.priority === "high" ? "must_know" : topic.priority === "medium" ? "partial" : "outline"}>{topic.priority}</Badge></div><p className="mt-1 text-xs text-slate-500">{topic.likelyAssessmentMode}</p></div>)}</CardContent></Card><Card><CardHeader><CardTitle>Revision pack categories</CardTitle><CardDescription>{store.revisionPack?.overview ?? "Run extraction to build a structured pack."}</CardDescription></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2"><Stat title="Definitions" value={stats.packCounts.definitions} /><Stat title="Theorems" value={stats.packCounts.theorems} /><Stat title="Proofs" value={stats.packCounts.proofs} /><Stat title="Formulas" value={stats.packCounts.formulas} /><Stat title="Methods" value={stats.packCounts.methods} /><Stat title="Distinctions" value={stats.packCounts.distinctions} /></CardContent></Card><Card><CardHeader><CardTitle>Weakest sections</CardTitle><CardDescription>Based on Again and Hard ratings for active cards.</CardDescription></CardHeader><CardContent className="space-y-2">{stats.weakSections.length === 0 ? <p className="text-sm text-slate-500">No weak sections yet.</p> : stats.weakSections.map(([section, count]) => <div key={section} className="flex items-center justify-between rounded-lg border border-slate-200 p-3"><span>{section}</span><Badge variant="partial">{count} difficult review(s)</Badge></div>)}</CardContent></Card><Card><CardHeader><CardTitle>Next step</CardTitle><CardDescription>Start with mock data, upload notes, or review due cards.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Button onClick={store.seedMockData}>Load mock cards</Button><Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50" href="/upload">Upload files</Link><Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" href="/review">Review due cards</Link></CardContent></Card></div></div>;
}
function Stat({ title, value }: { title: string; value: number }) { return <Card><CardHeader><CardDescription>{title}</CardDescription><CardTitle className="text-3xl">{value}</CardTitle></CardHeader></Card>; }
