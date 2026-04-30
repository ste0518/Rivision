"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/page-header";
import { extractRevisionItems, generateManualExtractionPrompt, loadLlmPipelineSettings } from "@/lib/extraction";
import { validateRevisionItemsPayload, withValidation } from "@/lib/validation";
import { useStudyStore } from "@/hooks/use-study-store";

export default function ExtractPage() {
  const store = useStudyStore();
  const [extracting, setExtracting] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [manualJson, setManualJson] = useState("");
  const [manualErrors, setManualErrors] = useState<string[]>([]);

  const settings = loadLlmPipelineSettings();
  const notesText = useMemo(() => store.notesFiles.map((file) => file.content).join("\n\n"), [store.notesFiles]);
  const guidanceText = useMemo(() => store.guidanceFiles.map((file) => file.content).join("\n\n"), [store.guidanceFiles]);
  const sourceFile = useMemo(() => store.notesFiles.map((file) => file.name).join(", ") || "Mock notes", [store.notesFiles]);

  async function runExtraction() {
    setExtracting(true);
    setStatus("");

    if (settings.mode === "manual_json_import") {
      setStatus("Manual JSON import mode is enabled. Paste JSON below and validate/import it.");
      setExtracting(false);
      return;
    }

    const items = await extractRevisionItems({ notesText, guidanceText, sourceFile });
    store.setRevisionItems(items);

    if (settings.mode === "openai_api" || settings.mode === "cheap_scan_then_verify") {
      if (items.length === 0) {
        setStatus("OpenAI extraction unavailable (likely missing API key). Falling back to local mode is recommended.");
      } else {
        setStatus("Extraction complete via OpenAI pipeline.");
      }
    } else {
      setStatus("Extraction complete via local deterministic rules.");
    }

    setExtracting(false);
  }

  function handleManualImport() {
    try {
      const parsed = JSON.parse(manualJson) as unknown;
      const result = validateRevisionItemsPayload(parsed);
      setManualErrors(result.errors);
      if (result.errors.length > 0) return;
      store.setRevisionItems(result.items.map(withValidation));
      setStatus(`Imported ${result.items.length} card(s) from manual JSON.`);
    } catch {
      setManualErrors(["JSON parse error. Please provide valid JSON array."]);
    }
  }

  async function handlePromptCopy() {
    const prompt = generateManualExtractionPrompt({ notesText, guidanceText, sourceFile });
    await navigator.clipboard.writeText(prompt);
    setStatus("Manual extraction prompt copied. Paste it into ChatGPT/Codex with your notes.");
  }

  function onManualFileUpload(file: File | null) {
    if (!file) return;
    file.text().then((text) => setManualJson(text));
  }

  return (
    <div>
      <PageHeader
        title="Extract revision cards"
        description="Use local rules, manual JSON import, or OpenAI API extraction. The app never blocks entirely if API key is missing."
      />

      <Card>
        <CardHeader>
          <CardTitle>Extraction inputs</CardTitle>
          <CardDescription>
            {store.notesFiles.length} notes file(s), {store.guidanceFiles.length} guidance file(s) · mode: <code>{settings.mode}</code>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button size="lg" onClick={runExtraction} disabled={extracting}>
              {extracting ? "Extracting..." : "Run extraction"}
            </Button>
            <Button variant="outline" onClick={handlePromptCopy}>Generate manual ChatGPT prompt</Button>
          </div>
          {status ? <p className="text-sm text-blue-700">{status}</p> : null}
          {(settings.mode === "openai_api" || settings.mode === "cheap_scan_then_verify") ? (
            <p className="text-sm text-slate-500">If OPENAI_API_KEY is missing, the app will not crash. Switch to local rules or manual JSON import in <Link className="underline" href="/settings">Settings</Link>.</p>
          ) : (
            <p className="text-sm text-slate-500">No paid API key required in this mode.</p>
          )}
        </CardContent>
      </Card>

      {settings.mode === "manual_json_import" ? (
        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Manual JSON import</CardTitle>
            <CardDescription>Paste JSON from ChatGPT/Codex, or upload a JSON file, then validate and import.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input type="file" accept="application/json,.json" onChange={(event) => onManualFileUpload(event.target.files?.[0] ?? null)} />
            <Textarea value={manualJson} onChange={(event) => setManualJson(event.target.value)} className="min-h-56" placeholder="Paste RevisionItem[] JSON" />
            <Button onClick={handleManualImport} disabled={!manualJson.trim()}>Validate and import JSON</Button>
            {manualErrors.length > 0 ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {manualErrors.map((error) => <p key={error}>{error}</p>)}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {store.revisionItems.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="text-base">{item.title}</CardTitle>
                <Badge variant={item.importance}>{item.importance}</Badge>
              </div>
              <CardDescription>{item.type} · {item.sourceLocation || "source unknown"}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="line-clamp-3 text-sm text-slate-600">{item.questionPrompt}</p>
              {item.warnings?.length ? <Badge className="mt-3" variant="unknown">{item.warnings.length} warning(s)</Badge> : null}
            </CardContent>
          </Card>
        ))}
      </div>

      {store.revisionItems.length > 0 ? (
        <div className="mt-6">
          <Link className="inline-flex h-10 items-center justify-center rounded-md bg-blue-700 px-4 py-2 text-sm font-medium text-white hover:bg-blue-800" href="/cards">
            Review and edit cards
          </Link>
        </div>
      ) : null}
    </div>
  );
}
