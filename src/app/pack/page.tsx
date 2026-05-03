"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs } from "@/components/ui/tabs";
import { MathMarkdown } from "@/components/MathMarkdown";
import { PageHeader } from "@/components/page-header";
import {
  buildRevisionPackDebugJson,
  buildRevisionPackSummaryMarkdown,
  downloadTextFile,
  revisionPackDebugFilenameBase,
  totalQualityWarningCount,
} from "@/lib/revision-pack-debug-export";
import { validateGenericStudyPack } from "@/lib/generic-study-pack-validation";
import { cleanUploadedStudySourceText } from "@/lib/source-text-cleanup";
import { isDeveloperUiEnabled } from "@/lib/storage";
import { cardFromDefinition, cardFromFormula, cardFromProof, mockExplainNote } from "@/lib/pack-to-card";
import { createId } from "@/lib/utils";
import type { GeneratedDefinitionItem, GeneratedFormulaItem, GeneratedProofItem, GeneratedRevisionPack } from "@/lib/student-revision-schema";
import { useStudyStore } from "@/hooks/use-study-store";

export default function PackPage() {
  const store = useStudyStore();
  const pack = store.studentRevisionPack;
  const [toast, setToast] = useState("");
  const [editingFormula, setEditingFormula] = useState<GeneratedFormulaItem | null>(null);
  const [editLatex, setEditLatex] = useState("");

  const debugExport = useMemo(() => {
    if (!pack) return null;
    return buildRevisionPackDebugJson({
      notesFiles: store.notesFiles,
      revisionItems: store.revisionItems,
      studentRevisionPack: pack,
      practiceQuestions: store.practiceQuestions,
    });
  }, [pack, store.notesFiles, store.revisionItems, store.practiceQuestions]);

  const packQuality = useMemo(() => {
    if (!pack) return null;
    const sourceUnion = store.notesFiles.map((f) => f.content || f.parsedDocument?.fullText || "").join("\n\n");
    return validateGenericStudyPack(pack, pack.documentProfile ?? null, cleanUploadedStudySourceText(sourceUnion));
  }, [pack, store.notesFiles]);

  const activeCards = store.revisionItems.filter((item) => !item.isDeleted).length;
  const generatedFrom =
    store.notesFiles.find((f) => f.role === "lecture_notes")?.name ?? store.notesFiles[0]?.name ?? "";

  if (!pack) {
    return (
      <div className="space-y-6">
        <PageHeader title="Study pack" description="Your exam overview, definitions, formulas, proofs, and cram sheet — generated locally." />
        <Card className="border-dashed">
          <CardContent className="space-y-3 py-10 text-center text-slate-600">
            <p>No study pack yet. Upload materials and choose <strong>Generate revision pack</strong> on the Upload page.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white" href="/upload">
                Upload &amp; generate
              </Link>
              {activeCards > 0 ? (
                <p className="w-full text-sm text-slate-500">You have {activeCards} card(s) from a previous run; generate again to refresh the structured pack view.</p>
              ) : null}
            </div>
          </CardContent>
        </Card>
        {isDeveloperUiEnabled() ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Developer</CardTitle>
              <CardDescription>Card-bundle revisionPack snapshot (internal).</CardDescription>
            </CardHeader>
            <CardContent className="text-xs text-slate-500">
              <pre className="max-h-48 overflow-auto rounded-lg bg-slate-950 p-3 text-slate-100">{JSON.stringify(store.revisionPack ?? {}, null, 2).slice(0, 2000)}</pre>
            </CardContent>
          </Card>
        ) : null}
      </div>
    );
  }

  function showToast(msg: string) {
    setToast(msg);
    window.setTimeout(() => setToast(""), 3500);
  }

  const tabs = [
    {
      value: "overview",
      label: "Exam overview",
      content: <OverviewSection overview={pack.examOverview} />,
    },
    {
      value: "map",
      label: "Course map",
      content: <CourseMapSection topics={pack.courseMap} />,
    },
    {
      value: "definitions",
      label: "Definitions",
      content: (
        <DefinitionSection
          items={pack.definitions}
          onMakeCard={(d) => {
            store.upsertRevisionItem(cardFromDefinition(d));
            showToast("Card added for active recall.");
          }}
          onExplain={(d) => showToast(mockExplainNote(d.term))}
          onPractice={(d) => {
            store.appendPracticeQuestions([
              {
                id: createId("pq"),
                question: `Recall: ${d.term}`,
                expectedAnswer: d.definition,
                topic: d.term,
                difficulty: "easy",
                sourceBasis: d.sourceFile ?? d.source,
                hints: ["Close the book", "Say aloud first"],
              },
            ]);
            showToast("Practice question added — open Practice to try it.");
          }}
        />
      ),
    },
    {
      value: "formulas",
      label: "Formulas",
      content: (
        <FormulaSection
          items={pack.formulas}
          onMakeCard={(f) => {
            store.upsertRevisionItem(cardFromFormula(f));
            showToast("Formula card added.");
          }}
          onExplain={(f) => showToast(mockExplainNote(f.name))}
          onPractice={(f) => {
            store.appendPracticeQuestions([
              {
                id: createId("pq"),
                question: `Use ${f.name} in a short exam-style prompt.`,
                expectedAnswer: f.whenToUse,
                topic: f.name,
                difficulty: "medium",
                sourceBasis: f.sourceFile ?? f.source,
                hints: ["State formula", "Check conditions"],
              },
            ]);
            showToast("Practice prompt saved.");
          }}
          onMarkOk={(id) => store.patchStudentPackFormulaMathStatus(id, "ok")}
          onEdit={(f) => {
            setEditingFormula(f);
            setEditLatex(f.latex);
          }}
        />
      ),
    },
    {
      value: "proofs",
      label: "Proofs",
      content: (
        <ProofSection
          items={pack.proofs}
          onMakeCard={(p) => {
            store.upsertRevisionItem(cardFromProof(p));
            showToast("Proof card added.");
          }}
          onExplain={(p) => showToast(mockExplainNote(p.name))}
          onPractice={(p) => {
            store.appendPracticeQuestions([
              {
                id: createId("pq"),
                question: `Outline the proof of: ${p.statement.slice(0, 120)}`,
                expectedAnswer: p.proofSkeleton,
                topic: p.name,
                difficulty: "hard",
                sourceBasis: p.sourceFile ?? p.source ?? "study pack",
                hints: ["State assumptions", "Main lemmas"],
              },
            ]);
            showToast("Proof drill saved.");
          }}
        />
      ),
    },
    {
      value: "methods",
      label: "Methods",
      content: <MethodSection methods={pack.methods} />,
    },
    {
      value: "patterns",
      label: "Past paper patterns",
      content: <PatternsSection patterns={pack.pastPaperPatterns} />,
    },
    {
      value: "mistakes",
      label: "Common mistakes",
      content: <MistakesSection mistakes={pack.commonMistakes} />,
    },
    {
      value: "cram",
      label: "Cram sheet",
      content: <CramSection cram={pack.cramSheet} />,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Study pack"
        description="Structured revision built from your uploads. Everything stays on your device."
      />

      {debugExport && packQuality ? (
        <Card className="border-slate-200 bg-slate-50/80">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pack quality</CardTitle>
            <CardDescription>
              Status:{" "}
              <span className={packQuality.criticalQualityFailure ? "font-semibold text-red-800" : packQuality.ok ? "font-semibold text-green-800" : "font-semibold text-amber-800"}>
                {packQuality.criticalQualityFailure ? "Critical issues" : packQuality.ok ? "OK" : "Needs attention"}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {(packQuality.topActionableFailures.length ? packQuality.topActionableFailures : packQuality.recommendations).slice(0, 6).length ? (
              <div>
                <p className="text-xs font-medium text-slate-600">Top actionable issues</p>
                <ul className="mt-1 list-inside list-disc text-slate-700">
                  {(packQuality.topActionableFailures.length ? packQuality.topActionableFailures : packQuality.recommendations).slice(0, 6).map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-slate-600">No blocking issues flagged by generic checks.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const base = revisionPackDebugFilenameBase(debugExport.metadata.sourceFilename);
                  downloadTextFile(JSON.stringify(debugExport, null, 2), "application/json", `revision-pack-debug-${base}.json`);
                }}
              >
                Download Debug JSON
              </Button>
              <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50" href="/upload">
                Regenerate with safer extraction
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {packQuality?.criticalQualityFailure ? (
        <div className="rounded-lg border-2 border-red-300 bg-red-50 px-4 py-4 text-sm text-red-950 shadow-sm">
          <p className="text-base font-semibold">Generated with critical quality failures. Do not rely on this pack yet.</p>
          <p className="mt-2 text-red-900">
            This pack should not be treated as exam-ready until you confirm extraction issues below. Everything here is derived only from your files — no cloud generation.
          </p>
          <ul className="mt-3 list-inside list-decimal space-y-1.5 text-red-900">
            {(packQuality.topActionableFailures.length ? packQuality.topActionableFailures : packQuality.recommendations).slice(0, 12).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              className="inline-flex h-10 items-center justify-center rounded-md border border-red-400 bg-white px-4 text-sm font-medium text-red-950 hover:bg-red-100"
              href="/upload"
            >
              Regenerate with safer extraction
            </Link>
            <p className="self-center text-xs text-red-800">Open Upload, replace notes if needed, and generate again for a clean pass without stale topic cues.</p>
          </div>
        </div>
      ) : null}

      {toast ? <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-950">{toast}</p> : null}

      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-xl">{pack.examOverview.courseName ?? "Your course"}</CardTitle>
            <CardDescription>
              {generatedFrom ? (
                <>
                  <span className="text-slate-800">Generated from: {generatedFrom}</span>
                  <br />
                </>
              ) : null}
              {pack.definitions.length} definitions · {pack.formulas.length} formulas · {pack.proofs.length} proofs · {pack.methods.length} methods
              {activeCards ? ` · ${activeCards} review card(s)` : ""}
              <br />
              {pack.examOverview.reviewCardsWarning ? (
                <span className="text-amber-800">{pack.examOverview.reviewCardsWarning}</span>
              ) : null}
              {pack.examOverview.reviewCardsWarning ? <br /> : null}
              <span className="text-xs text-slate-500">Generated {new Date(pack.generatedAt).toLocaleString()}</span>
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 text-sm font-medium text-white" href="/review">
              Review cards
            </Link>
            <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm" href="/quiz">
              Practice
            </Link>
            {debugExport ? (
              <>
                <Button
                  type="button"
                  variant="outline"
                  className="border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(JSON.stringify(debugExport, null, 2));
                      showToast("Debug JSON copied.");
                    } catch {
                      showToast("Could not copy to clipboard.");
                    }
                  }}
                >
                  Copy Debug JSON
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    const base = revisionPackDebugFilenameBase(debugExport.metadata.sourceFilename);
                    downloadTextFile(JSON.stringify(debugExport, null, 2), "application/json", `revision-pack-debug-${base}.json`);
                  }}
                >
                  Download Debug JSON
                </Button>
              </>
            ) : null}
          </div>
        </CardHeader>
      </Card>

      <Tabs tabs={tabs} defaultValue="overview" />

      {debugExport ? (
        <>
          {debugExport.qualityChecks.criticalQualityFailure ? (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="pt-4 text-sm text-amber-950">
                {debugExport.qualityChecks.acceptanceWarningMessage ??
                  "Study pack generated, but quality checks failed. Review Debug JSON."}
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Export</CardTitle>
              <CardDescription>
                Download or copy the full generated pack for an external reviewer (JSON includes extraction, study pack, and quality checks). Everything stays local — no upload.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(JSON.stringify(debugExport, null, 2));
                    showToast("Debug JSON copied.");
                  } catch {
                    showToast("Could not copy to clipboard.");
                  }
                }}
              >
                Copy Debug JSON
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const base = revisionPackDebugFilenameBase(debugExport.metadata.sourceFilename);
                  downloadTextFile(JSON.stringify(debugExport, null, 2), "application/json", `revision-pack-debug-${base}.json`);
                }}
              >
                Download Debug JSON
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const base = revisionPackDebugFilenameBase(debugExport.metadata.sourceFilename);
                  const md = buildRevisionPackSummaryMarkdown(debugExport);
                  downloadTextFile(md, "text/markdown;charset=utf-8", `revision-pack-summary-${base}.md`);
                }}
              >
                Download Markdown Summary
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Debug counts</CardTitle>
              <CardDescription>Snapshot of this pack (updates when you regenerate).</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Definitions</dt>
                  <dd className="font-medium text-slate-900">{debugExport.studyPack.definitions.length}</dd>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Formulas</dt>
                  <dd className="font-medium text-slate-900">{debugExport.studyPack.formulas.length}</dd>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Proofs</dt>
                  <dd className="font-medium text-slate-900">{debugExport.studyPack.proofs.length}</dd>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Examples</dt>
                  <dd className="font-medium text-slate-900">{debugExport.studyPack.examples.length}</dd>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Exercises</dt>
                  <dd className="font-medium text-slate-900">{debugExport.studyPack.exercises.length}</dd>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Flashcards</dt>
                  <dd className="font-medium text-slate-900">{debugExport.studyPack.flashcards.length}</dd>
                </div>
                <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                  <dt className="text-xs text-slate-500">Quiz questions</dt>
                  <dd className="font-medium text-slate-900">{debugExport.studyPack.quizQuestions.length}</dd>
                </div>
                <div className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2">
                  <dt className="text-xs text-amber-800">Quality warnings</dt>
                  <dd className="font-medium text-amber-950">{totalQualityWarningCount(debugExport.qualityChecks)}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </>
      ) : null}

      {editingFormula ? (
        <Dialog open onOpenChange={(o) => { if (!o) setEditingFormula(null); }}>
          <DialogContent>
            <h2 className="text-lg font-semibold">Edit formula</h2>
            <p className="text-sm text-slate-500">Use LaTeX with \\( ... \\) or $ ... $.</p>
            <Textarea className="min-h-32 font-mono text-sm" value={editLatex} onChange={(e) => setEditLatex(e.target.value)} />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingFormula(null)}>Cancel</Button>
              <Button
                type="button"
                onClick={() => {
                  if (editingFormula) {
                    store.updateStudentPackFormulaLatex(editingFormula.id, editLatex);
                    setEditingFormula(null);
                    showToast("Formula updated and re-checked.");
                  }
                }}
              >
                Save
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function OverviewSection({ overview }: { overview: GeneratedRevisionPack["examOverview"] }) {
  return (
    <div className="space-y-4">
      <p className="text-slate-700">{overview.summary}</p>
      <div>
        <h3 className="font-medium text-slate-900">Likely exam structure</h3>
        <p className="mt-1 text-sm text-slate-600">{overview.likelyExamStructure}</p>
      </div>
      <div>
        <h3 className="font-medium text-slate-900">High-priority topics</h3>
        <ul className="mt-2 list-inside list-disc text-sm text-slate-800">
          {overview.highPriorityTopics.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="py-8 text-center text-sm text-slate-600">{message}</CardContent>
    </Card>
  );
}

function CourseMapSection({ topics }: { topics: GeneratedRevisionPack["courseMap"] }) {
  if (!topics.length) {
    return <EmptyState message="No course map detected. Re-upload your lecture notes — we look for numbered section headings such as 4.1, 4.2." />;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {topics.map((t) => (
        <Card key={t.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t.title}</CardTitle>
            <CardDescription>Importance: {t.importance}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-600">
            <p><span className="font-medium text-slate-800">Sources:</span> {t.sourceFileNames.join(", ")}</p>
            <p><span className="font-medium text-slate-800">Why:</span> {t.evidenceReason}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function DefinitionSection({
  items,
  onMakeCard,
  onExplain,
  onPractice,
}: {
  items: GeneratedDefinitionItem[];
  onMakeCard: (d: GeneratedDefinitionItem) => void;
  onExplain: (d: GeneratedDefinitionItem) => void;
  onPractice: (d: GeneratedDefinitionItem) => void;
}) {
  if (!items.length) {
    return <EmptyState message="No definitions detected. Check whether your PDF contains labelled definitions (e.g. 'Definition 4.1') or try regenerating the pack." />;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {items.map((d) => (
        <div className="rounded-lg border border-slate-200 p-4" key={d.id}>
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-slate-950">{d.term}</p>
            {d.formalLabel ? (
              <Badge variant="outline" className="font-normal">
                {d.formalLabel}
              </Badge>
            ) : null}
            {d.itemKind && d.itemKind !== "definition" ? (
              <Badge variant="outline" className="font-normal capitalize">
                {d.itemKind}
              </Badge>
            ) : null}
          </div>
          <MathMarkdown content={d.definition} className="mt-2 text-sm text-slate-800" />
          <dl className="mt-3 grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
            <div>
              <dt className="font-medium text-slate-700">Source file</dt>
              <dd>{d.sourceFile ?? d.source}</dd>
            </div>
            {d.sourceLabel ? (
              <div>
                <dt className="font-medium text-slate-700">Label</dt>
                <dd>{d.sourceLabel}</dd>
              </div>
            ) : null}
            {d.sourceSection ? (
              <div className="sm:col-span-2">
                <dt className="font-medium text-slate-700">Section</dt>
                <dd>{d.sourceSection}</dd>
              </div>
            ) : null}
            {d.sourcePage != null ? (
              <div>
                <dt className="font-medium text-slate-700">Page</dt>
                <dd>{d.sourcePage}</dd>
              </div>
            ) : null}
            <div>
              <dt className="font-medium text-slate-700">Importance</dt>
              <dd>{d.importance}</dd>
            </div>
            {d.mathStatus ? (
              <div>
                <dt className="font-medium text-slate-700">Math status</dt>
                <dd>{d.mathStatus}</dd>
              </div>
            ) : null}
          </dl>
          {d.sourceExcerpt ? (
            <details className="mt-3 text-sm">
              <summary className="cursor-pointer text-slate-600 hover:text-slate-900">Show source excerpt</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-xs text-slate-800">{d.sourceExcerpt}</pre>
            </details>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" type="button" className="bg-blue-700 hover:bg-blue-800" onClick={() => onMakeCard(d)}>
              Add to review
            </Button>
            <Button size="sm" type="button" variant="outline" className="text-xs h-8" onClick={() => onExplain(d)}>
              Explain
            </Button>
            <Button size="sm" type="button" variant="outline" className="text-xs h-8" onClick={() => onPractice(d)}>
              Practice
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function FormulaSection({
  items,
  onMakeCard,
  onExplain,
  onPractice,
  onMarkOk,
  onEdit,
}: {
  items: GeneratedFormulaItem[];
  onMakeCard: (f: GeneratedFormulaItem) => void;
  onExplain: (f: GeneratedFormulaItem) => void;
  onPractice: (f: GeneratedFormulaItem) => void;
  onMarkOk: (id: string) => void;
  onEdit: (f: GeneratedFormulaItem) => void;
}) {
  if (!items.length) {
    return <EmptyState message="No formulas detected. Re-upload notes that contain equations (e.g. transition matrices, balance conditions) or try regenerating the pack." />;
  }
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {items.map((f) => (
        <Card key={f.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{f.name}</CardTitle>
            <CardDescription>{f.whenToUse}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {f.formulaPlain ? (
              <p className="rounded-md border border-slate-100 bg-white px-3 py-2 font-mono text-xs text-slate-700">{f.formulaPlain}</p>
            ) : null}
            <MathMarkdown content={f.latex} className="rounded-lg bg-slate-50 p-3 text-base" />
            <dl className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-700">Source file</dt>
                <dd>{f.sourceFile ?? f.source}</dd>
              </div>
              {f.sourceSection ? (
                <div className="sm:col-span-2">
                  <dt className="font-medium text-slate-700">Section</dt>
                  <dd>{f.sourceSection}</dd>
                </div>
              ) : null}
              {f.sourcePage != null ? (
                <div>
                  <dt className="font-medium text-slate-700">Page</dt>
                  <dd>{f.sourcePage}</dd>
                </div>
              ) : null}
              {f.sourceLabel ? (
                <div>
                  <dt className="font-medium text-slate-700">Label</dt>
                  <dd>{f.sourceLabel}</dd>
                </div>
              ) : null}
              <div>
                <dt className="font-medium text-slate-700">Math status</dt>
                <dd>{f.mathStatus}</dd>
              </div>
            </dl>
            {f.sourceExcerpt ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-slate-600 hover:text-slate-900">Show source excerpt</summary>
                <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-2 font-sans text-xs">{f.sourceExcerpt}</pre>
              </details>
            ) : null}
            {f.mathStatus !== "ok" ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                This formula may need checking.
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" type="button" variant="outline" onClick={() => onEdit(f)}>
                    Edit
                  </Button>
                  <Button size="sm" type="button" onClick={() => onMarkOk(f.id)}>
                    Mark as OK
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" type="button" className="bg-blue-700 hover:bg-blue-800" onClick={() => onMakeCard(f)}>
                Add to review
              </Button>
              <Button size="sm" type="button" variant="outline" className="text-xs h-8" onClick={() => onExplain(f)}>
                Explain
              </Button>
              <Button size="sm" type="button" variant="outline" className="text-xs h-8" onClick={() => onPractice(f)}>
                Practice
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function ProofSection({
  items,
  onMakeCard,
  onExplain,
  onPractice,
}: {
  items: GeneratedProofItem[];
  onMakeCard: (p: GeneratedProofItem) => void;
  onExplain: (p: GeneratedProofItem) => void;
  onPractice: (p: GeneratedProofItem) => void;
}) {
  if (!items.length) {
    return <EmptyState message="No proof items detected. We pair Theorem/Proposition/Lemma blocks with their following 'Proof.' bodies — re-upload notes that include either." />;
  }
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {items.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle className="text-base">{p.proofName ?? p.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="grid gap-1 text-xs text-slate-600 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-slate-700">Source file</dt>
                <dd>{p.sourceFile ?? p.source ?? "—"}</dd>
              </div>
              {p.sourceSection ? (
                <div className="sm:col-span-2">
                  <dt className="font-medium text-slate-700">Section</dt>
                  <dd>{p.sourceSection}</dd>
                </div>
              ) : null}
              {p.sourcePage != null ? (
                <div>
                  <dt className="font-medium text-slate-700">Page</dt>
                  <dd>{p.sourcePage}</dd>
                </div>
              ) : null}
              {p.sourceLabel ? (
                <div>
                  <dt className="font-medium text-slate-700">Label</dt>
                  <dd>{p.sourceLabel}</dd>
                </div>
              ) : null}
            </dl>
            <div>
              <p className="font-medium text-slate-800">Statement</p>
              <MathMarkdown content={p.statement} className="mt-1 text-slate-700" />
            </div>
            <div>
              <p className="font-medium text-slate-800">Skeleton</p>
              <p className="mt-1 text-slate-700">{p.proofSkeleton}</p>
            </div>
            <div>
              <p className="font-medium text-slate-800">Common mistake</p>
              <p className="mt-1 text-amber-900">{p.commonMistake}</p>
            </div>
            {p.sourceExcerpt ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-slate-600 hover:text-slate-900">Show source excerpt</summary>
                <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-slate-50 p-3 font-sans text-xs">{p.sourceExcerpt}</pre>
              </details>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" type="button" className="bg-blue-700 hover:bg-blue-800" onClick={() => onMakeCard(p)}>
                Add to review
              </Button>
              <Button size="sm" type="button" variant="outline" className="text-xs h-8" onClick={() => onExplain(p)}>
                Explain
              </Button>
              <Button size="sm" type="button" variant="outline" className="text-xs h-8" onClick={() => onPractice(p)}>
                Practice
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MethodSection({ methods }: { methods: GeneratedRevisionPack["methods"] }) {
  if (!methods.length) {
    return <EmptyState message="No algorithms or method templates detected. We look for 'Algorithm N' blocks and recognised pattern names." />;
  }
  return (
    <div className="space-y-4">
      {methods.map((m) => (
        <Card key={m.id}>
          <CardHeader>
            <CardTitle className="text-base">{m.problemType}</CardTitle>
            <CardDescription>Trigger words: {m.triggerWords.join(", ")}</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-inside list-decimal space-y-1 text-sm text-slate-700">
              {m.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="mt-3 text-xs text-slate-500">Related practice: {m.relatedPracticeType}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function PatternsSection({ patterns }: { patterns: GeneratedRevisionPack["pastPaperPatterns"] }) {
  return (
    <div className="space-y-4">
      {patterns.map((p) => (
        <Card key={p.id}>
          <CardHeader>
            <CardTitle className="text-base">{p.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <p><span className="font-medium">Evidence:</span> {p.evidence}</p>
            <p><span className="font-medium">Likely style:</span> {p.likelyExamStyle}</p>
            <p><span className="font-medium">Try:</span> {p.suggestedPracticeQuestion}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function MistakesSection({ mistakes }: { mistakes: GeneratedRevisionPack["commonMistakes"] }) {
  return (
    <div className="space-y-3">
      {mistakes.map((m) => (
        <Card key={m.id}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{m.mistake}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-slate-700">
            <p><span className="font-medium">Why:</span> {m.whyItHappens}</p>
            <p><span className="font-medium">Fix:</span> {m.howToAvoid}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function CramSection({ cram }: { cram: GeneratedRevisionPack["cramSheet"] }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle className="text-base">Definitions</CardTitle></CardHeader>
        <CardContent>
          <ul className="list-inside list-disc space-y-1 text-sm text-slate-800">
            {cram.definitionBullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Formulas</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {cram.formulaBullets.map((b) => (
            <MathMarkdown key={b} content={b} className="rounded border border-slate-100 bg-slate-50 p-2" />
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Proof skeletons</CardTitle></CardHeader>
        <CardContent>
          <ul className="list-inside list-disc space-y-1 text-sm">
            {cram.proofSkeletonBullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">Traps</CardTitle></CardHeader>
        <CardContent>
          <ul className="list-inside list-disc space-y-1 text-sm text-amber-950">
            {cram.trapBullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
