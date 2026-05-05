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

const primaryModelOptions = [
  { value: "gpt-5.2", label: "GPT-5.2 · recommended" },
  { value: "gpt-5.2-pro", label: "GPT-5.2 pro · highest quality" },
  { value: "gpt-5", label: "GPT-5 · balanced" },
  { value: "gpt-5-mini", label: "GPT-5 mini · cheaper" },
  { value: "gpt-4.1", label: "GPT-4.1 · non-reasoning" },
];

const cheapModelOptions = [
  { value: "gpt-5-mini", label: "GPT-5 mini · recommended" },
  { value: "gpt-5-nano", label: "GPT-5 nano · cheapest" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini · long context" },
];

function modelSelectValue(value: string, options: Array<{ value: string }>) {
  return options.some((option) => option.value === value) ? value : "";
}

function normalizeModelSettings(settings: LlmPipelineSettings): LlmPipelineSettings {
  return {
    ...settings,
    primaryModel: modelSelectValue(settings.primaryModel, primaryModelOptions) || defaultLlmPipelineSettings.primaryModel,
    cheapModel: modelSelectValue(settings.cheapModel, cheapModelOptions) || defaultLlmPipelineSettings.cheapModel,
  };
}

export default function SettingsPage() {
  const store = useStudyStore();
  const [json, setJson] = useState("");
  const [llm, setLlm] = useState<LlmPipelineSettings>(() => normalizeModelSettings(loadLlmPipelineSettings() ?? defaultLlmPipelineSettings));
  const [relevance, setRelevance] = useState<RelevanceSettings>(() => loadRelevanceSettings() ?? defaultRelevanceSettings);
  const [storageSettings, setStorageSettings] = useState<StorageSettings>(() => loadStorageSettings());
  const [openaiConfigured, setOpenaiConfigured] = useState<boolean | null>(null);
  const [apiKeySaved, setApiKeySaved] = useState(false);

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
    <div className="space-y-8">
      <PageHeader title="Settings" description="Tune how Rivision studies with your materials. Advanced tools stay hidden until you need them." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-blue-100 bg-blue-50/30 lg:col-span-2">
          <CardHeader>
            <CardTitle>Revision preferences</CardTitle>
            <CardDescription>These shape local pack generation and practice emphasis. No API required.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1 text-sm font-medium">
              Revision style
              <Select
                value={storageSettings.revisionStyle}
                onChange={(event) =>
                  setStorageSettings((current) => ({ ...current, revisionStyle: event.target.value as StorageSettings["revisionStyle"] }))
                }
              >
                <option value="concise_exam">Concise exam pack</option>
                <option value="detailed_guide">Detailed study guide</option>
                <option value="flashcard_heavy">Flashcard-heavy</option>
                <option value="problem_heavy">Problem-solving-heavy</option>
              </Select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Breadth (strictness)
              <Select
                value={storageSettings.aiStrictness}
                onChange={(event) =>
                  setStorageSettings((current) => ({ ...current, aiStrictness: event.target.value as StorageSettings["aiStrictness"] }))
                }
              >
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="broad">Broad</option>
              </Select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Math formatting
              <Select
                value={storageSettings.mathFormatting}
                onChange={(event) =>
                  setStorageSettings((current) => ({ ...current, mathFormatting: event.target.value as StorageSettings["mathFormatting"] }))
                }
              >
                <option value="auto_clean">Auto-clean LaTeX</option>
                <option value="flag_broken">Flag broken formulas</option>
              </Select>
            </label>
            <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={storageSettings.developerMode}
                  onChange={(event) => setStorageSettings((current) => ({ ...current, developerMode: event.target.checked }))}
                />
                Developer mode (show internal extraction and debug controls)
              </label>
              <Button onClick={() => saveStorageSettings(storageSettings)}>Save preferences</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data &amp; backup</CardTitle>
            <CardDescription>Export cards or clear local storage.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea className="min-h-24" value={json} onChange={(e) => setJson(e.target.value)} placeholder="Paste exported card JSON" />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setJson(exportRevisionItems(store.revisionItems))}>Export cards JSON</Button>
              <Button onClick={() => { store.setRevisionItems(importRevisionItems(json)); setJson(""); }} disabled={!json.trim()}>Import JSON</Button>
              <Link className="inline-flex h-10 items-center justify-center rounded-md border border-slate-300 bg-white px-4 text-sm font-medium hover:bg-slate-50" href="/settings/storage">
                Storage &amp; recovery
              </Link>
            </div>
            <Button variant="destructive" onClick={() => { store.resetAll(); window.location.reload(); }}>Reset local data</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Interface</CardTitle>
            <CardDescription>Legacy simple/advanced toggle — prefer Developer mode above.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm font-medium">
              Display density
              <Select
                value={storageSettings.interfaceMode}
                onChange={(event) =>
                  setStorageSettings((current) => ({ ...current, interfaceMode: event.target.value as StorageSettings["interfaceMode"] }))
                }
              >
                <option value="simple">Simple</option>
                <option value="advanced">Advanced layout (legacy)</option>
              </Select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={storageSettings.persistDebugData}
                onChange={(event) => setStorageSettings((current) => ({ ...current, persistDebugData: event.target.checked }))}
              />
              Persist debug segmentation data (IndexedDB)
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={storageSettings.uploadReplacePack}
                onChange={(event) => setStorageSettings((current) => ({ ...current, uploadReplacePack: event.target.checked }))}
              />
              Replace current pack on upload (default)
            </label>
            <Button variant="outline" onClick={() => saveStorageSettings(storageSettings)}>Save interface options</Button>
          </CardContent>
        </Card>

        <Card className="border-emerald-100 bg-emerald-50/30 lg:col-span-2">
          <CardHeader>
            <CardTitle>OpenAI extraction</CardTitle>
            <CardDescription>Paste your API key here to use AI extraction from the upload flow. The key stays in this browser and is sent only to Rivision API routes when you run extraction.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm font-medium">
              API key
              <Input
                type="password"
                autoComplete="off"
                value={llm.openaiApiKey ?? ""}
                onChange={(event) => {
                  setApiKeySaved(false);
                  setLlm((current) => ({ ...current, openaiApiKey: event.target.value }));
                }}
                placeholder="sk-..."
              />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">
                Primary model
                <Select
                  value={modelSelectValue(llm.primaryModel, primaryModelOptions)}
                  onChange={(event) => setLlm((current) => ({ ...current, primaryModel: event.target.value }))}
                >
                  {!modelSelectValue(llm.primaryModel, primaryModelOptions) ? <option value="">{llm.primaryModel || "Choose a model"}</option> : null}
                  {primaryModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1 text-sm font-medium">
                Cheaper scan model
                <Select
                  value={modelSelectValue(llm.cheapModel, cheapModelOptions)}
                  onChange={(event) => setLlm((current) => ({ ...current, cheapModel: event.target.value }))}
                >
                  {!modelSelectValue(llm.cheapModel, cheapModelOptions) ? <option value="">{llm.cheapModel || "Choose a model"}</option> : null}
                  {cheapModelOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  const next = { ...llm, mode: "openai_api" as const, openaiApiKey: llm.openaiApiKey?.trim() || undefined };
                  setLlm(next);
                  saveLlmPipelineSettings(next);
                  setApiKeySaved(true);
                }}
              >
                Save key and use API extraction
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const next = { ...llm, mode: "local_rules_only" as const, openaiApiKey: undefined };
                  setLlm(next);
                  saveLlmPipelineSettings(next);
                  setApiKeySaved(true);
                }}
              >
                Clear key
              </Button>
            </div>
            <p className="text-xs text-slate-600">
              Status: {llm.openaiApiKey?.trim() ? "browser key saved for extraction" : openaiConfigured ? "server OPENAI_API_KEY available" : "no key yet"}
              {apiKeySaved ? " · saved" : ""}
            </p>
          </CardContent>
        </Card>
      </div>

      {storageSettings.developerMode ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Extraction pipeline</CardTitle>
              <CardDescription>Optional OpenAI routes — app works without keys via local heuristics.</CardDescription>
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
                    <Select
                      value={modelSelectValue(llm.primaryModel, primaryModelOptions)}
                      onChange={(event) => setLlm((current) => ({ ...current, primaryModel: event.target.value }))}
                    >
                      {!modelSelectValue(llm.primaryModel, primaryModelOptions) ? <option value="">{llm.primaryModel || "Choose a model"}</option> : null}
                      {primaryModelOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    Cheaper scan model
                    <Select
                      value={modelSelectValue(llm.cheapModel, cheapModelOptions)}
                      onChange={(event) => setLlm((current) => ({ ...current, cheapModel: event.target.value }))}
                    >
                      {!modelSelectValue(llm.cheapModel, cheapModelOptions) ? <option value="">{llm.cheapModel || "Choose a model"}</option> : null}
                      {cheapModelOptions.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </Select>
                  </label>
                </>
              ) : null}
              <Button onClick={() => saveLlmPipelineSettings(llm)}>Save pipeline settings</Button>
              <p className="text-xs text-slate-500">
                API status:{" "}
                {llm.openaiApiKey?.trim() ?
                  "Browser API key will be used for extraction."
                : openaiConfigured === null ? "Checking…"
                : openaiConfigured ? "OPENAI_API_KEY detected on server."
                : "No OpenAI key yet — local heuristics only."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Review filtering</CardTitle>
              <CardDescription>Fine-grained control over low-relevance cards.</CardDescription>
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
              <Button variant="outline" onClick={() => saveRelevanceSettings(relevance)}>Save review filtering</Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Internal extraction prompt</CardTitle>
              <CardDescription>Read-only snapshot used when API extraction is enabled.</CardDescription>
            </CardHeader>
            <CardContent>
              <details className="rounded-lg border border-slate-200 bg-slate-50">
                <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Show prompt</summary>
                <pre className="max-h-[24rem] overflow-auto whitespace-pre-wrap border-t border-slate-200 p-4 text-xs">{getLlmExtractionPrompt()}</pre>
              </details>
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Advanced routes</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2 text-sm">
              <Link className="text-blue-700 underline" href="/extract">Extract (legacy debug)</Link>
              <Link className="text-blue-700 underline" href="/cards">Cards editor (legacy)</Link>
              <Link className="text-blue-700 underline" href="/debug/smoke-test">Run sample smoke test</Link>
              <Link className="text-blue-700 underline" href="/debug/course-builder">Course builder fixture</Link>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
