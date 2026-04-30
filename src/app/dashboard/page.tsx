"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { isDue } from "@/lib/srs";
import { todayKey } from "@/lib/utils";
import { useStudyStore } from "@/hooks/use-study-store";
export default function DashboardPage() {
  const store = useStudyStore();
  const stats = useMemo(() => {
    const today = todayKey();
    const byImportance = { must_know: 0, partial: 0, not_required: 0, unknown: 0 };
    const activeItems = store.revisionItems.filter((item) => !item.isDeleted);
    const activeIds = new Set(activeItems.map((item) => item.id));
    for (const item of activeItems) byImportance[item.importance] += 1;
    const reviewedToday = store.reviewSessions.filter((session) => activeIds.has(session.itemId) && session.reviewedAt.startsWith(today)).length;
    const dueCards = activeItems.filter((item) => item.importance !== "not_required" && isDue(item)).length;
    const deletedCards = store.revisionItems.filter((item) => item.isDeleted).length;
    const weak = new Map<string, number>();
    for (const session of store.reviewSessions.filter((s) => activeIds.has(s.itemId) && (s.rating === "again" || s.rating === "hard"))) { const item = activeItems.find((candidate) => candidate.id === session.itemId); const section = item?.section || "source unknown"; weak.set(section, (weak.get(section) ?? 0) + 1); }
    return { byImportance, reviewedToday, dueCards, deletedCards, activeItems, weakSections: Array.from(weak.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5) };
  }, [store.revisionItems, store.reviewSessions]);
  return <div><PageHeader title="Dashboard" description="Track extracted cards, must-know coverage, due reviews, and weak sections from self-assessments." /><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4"><Stat title="Total active cards" value={stats.activeItems.length} /><Stat title="Must know" value={stats.byImportance.must_know} /><Stat title="Partial" value={stats.byImportance.partial} /><Stat title="Not required" value={stats.byImportance.not_required} /><Stat title="Unknown" value={stats.byImportance.unknown} /><Stat title="Reviewed today" value={stats.reviewedToday} /><Stat title="Due cards" value={stats.dueCards} /><Stat title="Deleted cards" value={stats.deletedCards} /></div><div className="mt-6 grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle>Weakest sections</CardTitle><CardDescription>Based on Again and Hard ratings for active cards.</CardDescription></CardHeader><CardContent className="space-y-2">{stats.weakSections.length === 0 ? <p className="text-sm text-slate-500">No weak sections yet.</p> : stats.weakSections.map(([section, count]) => <div key={section} className="flex items-center justify-between rounded-lg border border-slate-200 p-3"><span>{section}</span><Badge variant="partial">{count} difficult review(s)</Badge></div>)}</CardContent></Card><Card><CardHeader><CardTitle>Next step</CardTitle><CardDescription>Start with mock data, upload notes, or review due cards.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-2"><Button onClick={store.seedMockData}>Load mock cards</Button><Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50" href="/upload">Upload files</Link><Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" href="/review">Review due cards</Link></CardContent></Card></div></div>;
}
function Stat({ title, value }: { title: string; value: number }) { return <Card><CardHeader><CardDescription>{title}</CardDescription><CardTitle className="text-3xl">{value}</CardTitle></CardHeader></Card>; }
