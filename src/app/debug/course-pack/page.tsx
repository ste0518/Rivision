import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { MathMarkdown } from "@/components/MathMarkdown";
import { buildExamPriorityMap } from "@/lib/course-priority";
import { curateRevisionDeck } from "@/lib/curation";
import { validateLatexQuality } from "@/lib/revision-item-utils";
import { attachProofsToPreviousTheorem, segmentRevisionCandidates } from "@/lib/segmentation";
import { coursePackFixtures } from "@/lib/test-fixtures/course-pack";

export default async function DebugCoursePackPage() {
  const notesDocuments = [coursePackFixtures.lectureNotes];
  const guidanceDocuments = [coursePackFixtures.guidance];
  const pastPaperDocuments = [coursePackFixtures.pastPaper];
  const problemSheetDocuments = [coursePackFixtures.problemSheet];
  const solutionDocuments = [coursePackFixtures.solutions];
  const candidates = attachProofsToPreviousTheorem(segmentRevisionCandidates(notesDocuments));
  const examPriorityMap = await buildExamPriorityMap({ notesDocuments, guidanceDocuments, pastPaperDocuments, problemSheetDocuments, solutionDocuments });
  const curated = await curateRevisionDeck({ candidates, guidanceDocuments, parsedNotes: notesDocuments, pastPaperDocuments, problemSheetDocuments, solutionDocuments, examPriorityMap });
  const latexIssues = [...curated.keptItems, ...curated.needsReviewItems].flatMap((item) => {
    const report = validateLatexQuality(item);
    return report.issues.map((issue) => ({ item: item.displayTitle || item.title, issue, score: report.score }));
  });

  return (
    <div>
      <PageHeader title="Debug course pack" description="Built-in notes + guidance + past paper + problem sheet fixture for the course-aware pipeline." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Exam priority map</CardTitle>
            <CardDescription>{examPriorityMap.topics.length} topic(s), {examPriorityMap.recurringQuestionTypes.length} recurring question type(s)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {examPriorityMap.topics.slice(0, 10).map((topic) => (
              <div key={topic.topicName} className="rounded-lg border p-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{topic.topicName}</p>
                  <Badge variant={topic.priority === "very_high" || topic.priority === "high" ? "must_know" : "partial"}>{topic.priority}</Badge>
                </div>
                <p className="text-xs text-slate-500">{topic.likelyAssessmentMode}</p>
                {topic.evidence[0] ? <p className="mt-2 text-slate-600">{topic.evidence[0].excerpt}</p> : null}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Revision pack</CardTitle>
            <CardDescription>{curated.revisionPack.overview}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
            <PackStat label="Top topics" value={curated.revisionPack.topTopics.length} />
            <PackStat label="Definitions" value={curated.revisionPack.mustKnowDefinitions.length} />
            <PackStat label="Theorems" value={curated.revisionPack.theoremStatements.length} />
            <PackStat label="Proofs" value={curated.revisionPack.proofsToKnow.length} />
            <PackStat label="Formulas" value={curated.revisionPack.formulasToKnow.length} />
            <PackStat label="Methods" value={curated.revisionPack.methodsAndTemplates.length} />
            <PackStat label="Distinctions" value={curated.revisionPack.conceptualDistinctions.length} />
            <PackStat label="Needs review" value={curated.revisionPack.needsReview.length} />
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Kept cards</CardTitle>
          <CardDescription>{curated.keptItems.length} card(s) kept for normal review.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {curated.keptItems.map((item) => (
            <Card key={item.id}>
              <CardHeader>
                <CardTitle className="text-base">{item.cardFront}</CardTitle>
                <CardDescription>{item.revisionPackCategory} · priority {item.priorityScore}</CardDescription>
              </CardHeader>
              <CardContent>
                <MathMarkdown content={item.statementLatex || item.statement} className="bg-transparent p-0 text-sm" />
                <p className="mt-2 text-xs text-slate-500">{item.whyThisCardMatters}</p>
              </CardContent>
            </Card>
          ))}
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Needs review</CardTitle>
            <CardDescription>{curated.needsReviewItems.length} borderline or low-quality card(s).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {curated.needsReviewItems.length === 0 ? <p className="text-sm text-slate-500">None.</p> : curated.needsReviewItems.map((item) => (
              <div key={item.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{item.displayTitle || item.title}</p>
                <p className="text-slate-600">{item.curationReason}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rejected cards</CardTitle>
            <CardDescription>{curated.rejectedItems.length} low-value or unsupported item(s).</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {curated.rejectedItems.length === 0 ? <p className="text-sm text-slate-500">None.</p> : curated.rejectedItems.map((item) => (
              <div key={item.id} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">{item.title}</p>
                <p className="text-slate-600">{item.rejectionReason}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>LaTeX issues</CardTitle>
          <CardDescription>{latexIssues.length} issue(s) after local normalization and validation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {latexIssues.length === 0 ? <p className="text-slate-500">No low-level LaTeX issues detected.</p> : latexIssues.map((issue) => (
            <div key={`${issue.item}-${issue.issue}`} className="rounded-lg border p-3">
              <p className="font-medium">{issue.item}</p>
              <p className="text-slate-600">{issue.score}: {issue.issue}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PackStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border bg-white p-3"><p className="text-xl font-semibold">{value}</p><p className="text-slate-500">{label}</p></div>;
}
