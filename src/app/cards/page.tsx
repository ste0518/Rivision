"use client";

import { useMemo, useState } from "react";
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
import { MathText } from "@/components/math-text";
import { exportRevisionItems, importRevisionItems } from "@/lib/storage";
import { importances, revisionItemTypes, type RevisionItem } from "@/lib/types";
import { useStudyStore } from "@/hooks/use-study-store";

export default function CardsPage() {
  const store = useStudyStore();
  const [editing, setEditing] = useState<RevisionItem | undefined>();
  const [adding, setAdding] = useState(false);
  const [importText, setImportText] = useState("");
  const [filters, setFilters] = useState({ type: "all", importance: "all", section: "", tag: "", source: "" });
  const filtered = useMemo(() => store.revisionItems.filter((item) => (filters.type === "all" || item.type === filters.type) && (filters.importance === "all" || item.importance === filters.importance) && (!filters.section || item.section?.toLowerCase().includes(filters.section.toLowerCase())) && (!filters.tag || item.tags.some((tag) => tag.toLowerCase().includes(filters.tag.toLowerCase()))) && (!filters.source || item.sourceFile.toLowerCase().includes(filters.source.toLowerCase()))), [filters, store.revisionItems]);
  function downloadJson() { const blob = new Blob([exportRevisionItems(store.revisionItems)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "rivision-cards.json"; a.click(); URL.revokeObjectURL(url); }
  function importJson() { store.setRevisionItems(importRevisionItems(importText)); setImportText(""); }
  return <div><PageHeader title="Review and edit cards" description="Filter extracted items, correct prompts and answers, delete false positives, or add manual cards." /><Card className="mb-6"><CardContent className="grid gap-3 pt-6 md:grid-cols-5"><Select value={filters.type} onChange={(e) => setFilters({ ...filters, type: e.target.value })}><option value="all">All types</option>{revisionItemTypes.map((type) => <option key={type}>{type}</option>)}</Select><Select value={filters.importance} onChange={(e) => setFilters({ ...filters, importance: e.target.value })}><option value="all">All importance</option>{importances.map((importance) => <option key={importance}>{importance}</option>)}</Select><Input placeholder="Section" value={filters.section} onChange={(e) => setFilters({ ...filters, section: e.target.value })} /><Input placeholder="Tag" value={filters.tag} onChange={(e) => setFilters({ ...filters, tag: e.target.value })} /><Input placeholder="Source file" value={filters.source} onChange={(e) => setFilters({ ...filters, source: e.target.value })} /></CardContent></Card><div className="mb-4 flex flex-wrap gap-2"><Button onClick={() => setAdding(true)}>Add manual card</Button><Button variant="outline" onClick={downloadJson}>Export JSON</Button><Button variant="secondary" onClick={store.seedMockData}>Load mock data</Button></div><Card className="mb-6"><CardHeader><CardTitle>Import cards from JSON</CardTitle></CardHeader><CardContent className="space-y-3"><Textarea value={importText} onChange={(e) => setImportText(e.target.value)} placeholder="Paste exported RevisionItem[] JSON" /><Button variant="outline" onClick={importJson} disabled={!importText.trim()}>Import JSON</Button></CardContent></Card><Card><CardContent className="overflow-x-auto pt-6"><Table><TableHeader><TableRow><TableHead>Card</TableHead><TableHead>Importance</TableHead><TableHead>Source</TableHead><TableHead>Warnings</TableHead><TableHead /></TableRow></TableHeader><TableBody>{filtered.map((item) => <TableRow key={item.id}><TableCell><div className="space-y-2"><div className="font-medium">{item.title}</div><div className="text-xs text-slate-500">{item.type} · {item.tags.join(", ")}</div><MathText>{item.questionPrompt}</MathText></div></TableCell><TableCell><Badge variant={item.importance}>{item.importance}</Badge></TableCell><TableCell className="text-sm text-slate-600">{item.sourceLocation || "source unknown"}</TableCell><TableCell>{item.warnings?.map((warning) => <Badge key={warning} className="mb-1 mr-1" variant="unknown">{warning}</Badge>)}</TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setEditing(item)}>Edit</Button><Button size="sm" variant="destructive" onClick={() => store.deleteRevisionItem(item.id)}>Delete</Button></div></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>{editing || adding ? <Dialog open onOpenChange={(open) => { if (!open) { setEditing(undefined); setAdding(false); } }}><DialogContent><h2 className="mb-4 text-xl font-semibold">{editing ? "Edit card" : "Add card"}</h2><CardForm item={editing} onCancel={() => { setEditing(undefined); setAdding(false); }} onSave={(item) => { store.upsertRevisionItem(item); setEditing(undefined); setAdding(false); }} /></DialogContent></Dialog> : null}</div>;
}
