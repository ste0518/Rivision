"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { loadLlmPipelineSettings, saveLlmPipelineSettings } from "@/lib/extraction";
import { defaultLlmPipelineSettings, type LlmPipelineSettings } from "@/lib/llm/provider";
import { exportRevisionItems, importRevisionItems, loadStorageSettings, saveStorageSettings, type StorageSettings } from "@/lib/storage";
import { useStudyStore } from "@/hooks/use-study-store";

const primaryModelOptions = [
  { value: "gpt-5-mini", label: "GPT-5 mini · safest for new keys" },
  { value: "gpt-5.5", label: "GPT-5.5 · highest quality if available" },
  { value: "gpt-5.2", label: "GPT-5.2 · strong if available" },
  { value: "gpt-5", label: "GPT-5 · fallback" },
  { value: "gpt-4.1", label: "GPT-4.1 · long context fallback" },
];

const cheapModelOptions = [
  { value: "gpt-5-mini", label: "GPT-5 mini · recommended" },
  { value: "gpt-5-nano", label: "GPT-5 nano · cheapest" },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini · long context" },
];

const reasoningOptions: Array<{ value: NonNullable<LlmPipelineSettings["reasoningEffort"]>; label: string }> = [
  { value: "low", label: "Fast · lower cost" },
  { value: "medium", label: "Balanced · recommended on Vercel" },
  { value: "high", label: "Exam extraction · slower" },
  { value: "xhigh", label: "Maximum checking · slower" },
];

function modelSelectValue(value: string, options: Array<{ value: string }>) {
  return options.some((option) => option.value === value) ? value : "";
}

function normalizeModelSettings(settings: LlmPipelineSettings): LlmPipelineSettings {
  return {
    ...settings,
    primaryModel: modelSelectValue(settings.primaryModel, primaryModelOptions) || defaultLlmPipelineSettings.primaryModel,
    cheapModel: modelSelectValue(settings.cheapModel, cheapModelOptions) || defaultLlmPipelineSettings.cheapModel,
    reasoningEffort: reasoningOptions.some((option) => option.value === settings.reasoningEffort)
      ? settings.reasoningEffort
      : defaultLlmPipelineSettings.reasoningEffort,
  };
}

