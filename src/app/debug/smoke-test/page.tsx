"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { loadStorageSettings } from "@/lib/storage";
import { runAllSmokeTests, runSmokeTest, SMOKE_CASES, type SmokeTestRun } from "@/lib/smoke-tests";

export default function SmokeTestPage() {
  const devOn = useMemo(() => loadStorageSettings().developerMode, []);
  const [runs, setRuns] = useState<SmokeTestRun[] | null>(null);
  const [single, setSingle] = useState<SmokeTestRun | null>(null);

  if (!devOn) {
    return (
      <div className="space-y-4">
        <PageHeader title="Smoke tests" description="Developer Mode only." />
        <Card>
          <CardContent className="py-8 text-sm text-slate-600">
            Enable <strong>Developer mode</strong> in Settings → Revision preferences, then return here.
          </CardContent>
        </Card>
        <Link href="/settings" className="text-sm text-blue-700 underline">
          Open Settings
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Run sample smoke test"
        description="Local bundled fixtures validate document typing, page-aware structure, extraction, grounding, and cross-upload isolation (no template leakage)."
      />

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => setRuns(runAllSmokeTests())}>
          Run all smoke tests
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {SMOKE_CASES.map((c) => (
          <Card key={c.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{c.label}</CardTitle>
              <CardDescription className="font-mono text-xs">{c.id}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setSingle(runSmokeTest(c.id))}>
                Run this case
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {single ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Last single run</CardTitle>
            <CardDescription>{single.case.label}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <pre className="overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(single, null, 2)}</pre>
          </CardContent>
        </Card>
      ) : null}

      {runs?.length ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All runs</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[28rem] overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{JSON.stringify(runs, null, 2)}</pre>
          </CardContent>
        </Card>
      ) : null}

      <p className="text-xs text-slate-500">
        Assertions: non-empty pack items for lecture fixtures; no staleSpatialLeak; sectionBlocks present when headings exist. Review JSON for validation flags.
      </p>
    </div>
  );
}
