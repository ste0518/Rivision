"use client";

import { useState } from "react";
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
import Link from "next/link";

export default function SettingsPage() {
  const store = useStudyStore();
  const [json, setJson] = useState("");
  const [llm, setLlm] = useState<LlmPipelineSettings>(() => loadLlmPipelineSettings() ?? defaultLlmPipelineSettings);
  const [relevance, setRelevance] = useState<RelevanceSettings>(() => loadRelevanceSettings() ?? defaultRelevanceSettings);
  const [storageSettings, setStorageSettings] = useState<StorageSettings>(() => loadStorageSettings());

  return (
    <div>
      <PageHeader title="Settings and portability" description="Keep the app local-first: export corrected cards, import JSON later, or reset local browser data." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Extraction mode</CardTitle>
            <CardDescription>Choose AI key revision analysis, local rules, manual JSON import, or OpenAI API extraction.</CardDescription>
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
            <p className="text-xs text-slate-500">Only OpenAI modes require OPENAI_API_KEY. Local rules and manual JSON import work without paid API usage.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Review filtering</CardTitle>
            <CardDescription>Control how conservative extraction is about weak unknown cards.</CardDescription>
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
            <p className="text-xs text-slate-500">Default is off. Low-value unknown items are sent to Rejected / low relevance instead.</p>
            <Button onClick={() => saveRelevanceSettings(relevance)}>Save review filtering</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>JSON import/export</CardTitle>
            <CardDescription>Use this to reuse manually corrected cards. Full project exports and safer reset options live in Storage manager.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea className="min-h-48" value={json} onChange={(e) => setJson(e.target.value)} placeholder="Paste or generate RevisionItem[] JSON" />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setJson(exportRevisionItems(store.revisionItems))}>Generate export JSON</Button>
              <Button onClick={() => { store.setRevisionItems(importRevisionItems(json)); setJson(""); }} disabled={!json.trim()}>Import JSON</Button>
              <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50" href="/settings/storage">Open storage manager</Link>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Debug persistence</CardTitle>
            <CardDescription>Debug views stay in memory by default so large prompts, previews, and diagnostics do not fill browser storage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={storageSettings.persistDebugData}
                onChange={(event) => setStorageSettings((current) => ({ ...current, persistDebugData: event.target.checked }))}
              />
              Persist debug data
            </label>
            <p className="text-xs text-slate-500">Default is off. When off, extraction diagnostics are rendered from memory and not written to persistent localStorage.</p>
            <Button onClick={() => saveStorageSettings(storageSettings)}>Save storage settings</Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Internal extraction prompt</CardTitle>
            <CardDescription>Used by the OpenAI Responses API extraction pass.</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded-lg bg-slate-950 p-4 text-sm text-white">{getLlmExtractionPrompt()}</pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