export default function SettingsPage() {
  const store = useStudyStore();
  const [json, setJson] = useState("");
  const [llm, setLlm] = useState<LlmPipelineSettings>(() => normalizeModelSettings(loadLlmPipelineSettings() ?? defaultLlmPipelineSettings));
  const [storageSettings, setStorageSettings] = useState<StorageSettings>(() => loadStorageSettings());
  const [serverKeyReady, setServerKeyReady] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [apiTestStatus, setApiTestStatus] = useState("");
  const [apiTesting, setApiTesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings-status")
      .then((res) => res.json() as Promise<{ openaiConfigured?: boolean }>)
      .then((body) => {
        if (!cancelled) setServerKeyReady(Boolean(body.openaiConfigured));
      })
      .catch(() => {
        if (!cancelled) setServerKeyReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader title="Settings" description="Set up API extraction and tune the exam pack you want Rivision to build." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-emerald-100 bg-emerald-50/30 lg:col-span-2">
          <CardHeader>
            <CardTitle>OpenAI extraction</CardTitle>
            <CardDescription>
              Add OPENAI_API_KEY in Vercel environment variables. Rivision does not store or send OpenAI keys from the browser.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {serverKeyReady ? (
              <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-950">
                Vercel API key is configured. Extraction jobs can call OpenAI from the server.
              </p>
            ) : (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                OPENAI_API_KEY is not configured in this deployment yet. Add it in Vercel Project Settings, then redeploy or refresh environment variables.
              </p>
            )}
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
              <label className="space-y-1 text-sm font-medium">
                Extraction quality
                <Select
                  value={llm.reasoningEffort ?? defaultLlmPipelineSettings.reasoningEffort}
                  onChange={(event) => setLlm((current) => ({ ...current, reasoningEffort: event.target.value as LlmPipelineSettings["reasoningEffort"] }))}
                >
                  {reasoningOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
              </label>
              <label className="flex items-center gap-2 self-end rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={Boolean(llm.verifyExtraction)}
                  onChange={(event) => setLlm((current) => ({ ...current, verifyExtraction: event.target.checked }))}
                />
                Extra verification pass
              </label>
            </div>
            <p className="text-xs text-slate-600">
              Leave extra verification off on Vercel for large PDFs; it adds a second model call and can cause timeouts.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  const next = { ...llm, mode: "openai_api" as const, openaiApiKey: undefined };
                  setLlm(next);
                  saveLlmPipelineSettings(next);
                  saveStorageSettings({ ...storageSettings, developerMode: false, persistDebugData: false, interfaceMode: "simple" });
                  setApiKeySaved(true);
                }}
              >
                Save extraction settings
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={apiTesting}
                onClick={() => void testOpenAiConnection()}
              >
                {apiTesting ? "Testing…" : "Test API"}
              </Button>
            </div>
            <p className="text-xs text-slate-600">
              Status: {serverKeyReady ? "Vercel key ready" : "server key missing"}
              {apiKeySaved ? " · saved" : ""}
            </p>
            {apiTestStatus ? <p className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">{apiTestStatus}</p> : null}
          </CardContent>
        </Card>

        <Card className="border-blue-100 bg-blue-50/30">
          <CardHeader>
            <CardTitle>Exam pack preferences</CardTitle>
            <CardDescription>These guide the shape and density of the generated pack.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <label className="space-y-1 text-sm font-medium">
              Revision style
              <Select
                value={storageSettings.revisionStyle}
                onChange={(event) => setStorageSettings((current) => ({ ...current, revisionStyle: event.target.value as StorageSettings["revisionStyle"] }))}
              >
                <option value="concise_exam">Concise exam pack</option>
                <option value="detailed_guide">Detailed study guide</option>
                <option value="flashcard_heavy">Flashcard-heavy</option>
                <option value="problem_heavy">Problem-solving-heavy</option>
              </Select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Breadth
              <Select
                value={storageSettings.aiStrictness}
                onChange={(event) => setStorageSettings((current) => ({ ...current, aiStrictness: event.target.value as StorageSettings["aiStrictness"] }))}
              >
                <option value="conservative">Conservative</option>
                <option value="balanced">Balanced</option>
                <option value="broad">Broad</option>
              </Select>
            </label>
            <Button onClick={() => saveStorageSettings({ ...storageSettings, developerMode: false, persistDebugData: false, interfaceMode: "simple" })}>Save preferences</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Data &amp; backup</CardTitle>
            <CardDescription>Export cards or clear local data from this browser.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea className="min-h-24" value={json} onChange={(e) => setJson(e.target.value)} placeholder="Paste exported card JSON" />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setJson(exportRevisionItems(store.revisionItems))}>Export cards JSON</Button>
              <Button onClick={() => { store.setRevisionItems(importRevisionItems(json)); setJson(""); }} disabled={!json.trim()}>Import JSON</Button>
            </div>
            <Button variant="destructive" onClick={() => { store.resetAll(); window.location.reload(); }}>Reset local data</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );

  async function testOpenAiConnection() {
    setApiTesting(true);
    setApiTestStatus("");
    try {
      const response = await fetch("/api/openai-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: llm.primaryModel }),
      });
      const payload = (await response.json()) as { ok?: boolean; model?: string; error?: string };
      if (!response.ok || !payload.ok) {
        setApiTestStatus(payload.error || "API test failed.");
        return;
      }
      setApiTestStatus(`API key works with ${payload.model ?? llm.primaryModel}.`);
    } catch {
      setApiTestStatus("Could not reach the API test route. Try again after redeploying.");
    } finally {
      setApiTesting(false);
    }
  }
}
