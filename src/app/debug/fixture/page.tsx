import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MathMarkdown } from "@/components/MathMarkdown";
import { PageHeader } from "@/components/page-header";
import { curateRevisionDeck } from "@/lib/curation";
import { normalizeCuratedRevisionResult } from "@/lib/normalization";
import { normalizeMathNotation } from "@/lib/revision-item-utils";
import { segmentRevisionCandidates } from "@/lib/segmentation";
import { spatialStatisticsFixtureDocument, spatialStatisticsGuidanceDocument } from "@/lib/test-fixtures/spatial-statistics-ch2-excerpt";
import { validateAndRepairRevisionItems } from "@/lib/validation";
import type { RevisionItem } from "@/lib/types";

export default async function FixtureDebugPage() {
  const errors: string[] = [];
  const candidates = segmentRevisionCandidates([spatialStatisticsFixtureDocument]);
  let keptCards: RevisionItem[] = [];
  let needsReviewCards: RevisionItem[] = [];
  let rejected = normalizeCuratedRevisionResult({}).rejectedItems;
  let embedded = normalizeCuratedRevisionResult({}).embeddedItems;

  try {
    const curated = normalizeCuratedRevisionResult(await curateRevisionDeck({
      candidates,
      guidanceDocuments: [spatialStatisticsGuidanceDocument],
      parsedNotes: [spatialStatisticsFixtureDocument],
    }));
    const validation = validateAndRepairRevisionItems([...curated.keptItems, ...curated.needsReviewItems]);
    keptCards = validation.validItems.filter((item) => (item.curationDecision ?? "keep") === "keep");
    needsReviewCards = [
      ...curated.needsReviewItems,
      ...validation.invalidItems.filter((item) => (item.curationDecision ?? "keep") !== "keep"),
    ];
    rejected = curated.rejectedItems;
    embedded = curated.embeddedItems;
    errors.push(...validation.warnings);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Unknown fixture pipeline error.");
  }

  return (
    <div>
      <PageHeader
        title="Fixture pipeline debug"
        description="Developer/debug only: runs the built-in spatial statistics text fixture through parse, segment, curate, normalise LaTeX, validate, and render preview."
      />

      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Parsed chars" value={spatialStatisticsFixtureDocument.fullText.length} />
        <Stat title="Candidates" value={candidates.length} />
        <Stat title="Kept cards" value={keptCards.length} />
        <Stat title="Needs review" value={needsReviewCards.length} />
      </div>

      {errors.length > 0 ? (
        <Card className="mt-6 border-amber-200 bg-amber-50">
          <CardHeader><CardTitle>Errors and warnings</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm text-amber-900">
            {errors.map((error) => <p key={error}>{error}</p>)}
          </CardContent>
        </Card>
      ) : null}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle>Extracted candidates</CardTitle>
          <CardDescription>{candidates.length} segmented candidates from the fixture.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          {candidates.map((candidate) => (
            <div key={candidate.id} className="rounded-lg border p-3 text-sm">
              <div className="mb-2 flex flex-wrap gap-2">
                <Badge variant="outline">{candidate.label}</Badge>
                {candidate.number ? <Badge variant="unknown">{candidate.number}</Badge> : null}
                <Badge variant="outline">page {candidate.pageNumber ?? "?"}</Badge>
                <Badge variant={candidate.rawText.length > 1200 ? "unknown" : "outline"}>{candidate.rawText.length} chars</Badge>
                {candidate.extractionWarning ? <Badge variant="unknown">{candidate.extractionWarning}</Badge> : null}
              </div>
              <p className="whitespace-pre-wrap text-slate-700">{candidate.rawText.slice(0, 300)}{candidate.rawText.length > 300 ? "..." : ""}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <CardSection title="Kept cards" items={keptCards} />
      <CardSection title="Needs review" items={needsReviewCards} />

      <Card className="mt-6">
        <CardHeader><CardTitle>Rejected</CardTitle><CardDescription>{rejected.length} rejected item(s).</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {rejected.map((item) => (
            <div key={item.id} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-slate-500">{item.type} · {item.rejectionCategory} · {item.confidence}</p>
              <p className="mt-1 text-slate-700">{item.rejectionReason}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader><CardTitle>Embedded content</CardTitle><CardDescription>{embedded.length} embedded item(s).</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          {embedded.map((item) => (
            <div key={item.id} className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{item.sourceLocation || "Embedded support content"}</p>
              <p className="text-xs text-slate-500">{item.reason}</p>
              <MathMarkdown content={normalizeMathNotation(item.content)} className="mt-2 bg-transparent p-0" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function CardSection({ title, items }: { title: string; items: RevisionItem[] }) {
  return (
    <Card className="mt-6">
      <CardHeader><CardTitle>{title}</CardTitle><CardDescription>{items.length} card(s).</CardDescription></CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg border p-3">
            <div className="mb-2 flex flex-wrap gap-2">
              <Badge variant="outline">{item.displayTitle || item.title}</Badge>
              <Badge variant="outline">{item.cardPurpose}</Badge>
              <Badge variant="outline">standalone {item.standaloneValue ?? "unknown"}</Badge>
              {item.latexQuality === "low" ? <Badge variant="unknown">Low LaTeX quality</Badge> : null}
            </div>
            <MathMarkdown content={item.cardFront} className="bg-transparent p-0 text-lg font-semibold" />
            {item.taskPrompt ? <p className="mt-2 text-sm text-slate-500">{item.taskPrompt}</p> : null}
            <MathMarkdown content={item.statementLatex || normalizeMathNotation(item.statement)} className="mt-3 bg-transparent p-0" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Stat({ title, value }: { title: string; value: number }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl">{value}</CardTitle>
      </CardHeader>
    </Card>
  );
}
