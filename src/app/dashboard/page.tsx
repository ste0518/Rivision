"use client";

import { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { isDue } from "@/lib/srs";
import { useStudyStore } from "@/hooks/use-study-store";

export default function DashboardPage() {
  const store = useStudyStore();

  const uploadedCount = store.notesFiles.length + store.guidanceFiles.length;
  const hasPack = Boolean(store.studentRevisionPack);
  const activeItems = useMemo(() => store.revisionItems.filter((item) => !item.isDeleted), [store.revisionItems]);
  const kept = useMemo(() => activeItems.filter((item) => (item.curationDecision ?? "keep") === "keep"), [activeItems]);

  const stats = useMemo(() => {
    const defs = kept.filter((i) => i.type === "definition" || i.revisionPackCategory === "mustKnowDefinitions").length;
    const forms = kept.filter((i) => i.type === "formula" || i.revisionPackCategory === "formulasToKnow").length;
    const proofs = kept.filter((i) => i.type === "proof" || i.revisionPackCategory === "proofsToKnow").length;
    const practiceLike = kept.filter((i) =>
      ["calculation_template", "worked_example_pattern"].includes(i.cardPurpose ?? "") || i.revisionPackCategory === "workedExamplePatterns",
    ).length;
    const weakTopics = store.studentRevisionPack?.courseMap.filter((t) => t.importance !== "high").slice(0, 5).map((t) => t.title) ?? [];
    const pastCoverage = store.guidanceFiles.some((f) => f.role === "past_paper") ? "Past papers on file" : "Add past papers for stronger coverage";
    return {
      defs,
      forms,
      proofs,
      practiceQs: Math.max(practiceLike, store.practiceQuestions?.length ?? 0),
      weakTopics,
      pastCoverage,
    };
  }, [kept, store.guidanceFiles, store.practiceQuestions?.length, store.studentRevisionPack]);

  const reviewedDefs = useMemo(() => {
    const defIds = new Set(kept.filter((i) => i.type === "definition" || i.revisionPackCategory === "mustKnowDefinitions").map((i) => i.id));
    const reviewed = store.reviewSessions.filter((s) => defIds.has(s.itemId));
    return { reviewed: new Set(reviewed.map((s) => s.itemId)).size, total: defIds.size };
  }, [kept, store.reviewSessions]);

  const priorityPanel = useMemo(() => {
    if (stats.weakTopics.length > 0) {
      return { title: "Today's priority", lines: stats.weakTopics.map((t) => `Spend 15 minutes on: ${t}`) };
    }
    if (stats.defs > 0) return { title: "Today's priority", lines: ["Review must-know definitions in your study pack or Review tab."] };
    return { title: "Suggested next step", lines: ["Upload course materials, then generate your revision pack."] };
  }, [stats.defs, stats.weakTopics]);

  const onboarding = uploadedCount === 0 || !hasPack;

  return (
    <div className="space-y-10">
      <PageHeader title="Home" description="Your exam-focused revision workspace." />

      {onboarding ? (
        <section className="rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50/80 to-white px-6 py-10 sm:px-10">
          <div className="mx-auto max-w-2xl text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-700 text-white">
              <Sparkles className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-slate-950">Build your exam-focused revision pack</h2>
            <p className="mt-3 text-slate-600">
              Upload your lecture notes, past papers, problem sheets, and solutions. Rivision will organise them into definitions, formulas, proofs, method templates,
              practice questions, and a cram sheet.
            </p>
            <ol className="mt-8 grid gap-4 text-left text-sm text-slate-700 sm:grid-cols-2">
              {[
                "Upload course files",
                "Generate study pack",
                "Review must-know topics",
                "Start practice and active recall",
              ].map((label, index) => (
                <li key={label} className="flex gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-semibold text-blue-800">{index + 1}</span>
                  <span className="pt-1 font-medium">{label}</span>
                </li>
              ))}
            </ol>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link className="inline-flex h-11 items-center justify-center rounded-md bg-blue-700 px-6 text-sm font-medium text-white hover:bg-blue-800" href="/upload">
                Upload course files
              </Link>
              {uploadedCount > 0 ? (
                <Link className="inline-flex h-11 items-center justify-center rounded-md bg-slate-100 px-6 text-sm font-medium text-slate-900 hover:bg-slate-200" href="/upload">
                  Generate revision pack
                </Link>
              ) : null}
              {hasPack ? (
                <Link className="inline-flex h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-6 text-sm font-medium hover:bg-slate-50" href="/pack">
                  Open study pack
                </Link>
              ) : null}
              {kept.length > 0 ? (
                <Link className="inline-flex h-11 items-center justify-center rounded-md border border-slate-300 bg-white px-6 text-sm font-medium hover:bg-slate-50" href="/quiz">
                  Start practice
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {!onboarding ? (
        <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <StatCard title="Must-know definitions" value={stats.defs} hint="From your active cards" />
          <StatCard title="Formulas" value={stats.forms} hint="Formula recall cards" />
          <StatCard title="Proofs" value={stats.proofs} hint="Proof templates" />
          <StatCard title="Practice questions" value={stats.practiceQs} hint="Cards + generated drills" />
          <StatCard title="Weak topics" value={stats.weakTopics.length} hint="Topics to revisit" accent={stats.weakTopics.length > 0} />
          <StatCard title="Past paper coverage" value="—" hint={stats.pastCoverage} />
        </section>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{priorityPanel.title}</CardTitle>
            <CardDescription>Short focus for today&apos;s session.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {priorityPanel.lines.map((line) => (
              <p key={line} className="rounded-lg border border-slate-100 bg-slate-50/80 p-3 text-sm text-slate-800">
                {line}
              </p>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Continue</CardTitle>
            <CardDescription>Jump back into your workflow.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <LinkRow href="/upload" label="Upload your course materials" />
            <LinkRow href="/pack" label="Open study pack" disabled={!hasPack} />
            <LinkRow href="/review" label="Review must-know items" disabled={kept.length === 0} />
            <LinkRow href="/quiz" label="Practice exam-style questions" />
            <LinkRow href="/progress" label="Track progress" />
          </CardContent>
        </Card>
      </section>

      {hasPack && kept.length > 0 ? (
        <div className="flex flex-wrap gap-2 text-xs text-slate-500">
          <span>Definitions reviewed (estimate): {reviewedDefs.reviewed}/{Math.max(reviewedDefs.total, 1)}</span>
          <span aria-hidden>·</span>
          <span>Due cards today: {kept.filter((i) => i.importance !== "not_required" && isDue(i)).length}</span>
        </div>
      ) : null}
    </div>
  );
}

function StatCard({ title, value, hint, accent }: { title: string; value: number | string; hint: string; accent?: boolean }) {
  return (
    <Card className={accent ? "border-amber-200 bg-amber-50/40" : ""}>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl font-semibold">{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-slate-500">{hint}</p>
      </CardContent>
    </Card>
  );
}

function LinkRow({ href, label, disabled }: { href: string; label: string; disabled?: boolean }) {
  if (disabled) {
    return <span className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-400">{label}</span>;
  }
  return (
    <Link href={href} className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3 text-sm font-medium text-slate-900 hover:bg-slate-50">
      {label}
      <ArrowRight className="h-4 w-4 text-slate-400" />
    </Link>
  );
}
