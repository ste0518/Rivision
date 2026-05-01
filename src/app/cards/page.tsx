"use client";

import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CardForm } from "@/components/card-form";
import { PageHeader } from "@/components/page-header";
import { MathMarkdown } from "@/components/MathMarkdown";
import { getPrimaryCardPreview, hasGenericConceptName, hasLowLatexQuality } from "@/lib/card-render";
import { normalizeMathNotation } from "@/lib/revision-item-utils";
import { exportRevisionItems, importRevisionItems } from "@/lib/storage";
import { cardPurposes, importances, revisionItemTypes, revisionPackCategories, type RevisionItem } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";

type UndoState = { message: string; itemIds: string[]; action: "delete" | "restore" } | null;

export default function CardsPage() {
  const store = useStudyStore();
  const [editing, setEditing] = useState<RevisionItem | undefined>();
  const [adding, setAdding] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [filters, setFilters] = useState({ type: "all", cardPurpose: "all", packCategory: "all", importance: "all", priority: "all", curation: "keep", standaloneValue: "all", lowLatexOnly: false, section: "", tag: "", source: "", showRejected: false, showDeleted: false });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedDeletedIds, setSelectedDeletedIds] = useState<string[]>([]);
  const [undo, setUndo] = useState<UndoState>(null);
  const [mathStatus, setMathStatus] = useState("");

  const activeCards = useMemo(() => store.revisionItems.filter((item) => !item.isDeleted), [store.revisionItems]);
  const deletedCards = useMemo(() => store.revisionItems.filter((item) => item.isDeleted), [store.revisionItems]);
  const filtered = useMemo(() => activeCards.filter((item) => matchesFilters(item, filters)), [activeCards, filters]);

  function downloadJson() {
    const blob = new Blob([exportRevisionItems(store.revisionItems)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rivision-cards.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function importJson() {
    try {
      store.setRevisionItems(importRevisionItems(importText));
      setImportText("");
      setImportError("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Could not import JSON.");
    }
  }

  function deleteCards(ids: string[]) {
    if (ids.length === 0) return;
    store.deleteRevisionItems(ids);
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
    setUndo({ message: ids.length === 1 ? "Card deleted" : `${ids.length} cards deleted`, itemIds: ids, action: "delete" });
  }

  function restoreCards(ids: string[]) {
    if (ids.length === 0) return;
    store.restoreRevisionItems(ids);
    setSelectedDeletedIds((current) => current.filter((id) => !ids.includes(id)));
    setUndo({ message: ids.length === 1 ? "Card restored" : `${ids.length} cards restored`, itemIds: ids, action: "restore" });
  }

  function fixMath(ids: string[]) {
    for (const id of ids) {
      const item = store.revisionItems.find((candidate) => candidate.id === id);
      if (!item) continue;
      store.upsertRevisionItem({
        ...item,
        statementLatex: normalizeMathNotation(item.statement || ""),
        answerLatex: normalizeMathNotation(item.answer || ""),
        proofLatex: item.proof ? normalizeMathNotation(item.proof) : undefined,
      });
    }
  }

  async function aiCleanMath(item: RevisionItem) {
    setMathStatus("");
    const response = await fetch("/api/ai-clean-math", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: item.statement }),
    });
    const payload = (await response.json()) as { markdown?: string; error?: string; issues?: string[]; latexQuality?: RevisionItem["latexQuality"] };
    if (!response.ok || !payload.markdown) {
      setMathStatus(payload.error || "AI math cleanup failed.");
      return;
    }
    store.upsertRevisionItem({
      ...item,
      statementLatex: payload.markdown,
      latexQuality: payload.latexQuality ?? (payload.issues?.length ? "low" : "high"),
      warnings: [...(item.warnings ?? []), ...(payload.issues ?? [])],
      updatedAt: new Date().toISOString(),
    });
    setMathStatus(payload.issues?.length ? "AI cleaned math, but KaTeX still reported issues." : "AI cleaned math.");
  }

  function handleUndo() {
    if (!undo) return;
    if (undo.action === "delete") store.restoreRevisionItems(undo.itemIds);
    if (undo.action === "restore") store.deleteRevisionItems(undo.itemIds);
    setUndo(null);
  }

  const allVisibleSelected = filtered.length > 0 && filtered.every((item) => selectedIds.includes(item.id));
  const allDeletedSelected = deletedCards.length > 0 && deletedCards.every((item) => selectedDeletedIds.includes(item.id));

  return (
    <div>
      <PageHeader title="Review and edit cards" description="Filter extracted items, correct prompts and answers, delete false positives, or add manual cards." />

      {undo ? <UndoBanner message={undo.message} onUndo={handleUndo} onDismiss={() => setUndo(null)} /> : null}

      <Card className="mb-6">
        <CardContent className="grid gap-3 pt-6 md:grid-cols-6">
          <Select value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
            <option value="all">All types</option>
            {revisionItemTypes.map((type) => <option key={type}>{type}</option>)}
          </Select>
          <Select value={filters.cardPurpose} onChange={(event) => setFilters({ ...filters, cardPurpose: event.target.value })}>
            <option value="all">All purposes</option>
            {cardPurposes.map((purpose) => <option key={purpose}>{purpose}</option>)}
          </Select>
          <Select value={filters.packCategory} onChange={(event) => setFilters({ ...filters, packCategory: event.target.value })}>
            <option value="all">All pack categories</option>
            {revisionPackCategories.map((category) => <option key={category} value={category}>{category}</option>)}
          </Select>
          <Select value={filters.importance} onChange={(event) => setFilters({ ...filters, importance: event.target.value })}>
            <option value="all">All importance</option>
            {importances.map((importance) => <option key={importance}>{importance}</option>)}
          </Select>
          <Select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
            <option value="all">All priorities</option>
            <option value="very_high">Very high priority</option>
            <option value="high">High priority</option>
            <option value="medium">Medium priority</option>
            <option value="low">Low priority</option>
            <option value="unknown">Unknown priority</option>
          </Select>
          <Select value={filters.curation} onChange={(event) => setFilters({ ...filters, curation: event.target.value })}>
            <option value="all">All curation</option>
            <option value="keep">Kept</option>
            <option value="needs_review">Needs review</option>
            <option value="reject">Rejected (from cards list)</option>
          </Select>
          <Select value={filters.standaloneValue} onChange={(event) => setFilters({ ...filters, standaloneValue: event.target.value })}>
            <option value="all">All standalone values</option>
            <option value="high">High standalone value</option>
            <option value="medium">Medium standalone value</option>
            <option value="low">Low standalone value</option>
          </Select>
          <Input placeholder="Section" value={filters.section} onChange={(event) => setFilters({ ...filters, section: event.target.value })} />
          <Input placeholder="Tag" value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })} />
          <Input placeholder="Source file" value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filters.showRejected} onChange={(event) => setFilters({ ...filters, showRejected: event.target.checked })} />
            Show rejected
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filters.showDeleted} onChange={(event) => setFilters({ ...filters, showDeleted: event.target.checked })} />
            Show deleted
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={filters.lowLatexOnly} onChange={(event) => setFilters({ ...filters, lowLatexOnly: event.target.checked })} />
            Low LaTeX quality
          </label>
        </CardContent>
      </Card>

      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setAdding(true)}>Add manual card</Button>
        <Button variant="outline" onClick={downloadJson}>Export JSON</Button>
        <Button variant="secondary" onClick={store.seedMockData}>Load mock data</Button>
        <Button variant="destructive" onClick={() => deleteCards(selectedIds)} disabled={selectedIds.length === 0}>Bulk delete selected</Button>
        <Button variant="outline" onClick={() => fixMath(selectedIds)} disabled={selectedIds.length === 0}>Fix math</Button>
        <Button variant="outline" onClick={() => { const item = store.revisionItems.find((candidate) => candidate.id === selectedIds[0]); if (item) void aiCleanMath(item); }} disabled={selectedIds.length !== 1}>AI clean math</Button>
      </div>
      {mathStatus ? <p className="mb-4 text-sm text-slate-600">{mathStatus}</p> : null}

      <Card className="mb-6">
        <CardHeader><CardTitle>Import cards from JSON</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea value={importText} onChange={(event) => setImportText(event.target.value)} placeholder="Paste exported RevisionItem[] JSON" />
          <Button variant="outline" onClick={importJson} disabled={!importText.trim()}>Import JSON</Button>
          {importError ? <p className="text-sm text-red-700">{importError}</p> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active cards</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto pt-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <input type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelectedIds(event.target.checked ? filtered.map((item) => item.id) : [])} aria-label="Select all visible cards" />
                </TableHead>
                <TableHead>Card</TableHead>
                <TableHead>Importance</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Warnings</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <input type="checkbox" checked={selectedIds.includes(item.id)} onChange={(event) => toggleSelection(item.id, event.target.checked, setSelectedIds)} aria-label={`Select ${item.title}`} />
                  </TableCell>
                  <TableCell>
                    <div className="space-y-2">
                      <MathMarkdown content={item.cardFront} className="bg-transparent p-0 font-medium text-slate-950" />
                      <div className="flex flex-wrap gap-1 text-xs text-slate-500">
                        <span>{item.displayTitle || item.title} · {item.type} · {item.cardPurpose} · {item.revisionPackCategory ?? "uncategorised"} · {(item.tags ?? []).join(", ")}</span>
                        <Badge variant="outline">{item.curationDecision ?? "keep"}</Badge>
                        <Badge variant="outline">priority {item.priorityScore ?? 0}</Badge>
                        <Badge variant="outline">standalone {item.standaloneValue ?? "unknown"}</Badge>
                      </div>
                      <MathMarkdown content={getPrimaryCardPreview(item)} className="bg-transparent p-0 text-sm text-slate-600" />
                    </div>
                  </TableCell>
                  <TableCell><Badge variant={item.importance}>{item.importance}</Badge></TableCell>
                  <TableCell className="text-sm text-slate-600">{item.sourceLocation || "source unknown"}</TableCell>
                  <TableCell>
                    {item.curationDecision === "needs_review" ? <Badge className="mb-1 mr-1" variant="unknown">Needs review</Badge> : null}
                    {hasLowLatexQuality(item) ? <Badge className="mb-1 mr-1" variant="unknown">Low LaTeX quality</Badge> : null}
                    {hasGenericConceptName(item) ? <Badge className="mb-1 mr-1" variant="unknown">Generic concept name</Badge> : null}
                    {(item.standaloneValue ?? "medium") === "low" ? <Badge className="mb-1 mr-1" variant="unknown">Low standalone value</Badge> : null}
                    {item.warnings?.map((warning) => <Badge key={warning} className="mb-1 mr-1" variant="unknown">{warning}</Badge>)}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(item)}>Edit</Button>
                      <Button size="sm" variant="outline" onClick={() => store.upsertRevisionItem({ ...item, curationDecision: "keep", curationStatus: "kept", cardPurpose: item.cardPurpose === "needs_review" ? "definition_recall" : item.cardPurpose })}>Mark keep</Button>
                      <Button size="sm" variant="outline" onClick={() => store.upsertRevisionItem({ ...item, curationDecision: "needs_review", curationStatus: "needs_review", cardPurpose: "needs_review" })}>Needs review</Button>
                      <Button size="sm" variant="outline" onClick={() => fixMath([item.id])}>Fix math</Button>
                      <Button size="sm" variant="outline" onClick={() => void aiCleanMath(item)}>AI clean math</Button>
                      <Button size="sm" variant="destructive" onClick={() => deleteCards([item.id])}><Trash2 className="h-4 w-4" />Delete</Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {filters.showRejected ? (
        <Card className="mt-6">
          <CardHeader><CardTitle>Rejected / low relevance ({store.rejectedItems.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {store.rejectedItems.length === 0 ? <p className="text-sm text-slate-500">No rejected items.</p> : null}
            {store.rejectedItems.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-slate-500">{item.type} · {item.rejectionCategory} · {item.sourceLocation || item.originalItem?.sourceLocation || "source unknown"}</p>
                  <p className="mt-1 text-slate-600">{item.rejectionReason}</p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => store.restoreRejectedItem(item.id)} disabled={!item.originalItem}>Restore</Button>
                  <Button size="sm" variant="destructive" onClick={() => store.permanentlyDeleteRejectedItem(item.id)}>Permanently delete</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {filters.showDeleted ? (
      <Card className="mt-6">
        <CardHeader><CardTitle>Deleted cards ({deletedCards.length})</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={allDeletedSelected} onChange={(event) => setSelectedDeletedIds(event.target.checked ? deletedCards.map((item) => item.id) : [])} />
              Select all deleted
            </label>
            <Button size="sm" variant="outline" onClick={() => restoreCards(selectedDeletedIds)} disabled={selectedDeletedIds.length === 0}>Bulk restore selected</Button>
          </div>
          {deletedCards.length === 0 ? <p className="text-sm text-slate-500">No deleted cards.</p> : null}
          {deletedCards.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
              <label className="flex items-center gap-3">
                <input type="checkbox" checked={selectedDeletedIds.includes(item.id)} onChange={(event) => toggleSelection(item.id, event.target.checked, setSelectedDeletedIds)} />
                <span>
                  <span className="font-medium">{item.cardFront}</span>
                  <span className="block text-xs text-slate-500">{item.deletedAt ? `Deleted ${new Date(item.deletedAt).toLocaleString()}` : "Deleted"}</span>
                </span>
              </label>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => restoreCards([item.id])}>Restore</Button>
                <Button size="sm" variant="destructive" onClick={() => store.permanentlyDeleteRevisionItem(item.id)}>Permanently delete</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
      ) : null}

      {editing ? (
        <Card className="mt-6">
          <CardHeader><CardTitle>{editing.displayTitle || editing.title}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <MathMarkdown content={editing.cardFront} />
            {editing.taskPrompt ? <MathMarkdown content={editing.taskPrompt} className="bg-transparent p-0 text-sm text-slate-500" /> : null}
            <MathMarkdown content={editing.statementLatex || editing.statement} />
            {editing.answer ? <MathMarkdown content={editing.answerLatex || editing.answer} /> : null}
            {editing.proof ? <MathMarkdown content={editing.proofLatex || editing.proof} /> : null}
          </CardContent>
        </Card>
      ) : null}

      {editing || adding ? (
        <Dialog open onOpenChange={(open) => { if (!open) { setEditing(undefined); setAdding(false); } }}>
          <DialogContent>
            <h2 className="mb-4 text-xl font-semibold">{editing ? "Edit card" : "Add card"}</h2>
            <CardForm
              item={editing}
              onCancel={() => { setEditing(undefined); setAdding(false); }}
              onSave={(item) => { store.upsertRevisionItem(item); setEditing(undefined); setAdding(false); }}
              onDelete={editing && !editing.isDeleted ? () => { deleteCards([editing.id]); setEditing(undefined); } : undefined}
              onRestore={editing?.isDeleted ? () => { restoreCards([editing.id]); setEditing(undefined); } : undefined}
            />
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}

function matchesFilters(item: RevisionItem, filters: { type: string; cardPurpose: string; packCategory: string; importance: string; priority: string; curation: string; standaloneValue: string; lowLatexOnly: boolean; section: string; tag: string; source: string }) {
  return (filters.type === "all" || item.type === filters.type) &&
    (filters.cardPurpose === "all" || item.cardPurpose === filters.cardPurpose) &&
    (filters.packCategory === "all" || item.revisionPackCategory === filters.packCategory) &&
    (filters.importance === "all" || item.importance === filters.importance) &&
    (filters.priority === "all" || item.priorityLabel === filters.priority) &&
    (filters.curation === "all" || (item.curationDecision ?? "keep") === filters.curation) &&
    (filters.standaloneValue === "all" || item.standaloneValue === filters.standaloneValue) &&
    (!filters.lowLatexOnly || hasLowLatexQuality(item)) &&
    (!filters.section || item.section?.toLowerCase().includes(filters.section.toLowerCase())) &&
    (!filters.tag || (item.tags ?? []).some((tag) => tag.toLowerCase().includes(filters.tag.toLowerCase()))) &&
    (!filters.source || (item.sourceFile ?? "").toLowerCase().includes(filters.source.toLowerCase()));
}

function toggleSelection(id: string, selected: boolean, setSelected: Dispatch<SetStateAction<string[]>>) {
  setSelected((current) => selected ? Array.from(new Set([...current, id])) : current.filter((candidate) => candidate !== id));
}

function UndoBanner({ message, onUndo, onDismiss }: { message: string; onUndo: () => void; onDismiss: () => void }) {
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-slate-950 px-4 py-3 text-sm text-white shadow-lg">
      <span>{message}</span>
      <Button size="sm" variant="secondary" onClick={onUndo}>Undo</Button>
      <Button size="sm" variant="ghost" className="text-white hover:bg-slate-800" onClick={onDismiss}>Dismiss</Button>
    </div>
  );
}
