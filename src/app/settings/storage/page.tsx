"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { useStudyStore } from "@/hooks/use-study-store";
import {
  clearDebugData,
  clearParsedTextKeepCards,
  clearUploadedFilesKeepCards,
  deleteCurrentProject,
  estimateStorageUsage,
  exportActiveCardsJson,
  exportFullProjectJson,
  importFullProjectJson,
  resetAllLocalData,
  type StorageUsageEstimate,
} from "@/lib/storage";

export default function StorageSettingsPage() {
  const store = useStudyStore();
  const [usage, setUsage] = useState<StorageUsageEstimate | null>(null);
  const [status, setStatus] = useState("");
  const [importJson, setImportJson] = useState("");
  const [includeSourceFiles, setIncludeSourceFiles] = useState(false);

  const counts = usage?.indexedDbCounts ?? {};
  const activeCards = useMemo(() => store.revisionItems.filter((item) => !item.isDeleted), [store.revisionItems]);

  useEffect(() => {
    void refreshUsage();
  }, []);

  async function refreshUsage() {
    setUsage(await estimateStorageUsage());
  }

  async function runAction(label: string, action: () => Promise<void>, reload = false) {
    try {
      setStatus(`${label}...`);
      await action();
      await refreshUsage();
      setStatus(`${label} complete.`);
      if (reload) window.location.reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${label} failed.`);
    }
  }

  async function downloadCards() {
    downloadJson("rivision-active-cards.json", await exportActiveCardsJson());
  }

  async function downloadFullProject() {
    downloadJson("rivision-project.json", await exportFullProjectJson({ includeSourceFiles }));
  }

  async function importProject() {
    try {
      const imported = await importFullProjectJson(importJson);
      store.setRevisionItems(imported.revisionItems, imported.rejectedItems, {
        embeddedItems: imported.embeddedItems,
        courseMap: imported.courseMap,
        courseStructureMap: imported.courseStructureMap,
        courseKnowledgeMap: imported.courseKnowledgeMap,
        assessmentMap: imported.assessmentMap,
        examPriorityMap: imported.examPriorityMap,
        revisionPack: imported.revisionPack,
        curationReport: imported.curationReport,
      });
      setImportJson("");
      await refreshUsage();
      setStatus("Project import complete.");
      window.location.reload();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Project import failed.");
    }
  }

  return (
    <div>
      <PageHeader title="Storage manager" description="Keep localStorage small, manage IndexedDB project data, and export cards before clearing anything." />

      {store.storageError ? (
        <Card className="mb-6 border-red-200 bg-red-50">
          <CardHeader>
            <CardTitle>Storage recovery</CardTitle>
            <CardDescription>{store.storageError}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void store.migrateLocalStorage()}>Migrate to IndexedDB</Button>
            <Button variant="outline" onClick={() => void runAction("Clear debug/cache", clearDebugData)}>Clear debug/cache</Button>
            <Button variant="outline" onClick={() => void downloadCards()}>Export cards</Button>
            <Button variant="destructive" onClick={() => void runAction("Reset all local data", resetAllLocalData, true)}>Reset all local data</Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Storage usage</CardTitle>
            <CardDescription>localStorage should stay under 200 KB. Large study data lives in IndexedDB.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Metric label="Estimated used storage" value={formatBytes(usage?.usageBytes)} />
            <Metric label="Estimated quota" value={formatBytes(usage?.quotaBytes)} />
            <Metric label="localStorage total" value={formatBytes(usage?.localStorageBytes)} />
            <div>
              <p className="font-medium">localStorage keys</p>
              <div className="mt-2 space-y-1">
                {usage?.localStorageKeys.length ? usage.localStorageKeys.map((key) => (
                  <div key={key.key} className="flex justify-between rounded border px-2 py-1">
                    <span>{key.key}</span>
                    <span>{formatBytes(key.bytes)}</span>
                  </div>
                )) : <p className="text-slate-500">No Rivision localStorage keys found.</p>}
              </div>
            </div>
            <Button variant="outline" onClick={() => void refreshUsage()}>Refresh usage</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>IndexedDB records</CardTitle>
            <CardDescription>Counts for project stores, parsed text, candidates, cards, and review events.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
            <Metric label="Projects" value={counts.projects ?? 0} />
            <Metric label="Uploaded files" value={counts.files ?? 0} />
            <Metric label="Parsed documents" value={counts.parsedDocuments ?? 0} />
            <Metric label="Parsed pages" value={counts.parsedPages ?? 0} />
            <Metric label="Candidates" value={counts.candidates ?? 0} />
            <Metric label="Cards" value={counts.revisionItems ?? activeCards.length} />
            <Metric label="Rejected" value={counts.rejectedItems ?? store.rejectedItems.length} />
            <Metric label="Review events" value={counts.reviewEvents ?? store.reviewSessions.length} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Safer cleanup</CardTitle>
            <CardDescription>Start with cache cleanup. Cards are kept unless the action explicitly says otherwise.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void runAction("Clear debug/cache", clearDebugData)}>Clear debug/cache only</Button>
            <Button variant="outline" onClick={() => void runAction("Clear parsed documents", clearParsedTextKeepCards, true)}>Clear parsed documents, keep cards</Button>
            <Button variant="outline" onClick={() => void runAction("Clear uploaded files", clearUploadedFilesKeepCards, true)}>Clear uploaded files, keep cards</Button>
            <Button variant="destructive" onClick={() => void runAction("Delete current project", deleteCurrentProject, true)}>Delete current project</Button>
            <Button variant="destructive" onClick={() => void runAction("Reset all local data", resetAllLocalData, true)}>Reset all local data</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export and import</CardTitle>
            <CardDescription>Export cards before reset, or back up the full local project without source file blobs by default.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void downloadCards()}>Export active cards JSON</Button>
              <Button variant="outline" onClick={() => void downloadFullProject()}>Export full project JSON</Button>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeSourceFiles} onChange={(event) => setIncludeSourceFiles(event.target.checked)} />
              Include uploaded source files
            </label>
            <Textarea className="min-h-40" value={importJson} onChange={(event) => setImportJson(event.target.value)} placeholder="Paste full Rivision project JSON to import" />
            <Button onClick={() => void importProject()} disabled={!importJson.trim()}>Import project JSON</Button>
          </CardContent>
        </Card>
      </div>

      {status ? <p className="mt-4 text-sm text-slate-600">{status}</p> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg border p-3"><p className="text-slate-500">{label}</p><p className="font-semibold">{value}</p></div>;
}

function formatBytes(bytes: number | undefined) {
  if (typeof bytes !== "number") return "unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function downloadJson(filename: string, json: string) {
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
