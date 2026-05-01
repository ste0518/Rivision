import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { MathMarkdown } from "@/components/MathMarkdown";
import { buildAssessmentMap, buildCourseMap, buildExamPriorityMap, detectCourseType, extractRawCandidates, parseDocuments, runCoursePackBuilder } from "@/lib/course-builder";
import { validateLatexQuality } from "@/lib/revision-item-utils";
import { coursePackFixtures } from "@/lib/test-fixtures/course-pack";
import { spatialStatisticsFixtureDocument, spatialStatisticsGuidanceDocument } from "@/lib/test-fixtures/spatial-statistics-ch2-excerpt";
import { timeSeriesFixtureDocument } from "@/lib/test-fixtures/time-series-notes-excerpt";

export default async function DebugCourseBuilderPage() {
  const fixtureSets = [
    {
      name: "Time Series notes excerpt",
      input: {
        notesDocuments: [timeSeriesFixtureDocument],
        guidanceDocuments: [coursePackFixtures.guidance],
        pastPaperDocuments: [coursePackFixtures.pastPaper],
        problemSheetDocuments: [coursePackFixtures.problemSheet],
        solutionDocuments: [coursePackFixtures.solutions],
      },
    },
    {
      name: "Spatial Statistics notes excerpt",
      input: {
        notesDocuments: [spatialStatisticsFixtureDocument],
        guidanceDocuments: [spatialStatisticsGuidanceDocument],
        pastPaperDocuments: [coursePackFixtures.pastPaper],
        problemSheetDocuments: [coursePackFixtures.problemSheet],
        solutionDocuments: [coursePackFixtures.solutions],
      },
    },
    {
      name: "Course pack mock assessment",
      input: {
        notesDocuments: [coursePackFixtures.lectureNotes],
        guidanceDocuments: [coursePackFixtures.guidance],
        pastPaperDocuments: [coursePackFixtures.pastPaper],
        problemSheetDocuments: [coursePackFixtures.problemSheet],
        solutionDocuments: [coursePackFixtures.solutions],
      },
    },
  ];

  const results = await Promise.all(fixtureSets.map(async (fixture) => {
    const parsed = parseDocuments(fixture.input);
    const courseType = detectCourseType(parsed);
    const rawCandidates = extractRawCandidates(parsed, courseType);
    const courseMap = buildCourseMap(parsed, courseType, rawCandidates);
    const assessmentMap = buildAssessmentMap(parsed, courseMap);
    const priorityMap = await buildExamPriorityMap(parsed, courseMap, assessmentMap);
    const curated = await runCoursePackBuilder(fixture.input);
    const latexIssues = [...curated.keptItems, ...curated.needsReviewItems].flatMap((item) =>
      validateLatexQuality(item).issues.map((issue) => ({ item: item.cardFront, issue }))
    );
    return { ...fixture, parsed, courseType, rawCandidates, courseMap, assessmentMap, priorityMap, curated, latexIssues };
  }));

  return (
    <div>
      <PageHeader title="Debug course builder" description="Built-in fixtures for the Course Pack Builder pipeline." />
      <div className="space-y-8">
        {results.map((result) => (
          <Card key={result.name}>
            <CardHeader>
              <CardTitle>{result.name}</CardTitle>
              <CardDescription>
                {result.parsed.reduce((sum, doc) => sum + (doc.pages?.length ?? doc.diagnostics.pageCount ?? 0), 0)} parsed page(s) · {result.courseType} · {result.rawCandidates.length} raw candidate(s)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <DebugStat label="Course map topics" value={result.courseMap.topics.length} />
                <DebugStat label="Assessment topics" value={result.assessmentMap.topicFrequency.length} />
                <DebugStat label="Priority topics" value={result.priorityMap.topics.length} />
                <DebugStat label="Kept cards" value={result.curated.keptItems.length} />
                <DebugStat label="Needs review" value={result.curated.needsReviewItems.length} />
                <DebugStat label="Rejected" value={result.curated.rejectedItems.length} />
                <DebugStat label="Embedded" value={result.curated.embeddedItems.length} />
                <DebugStat label="LaTeX issues" value={result.latexIssues.length} />
              </div>

              <div>
                <p className="mb-2 font-medium">Pipeline stages</p>
                <div className="grid gap-2 md:grid-cols-3">
                  {result.curated.curationReport.pipelineStages?.map((stage) => (
                    <div key={stage.name} className="rounded border p-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span>{stage.name}</span>
                        <Badge variant={stage.status === "warning" ? "unknown" : "outline"}>{stage.status}</Badge>
                      </div>
                      <p className="text-xs text-slate-500">{stage.detail}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <DebugList title="Top priority topics" items={result.priorityMap.topics.slice(0, 10).map((topic) => `${topic.topicName} (${topic.priorityLabel ?? topic.priority}${typeof topic.priorityScore === "number" ? ` ${topic.priorityScore}` : ""})`)} />
                <DebugList title="Revision pack categories" items={[
                  `Core definitions: ${result.curated.revisionPack.coreDefinitions?.length ?? result.curated.revisionPack.mustKnowDefinitions.length}`,
                  `Models: ${result.curated.revisionPack.modelsToKnow?.length ?? 0}`,
                  `Conditions: ${result.curated.revisionPack.conditionsAndEquivalences?.length ?? 0}`,
                  `Key formulas: ${result.curated.revisionPack.keyFormulas?.length ?? result.curated.revisionPack.formulasToKnow.length}`,
                  `Calculation templates: ${result.curated.revisionPack.methodsAndTemplates.length}`,
                  `Tests and diagnostics: ${result.curated.revisionPack.testStatisticsAndDiagnostics?.length ?? 0}`,
                  `Worked examples: ${result.curated.revisionPack.workedExamplePatterns?.length ?? 0}`,
                ]} />
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {result.curated.keptItems.slice(0, 9).map((item) => (
                  <Card key={item.id}>
                    <CardHeader>
                      <CardTitle className="text-base">{item.cardFront}</CardTitle>
                      <CardDescription>{item.cardPurpose} · priority {item.priorityScore}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <MathMarkdown content={(item.statementLatex || item.statement).slice(0, 260)} className="bg-transparent p-0 text-sm" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function DebugStat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg border bg-white p-3"><p className="text-2xl font-semibold">{value}</p><p className="text-sm text-slate-500">{label}</p></div>;
}

function DebugList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <p className="mb-2 font-medium">{title}</p>
      {items.length ? items.map((item) => <p key={item} className="text-slate-600">{item}</p>) : <p className="text-slate-500">None.</p>}
    </div>
  );
}
