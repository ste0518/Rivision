"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { importances, revisionItemTypes, type RevisionItem } from "@/lib/types";
import { createId } from "@/lib/utils";

export function CardForm({ item, onSave, onCancel }: { item?: RevisionItem; onSave: (item: RevisionItem) => void; onCancel: () => void }) {
  const now = new Date().toISOString();
  const [draft, setDraft] = useState<RevisionItem>(item ?? { id: createId("card"), type: "definition", title: "", statement: "", sourceFile: "Manual entry", sourceLocation: "source unknown", tags: [], importance: "unknown", questionPrompt: "", answer: "", createdAt: now, updatedAt: now, reviewCount: 0 });
  const update = <K extends keyof RevisionItem>(key: K, value: RevisionItem[K]) => setDraft((current) => ({ ...current, [key]: value }));

  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, tags: draft.tags.map((tag) => tag.trim()).filter(Boolean) }); }}>
    <div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm font-medium">Title<Input value={draft.title} onChange={(e) => update("title", e.target.value)} required /></label><label className="space-y-1 text-sm font-medium">Type<Select value={draft.type} onChange={(e) => update("type", e.target.value as RevisionItem["type"])}>{revisionItemTypes.map((type) => <option key={type} value={type}>{type}</option>)}</Select></label><label className="space-y-1 text-sm font-medium">Importance<Select value={draft.importance} onChange={(e) => update("importance", e.target.value as RevisionItem["importance"])}>{importances.map((importance) => <option key={importance} value={importance}>{importance}</option>)}</Select></label><label className="space-y-1 text-sm font-medium">Source location<Input value={draft.sourceLocation ?? ""} onChange={(e) => update("sourceLocation", e.target.value)} /></label></div>
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
    <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onCancel}>Cancel</Button><Button type="submit">Save card</Button></div>
  </form>;
}
