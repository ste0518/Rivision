"use client";

import { useEffect, useMemo, useState } from "react";
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

type StatusTab = "kept" | "needs_review" | "rejected" | "deleted" | "low_math";
type CategoryTab = "all" | "concepts" | "formulas" | "algorithms" | "proofs" | "worked_examples";

type UndoState = { message: string; itemIds: string[]; action: "delete" | "restore" } | null;

export default function CardsPage() {
  const store = useStudyStore();
  const [editing, setEditing] = useState<RevisionItem | undefined>();
  const [adding, setAdding] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [statusTab, setStatusTab] = useState<StatusTab>(() => {
    if (typeof window === "undefined") return "kept";
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab") as StatusTab | null;
    if (tab && ["kept", "needs_review", "rejected", "deleted", "low_math"].includes(tab)) return tab;
    if (params.get("curation") === "needs_review") return "needs_review";
    return "kept";
  });
  const [categoryTab, setCategoryTab] = useState<CategoryTab>("all");
  const [search, setSearch] = useState("");
  const [moreFilters, setMoreFilters] = useState(false);
  const [filters, setFilters] = useState({
    type: "all",
    cardPurpose: "all",
    packCategory: "all",
    importance: "all",
    priority: "all",
    standaloneValue: "all",
    section: "",
    tag: "",
    source: "",
    showRejected: false,
  });
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [undo, setUndo] = useState<UndoState>(null);
  const [mathStatus, setMathStatus] = useState("");
  const [apiOk, setApiOk] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings-status")
      .then((res) => res.json() as Promise<{ openaiConfigured?: boolean }>)
      .then((json) => {
        if (!cancelled) setApiOk(Boolean(json.openaiConfigured));
      })
      .catch(() => {
        if (!cancelled) setApiOk(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCards = useMemo(() => store.revisionItems.filter((item) => !item.isDeleted), [store.revisionItems]);
  const deletedCards = useMemo(() => store.revisionItems.filter((item) => item.isDeleted), [store.revisionItems]);

  const statusFiltered = useMemo(() => {
    switch (statusTab) {
      case "kept":
        return activeCards.filter((item) => (item.curationDecision ?? "keep") === "keep");
      case "needs_review":
        return activeCards.filter((item) => (item.curationDecision ?? "keep") === "needs_review");
      case "low_math":
        return activeCards.filter((item) => hasLowLatexQuality(item));
      case "deleted":
        return deletedCards;
      case "rejected":
        return [];
      default:
        return activeCards;
    }
  }, [activeCards, deletedCards, statusTab]);

  const filtered = useMemo(() => {
    let base = statusTab === "rejected" ? [] : statusFiltered;
    if (statusTab !== "rejected") {
      base = base.filter((item) => matchesCategory(item, categoryTab));
      base = base.filter((item) => matchesSearch(item, search));
      base = base.filter((item) => matchesAdvancedFilters(item, filters));
    }
    return base;
  }, [statusFiltered, statusTab, categoryTab, search, filters]);

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
    setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
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
        latexQuality: "medium",
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async function aiCleanMath(item: RevisionItem) {
    if (!apiOk) return;
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

  const tabButtons = [
    { value: "kept" as const, label: `Kept (${activeCards.filter((i) => (i.curationDecision ?? "keep") === "keep").length})` },
    { value: "needs_review" as const, label: `Needs review (${activeCards.filter((i) => (i.curationDecision ?? "keep") === "needs_review").length})` },
    { value: "low_math" as const, label: `Low math (${activeCards.filter(hasLowLatexQuality).length})` },
    { value: "rejected" as const, label: `Rejected (${store.rejectedItems.length})` },
    { value: "deleted" as const, label: `Deleted (${deletedCards.length})` },
  ];

  return (
    <div>
      <PageHeader title="Cards" description="Edit flashcards with simple filters. Use bulk actions only when you have rows selected." />

      {undo ? <UndoBanner message={undo.message} onUndo={handleUndo} onDismiss={() => setUndo(null)} /> : null}

      <Card className="mb-6">
        <CardContent className="space-y-4 pt-6">
          <Input placeholder="Search card front or title…" value={search} onChange={(event) => setSearch(event.target.value)} />

          <div className="flex flex-wrap gap-2">
            {tabButtons.map((tab) => (
              <Button
                key={tab.value}
                type="button"
                size="sm"
                variant={statusTab === tab.value ? "default" : "outline"}
                onClick={() => {
                  setStatusTab(tab.value);
                  setSelectedIds([]);
                }}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-slate-600">Category:</span>
            <Select value={categoryTab} onChange={(event) => setCategoryTab(event.target.value as CategoryTab)} className="max-w-xs">
              <option value="all">All</option>
              <option value="concepts">Concepts</option>
              <option value="formulas">Formulas</option>
              <option value="algorithms">Algorithms</option>
              <option value="proofs">Proofs</option>
              <option value="worked_examples">Worked examples</option>
            </Select>
          </div>

          <button type="button" className="text-sm font-medium text-blue-700 underline" onClick={() => setMoreFilters((current) => !current)}>
            {moreFilters ? "Hide" : "More"} filters
          </button>

          {moreFilters ? (
            <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:grid-cols-3 lg:grid-cols-4">
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
                {revisionPackCategories.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </Select>
              <Select value={filters.importance} onChange={(event) => setFilters({ ...filters, importance: event.target.value })}>
                <option value="all">All importance</option>
                {importances.map((importance) => <option key={importance}>{importance}</option>)}
              </Select>
              <Select value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
                <option value="all">All priorities</option>
                <option value="very_high">Very high</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="unknown">Unknown</option>
              </Select>
              <Select value={filters.standaloneValue} onChange={(event) => setFilters({ ...filters, standaloneValue: event.target.value })}>
                <option value="all">All standalone</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </Select>
              <Input placeholder="Section" value={filters.section} onChange={(event) => setFilters({ ...filters, section: event.target.value })} />
              <Input placeholder="Tag" value={filters.tag} onChange={(event) => setFilters({ ...filters, tag: event.target.value })} />
              <Input placeholder="Source file" value={filters.source} onChange={(event) => setFilters({ ...filters, source: event.target.value })} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      {selectedIds.length > 0 && statusTab !== "rejected" ? (
        <div className="mb-4 flex flex-wrap gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3">
          <span className="text-sm text-blue-900">{selectedIds.length} selected</span>
          <Button variant="destructive" size="sm" onClick={() => deleteCards(selectedIds)}>
            Delete selected
          </Button>
          <Button variant="outline" size="sm" onClick={() => fixMath(selectedIds)}>
            Fix math (selected)
          </Button>
          {apiOk ? (
            <Button variant="outline" size="sm" onClick={() => { const item = store.revisionItems.find((c) => c.id === selectedIds[0]); if (item) void aiCleanMath(item); }} disabled={selectedIds.length !== 1}>
              AI clean math (one card)
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        <Button onClick={() => setAdding(true)}>Add manual card</Button>
        <Button variant="outline" onClick={downloadJson}>Export JSON</Button>
        <Button variant="secondary" onClick={store.seedMockData}>Load mock data</Button>
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

      {statusTab === "rejected" ? (
        <Card>
          <CardHeader><CardTitle>Rejected / low relevance</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {store.rejectedItems.length === 0 ? <p className="text-sm text-slate-500">No rejected items.</p> : null}
            {store.rejectedItems.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-sm">
                <div>
                  <p className="font-medium">{item.title}</p>
                  <p className="text-xs text-slate-500">{item.type} · {item.rejectionCategory}</p>
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
      ) : (
        <Card>
          <CardHeader><CardTitle>{tabButtons.find((t) => t.value === statusTab)?.label ?? "Cards"}</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto pt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => setSelectedIds(event.target.checked ? filtered.map((item) => item.id) : [])}
                      aria-label="Select all visible cards"
                    />
                  </TableHead>
                  <TableHead>Card</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(item.id)}
                        onChange={(event) => toggleSelection(item.id, event.target.checked, setSelectedIds)}
                        aria-label={`Select ${item.title}`}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2 max-w-md">
                        <MathMarkdown content={item.cardFront} className="bg-transparent p-0 font-medium text-slate-950" />
                        <p className="line-clamp-2 text-xs text-slate-500">{previewSnippet(getPrimaryCardPreview(item))}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">{prettyCategory(item)}</TableCell>
                    <TableCell className="text-sm">{item.priorityScore ?? "—"}</TableCell>
                    <TableCell className="text-sm text-slate-600">{item.sourceLocation || item.sourceFile || "—"}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {item.curationDecision === "needs_review" ? <Badge variant="unknown">Needs review</Badge> : null}
                        {hasLowLatexQuality(item) ? <Badge variant="unknown">Low math</Badge> : null}
                        {hasGenericConceptName(item) ? <Badge variant="unknown">Generic title</Badge> : null}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {statusTab === "deleted" ? (
                          <>
                            <Button size="sm" variant="outline" onClick={() => restoreCards([item.id])}>Restore</Button>
                            <Button size="sm" variant="destructive" onClick={() => store.permanentlyDeleteRevisionItem(item.id)}>Permanently delete</Button>
                          </>
                        ) : (
                          <>
                            <Button size="sm" variant="outline" onClick={() => setEditing(item)}>Edit</Button>
                            <Button size="sm" variant="outline" onClick={() => fixMath([item.id])}>Fix math</Button>
                            {apiOk ? (
                              <Button size="sm" variant="outline" onClick={() => void aiCleanMath(item)}>AI clean math</Button>
                            ) : null}
                            <Button size="sm" variant="destructive" onClick={() => deleteCards([item.id])}><Trash2 className="h-4 w-4" />Delete</Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {filtered.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">No cards match these filters.</p> : null}
          </CardContent>
        </Card>
      )}

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

function previewSnippet(text: string) {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 160)}…` : t;
}

function prettyCategory(item: RevisionItem) {
  const c = item.revisionPackCategory ?? item.cardPurpose ?? item.type;
  return String(c).replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ");
}

function matchesCategory(item: RevisionItem, category: CategoryTab) {
  if (category === "all") return true;
  if (category === "concepts") {
    return ["mustKnowDefinitions", "conceptualDistinctions", "modelsToKnow", "theoremStatements"].includes(item.revisionPackCategory ?? "") || item.type === "definition";
  }
  if (category === "formulas") return item.revisionPackCategory === "formulasToKnow" || item.cardPurpose === "formula_recall";
  if (category === "algorithms") return item.type === "algorithm" || item.cardPurpose === "method_steps";
  if (category === "proofs") return item.revisionPackCategory === "proofsToKnow" || item.cardPurpose === "proof_recall" || item.type === "proof";
  if (category === "worked_examples") return item.revisionPackCategory === "workedExamplePatterns" || item.cardPurpose === "worked_example_pattern";
  return true;
}

function matchesSearch(item: RevisionItem, search: string) {
  if (!search.trim()) return true;
  const q = search.toLowerCase();
  return `${item.cardFront}\n${item.title}\n${item.displayTitle ?? ""}`.toLowerCase().includes(q);
}

function matchesAdvancedFilters(
  item: RevisionItem,
  filters: {
    type: string;
    cardPurpose: string;
    packCategory: string;
    importance: string;
    priority: string;
    standaloneValue: string;
    section: string;
    tag: string;
    source: string;
    showRejected: boolean;
  },
) {
  return (
    (filters.type === "all" || item.type === filters.type) &&
    (filters.cardPurpose === "all" || item.cardPurpose === filters.cardPurpose) &&
    (filters.packCategory === "all" || item.revisionPackCategory === filters.packCategory) &&
    (filters.importance === "all" || item.importance === filters.importance) &&
    (filters.priority === "all" || item.priorityLabel === filters.priority) &&
    (filters.standaloneValue === "all" || item.standaloneValue === filters.standaloneValue) &&
    (!filters.section || item.section?.toLowerCase().includes(filters.section.toLowerCase())) &&
    (!filters.tag || (item.tags ?? []).some((tag) => tag.toLowerCase().includes(filters.tag.toLowerCase()))) &&
    (!filters.source || (item.sourceFile ?? "").toLowerCase().includes(filters.source.toLowerCase()))
  );
}

function toggleSelection(id: string, selected: boolean, setSelected: Dispatch<SetStateAction<string[]>>) {
  setSelected((current) => (selected ? Array.from(new Set([...current, id])) : current.filter((candidate) => candidate !== id)));
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
