"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { getLlmExtractionPrompt, loadLlmPipelineSettings, saveLlmPipelineSettings } from "@/lib/extraction";
import { defaultLlmPipelineSettings, type LlmPipelineSettings } from "@/lib/llm/provider";
import { defaultRelevanceSettings, loadRelevanceSettings, saveRelevanceSettings, type RelevanceSettings } from "@/lib/relevance";
import { exportRevisionItems, importRevisionItems, loadStorageSettings, saveStorageSettings, type StorageSettings } from "@/lib/storage";
import { useStudyStore } from "@/hooks/use-study-store";

export default function SettingsPage() {
  const store = useStudyStore();
  const [json, setJson] = useState("");
  const [llm, setLlm] = useState<LlmPipelineSettings>(() => loadLlmPipelineSettings() ?? defaultLlmPipelineSettings);
  const [relevance, setRelevance] = useState<RelevanceSettings>(() => loadRelevanceSettings() ?? defaultRelevanceSettings);
  const [storageSettings, setStorageSettings] = useState<StorageSettings>(() => loadStorageSettings());
  const [openaiConfigured, setOpenaiConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings-status")
      .then((res) => res.json() as Promise<{ openaiConfigured?: boolean }>)
      .then((body) => {
        if (!cancelled) setOpenaiConfigured(Boolean(body.openaiConfigured));
      })
      .catch(() => {
        if (!cancelled) setOpenaiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <PageHeader title="Settings" description="Extraction mode, review behaviour, exports, and advanced debugging." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Extraction mode</CardTitle>
            <CardDescription>Choose AI-assisted analysis, local rules, or manual JSON import.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm font-medium">
              Pipeline mode
              <Select value={llm.mode} onChange={(event) => setLlm((current) => ({ ...current, mode: event.target.value as LlmPipelineSettings["mode"] }))}>
                <option value="ai_key_revision_analysis">AI key revision analysis</option>
                <option value="local_rules_only">Local rules only</option>
                <option value="manual_json_import">Manual JSON import</option>
                <option value="openai_api">OpenAI API extraction</option>
                <option value="cheap_scan_then_verify">OpenAI cheap scan then verify</option>
              </Select>
            </label>

            {(llm.mode === "ai_key_revision_analysis" || llm.mode === "openai_api" || llm.mode === "cheap_scan_then_verify") ? (
              <>
                <label className="space-y-1 text-sm font-medium">
                  Primary model
                  <Input value={llm.primaryModel} onChange={(event) => setLlm((current) => ({ ...current, primaryModel: event.target.value }))} />
                </label>
                <label className="space-y-1 text-sm font-medium">
                  Cheaper scan model
                  <Input value={llm.cheapModel} onChange={(event) => setLlm((current) => ({ ...current, cheapModel: event.target.value }))} />
                </label>
              </>
            ) : null}
            <Button onClick={() => saveLlmPipelineSettings(llm)}>Save LLM settings</Button>
            <p className="text-xs text-slate-500">
              API status:{" "}
              {openaiConfigured === null ? "Checking…" : openaiConfigured ? "OPENAI_API_KEY detected on server." : "No OPENAI_API_KEY on server — AI modes fall back to local heuristics."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review filtering</CardTitle>
            <CardDescription>How conservative the app is about weak unknown cards.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={relevance.showUnknownLowRelevanceInReview}
                onChange={(event) => setRelevance((current) => ({ ...current, showUnknownLowRelevanceInReview: event.target.checked }))}
              />
              Show unknown low-relevance cards in review
            </label>
            <p className="text-xs text-slate-500">Default is off. Low-value unknown items go to Rejected instead.</p>
            <Button onClick={() => saveRelevanceSettings(relevance)}>Save review filtering</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Interface</CardTitle>
            <CardDescription>Simple mode hides parser diagnostics and raw candidates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm font-medium">
              Mode
              <Select value={storageSettings.interfaceMode} onChange={(event) => setStorageSettings((current) => ({ ...current, interfaceMode: event.target.value as StorageSettings["interfaceMode"] }))}>
                <option value="simple">Simple revision mode</option>
                <option value="advanced">Advanced debug mode</option>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={storageSettings.persistDebugData}
                onChange={(event) => setStorageSettings((current) => ({ ...current, persistDebugData: event.target.checked }))}
              />
              Persist debug data
            </label>
            <Button onClick={() => saveStorageSettings(storageSettings)}>Save interface settings</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Export / import / storage</CardTitle>
            <CardDescription>Move cards between browsers or free space.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea className="min-h-32" value={json} onChange={(e) => setJson(e.target.value)} placeholder="Paste RevisionItem[] JSON" />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setJson(exportRevisionItems(store.revisionItems))}>Generate export JSON</Button>
              <Button onClick={() => { store.setRevisionItems(importRevisionItems(json)); setJson(""); }} disabled={!json.trim()}>Import JSON</Button>
              <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50" href="/settings/storage">Storage manager</Link>
            </div>
            <Button variant="destructive" onClick={() => { store.resetAll(); window.location.reload(); }}>Reset local data</Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Advanced</CardTitle>
            <CardDescription>Internal prompts and debugging — optional.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <details className="rounded-lg border border-slate-200 bg-slate-50">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-900">Prompt editor (internal extraction prompt)</summary>
              <div className="border-t border-slate-200 p-4">
                <p className="mb-3 text-xs text-slate-500">Read-only snapshot of the OpenAI extraction system prompt used by the API route.</p>
                <pre className="max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-sm text-white">{getLlmExtractionPrompt()}</pre>
              </div>
            </details>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
