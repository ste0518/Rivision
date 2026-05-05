"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cardPurposes, importances, revisionItemTypes, type RevisionItem } from "@/lib/types";
import { normalizeMathNotation } from "@/lib/revision-item-utils";
import { createId } from "@/lib/utils";

export function CardForm({
  item,
  onSave,
  onCancel,
  onDelete,
  onRestore,
}: {
  item?: RevisionItem;
  onSave: (item: RevisionItem) => void;
  onCancel: () => void;
  onDelete?: () => void;
  onRestore?: () => void;
}) {
  const now = new Date().toISOString();
  const [draft, setDraft] = useState<RevisionItem>(item ?? { id: createId("card"), type: "definition", title: "", conceptName: "", displayTitle: "", cardFront: "", taskPrompt: "Recall the exact definition.", cardPurpose: "definition_recall", statement: "", sourceFile: "Manual entry", sourceLocation: "source unknown", tags: [], importance: "unknown", curationStatus: "kept", questionPrompt: "", answer: "", priorityScore: 0, priorityLabel: "unknown", evidenceSignals: [], whyThisCardMatters: "Manual card.", createdAt: now, updatedAt: now, reviewCount: 0 });
  const [mathStatus, setMathStatus] = useState("");
  const update = <K extends keyof RevisionItem>(key: K, value: RevisionItem[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function aiCleanMath() {
    setMathStatus("");
    const response = await fetch("/api/ai-clean-math", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: draft.statement }),
    });
    const payload = (await response.json()) as { markdown?: string; error?: string; issues?: string[]; latexQuality?: RevisionItem["latexQuality"] };
    if (!response.ok || !payload.markdown) {
      setMathStatus(payload.error || "AI math cleanup failed.");
      return;
    }
    setDraft((current) => ({
      ...current,
      statementLatex: payload.markdown,
      latexQuality: payload.latexQuality ?? (payload.issues?.length ? "low" : "high"),
      warnings: [...(current.warnings ?? []), ...(payload.issues ?? [])],
    }));
    setMathStatus(payload.issues?.length ? "AI cleaned math, but KaTeX still reported issues." : "AI cleaned math.");
  }

  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, tags: draft.tags.map((tag) => tag.trim()).filter(Boolean) }); }}>
    <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm font-medium">Title<Input value={draft.title} onChange={(e) => update("title", e.target.value)} required /></label><label className="space-y-1 text-sm font-medium">Type<Select value={draft.type} onChange={(e) => update("type", e.target.value as RevisionItem["type"])}>{revisionItemTypes.map((type) => <option key={type} value={type}>{type}</option>)}</Select></label><label className="space-y-1 text-sm font-medium">Card purpose<Select value={draft.cardPurpose} onChange={(e) => update("cardPurpose", e.target.value as RevisionItem["cardPurpose"])}>{cardPurposes.map((purpose) => <option key={purpose} value={purpose}>{purpose}</option>)}</Select></label><label className="space-y-1 text-sm font-medium">Importance<Select value={draft.importance} onChange={(e) => update("importance", e.target.value as RevisionItem["importance"])}>{importances.map((importance) => <option key={importance}>{importance}</option>)}</Select></label><label className="space-y-1 text-sm font-medium">Source location<Input value={draft.sourceLocation ?? ""} onChange={(e) => update("sourceLocation", e.target.value)} /></label><label className="space-y-1 text-sm font-medium">Curation decision<Select value={draft.curationDecision ?? "keep"} onChange={(e) => update("curationDecision", e.target.value as RevisionItem["curationDecision"])}><option value="keep">keep</option><option value="needs_review">needs_review</option><option value="reject">reject</option></Select></label></div>
    <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm font-medium">Concept name<Input value={draft.conceptName ?? ""} onChange={(e) => update("conceptName", e.target.value)} /></label><label className="space-y-1 text-sm font-medium">Display title<Input value={draft.displayTitle ?? ""} onChange={(e) => update("displayTitle", e.target.value)} /></label><label className="space-y-1 text-sm font-medium">Card front<Input value={draft.cardFront} onChange={(e) => update("cardFront", e.target.value)} required /></label><label className="space-y-1 text-sm font-medium">Task prompt<Input value={draft.taskPrompt ?? ""} onChange={(e) => update("taskPrompt", e.target.value)} /></label></div>
    <label className="space-y-1 text-sm font-medium">Tags<Input value={draft.tags.join(", ")} onChange={(e) => update("tags", e.target.value.split(","))} placeholder="stationarity, covariance" /></label>
    <label className="space-y-1 text-sm font-medium">Statement<Textarea value={draft.statement} onChange={(e) => update("statement", e.target.value)} /></label>
    <label className="space-y-1 text-sm font-medium">Statement LaTeX<Textarea value={draft.statementLatex ?? ""} onChange={(e) => update("statementLatex", e.target.value)} /></label>
    {draft.type !== "definition" ? <label className="space-y-1 text-sm font-medium">Proof<Textarea value={draft.proof ?? ""} onChange={(e) => update("proof", e.target.value)} /></label> : null}
    {draft.type !== "definition" ? <label className="space-y-1 text-sm font-medium">Proof LaTeX<Textarea value={draft.proofLatex ?? ""} onChange={(e) => update("proofLatex", e.target.value)} /></label> : null}
    <label className="space-y-1 text-sm font-medium">Question prompt<Input value={draft.questionPrompt} onChange={(e) => update("questionPrompt", e.target.value)} required /></label>
    <label className="space-y-1 text-sm font-medium">Answer<Textarea value={draft.answer} onChange={(e) => update("answer", e.target.value)} required /></label>
    <label className="space-y-1 text-sm font-medium">Answer LaTeX<Textarea value={draft.answerLatex ?? ""} onChange={(e) => update("answerLatex", e.target.value)} /></label>
    <label className="space-y-1 text-sm font-medium">Extraction warning<Input value={draft.extractionWarning ?? ""} onChange={(e) => update("extractionWarning", e.target.value)} /></label>
    <label className="space-y-1 text-sm font-medium">Guidance reason<Textarea value={draft.guidanceReason ?? ""} onChange={(e) => update("guidanceReason", e.target.value)} /></label>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={() => setDraft((current) => ({ ...current, statementLatex: normalizeMathNotation(current.statement), answerLatex: normalizeMathNotation(current.answer), proofLatex: current.proof ? normalizeMathNotation(current.proof) : undefined }))}>Fix math</Button>
      <Button type="button" variant="outline" onClick={() => void aiCleanMath()}>AI clean math</Button>
    </div>
    {mathStatus ? <p className="text-sm text-slate-600">{mathStatus}</p> : null}
    <div className="flex flex-wrap justify-between gap-2">
      <div className="flex gap-2">
        {onDelete ? <Button type="button" variant="destructive" onClick={onDelete}>Delete</Button> : null}
        {onRestore ? <Button type="button" variant="outline" onClick={onRestore}>Restore</Button> : null}
      </div>
      <div className="flex gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit">Save card</Button></div>
    </div>
  </form>;
}
