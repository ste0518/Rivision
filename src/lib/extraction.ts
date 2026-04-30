import { createMockRevisionItems } from "@/lib/mock-data";
import { defaultLlmPipelineSettings, type LlmPipelineSettings } from "@/lib/llm/provider";
import type { Importance, RevisionItem, RevisionItemType } from "@/lib/types";
import { createId } from "@/lib/utils";
import { withValidation } from "@/lib/validation";

type ExtractRevisionItemsInput = {
  notesText: string;
  guidanceText: string;
  sourceFile?: string;
};

const llmExtractionPrompt = `You are extracting exam revision flashcards from lecture notes. Use only the supplied notes and guidance. Extract definitions, theorems, propositions, lemmas, formulae, and required proof statements. Classify each item as must_know, partial, not_required, or unknown based only on the guidance. Return strict JSON matching the RevisionItem schema. Do not invent content. Preserve mathematical notation as accurately as possible.`;

export function getLlmExtractionPrompt() {
  return llmExtractionPrompt;
}

export async function extractRevisionItems({
  notesText,
  guidanceText,
  sourceFile = "Uploaded notes",
}: ExtractRevisionItemsInput): Promise<RevisionItem[]> {
  const settings = loadLlmPipelineSettings();
  if (settings.mode === "openai_api" || settings.mode === "cheap_scan_then_verify") {
    const llmItems = await extractViaApi({
      notesText,
      guidanceText,
      sourceFile,
      settings,
    });
    if (llmItems.length > 0) return llmItems.map(withValidation);
  }

  const extracted = deterministicExtract(notesText, guidanceText, sourceFile);
  if (extracted.length > 0) return extracted.map(withValidation);

  // TODO: Replace or augment this fallback with an LLM adapter using getLlmExtractionPrompt().
  return createMockRevisionItems().map(withValidation);
}

export function generateManualExtractionPrompt(input: { notesText: string; guidanceText: string; sourceFile: string }) {
  return `You are an exam revision extraction engine.

Use only the supplied lecture notes and guidance text. Do not invent missing theorem numbers, section numbers, or statements.

Return STRICT JSON ONLY as an array of RevisionItem objects matching this schema:
- id: string
- type: "definition" | "theorem" | "lemma" | "proposition" | "corollary" | "formula" | "proof" | "algorithm" | "example" | "remark" | "other"
- title: string
- statement: string
- proof?: string
- proofRequired?: boolean
- sourceFile: string
- sourceLocation?: string
- section?: string
- theoremNumber?: string
- tags: string[]
- importance: "must_know" | "partial" | "not_required" | "unknown"
- guidanceReason?: string
- uncertaintyNote?: string
- questionPrompt: string
- answer: string
- createdAt: ISO string
- updatedAt: ISO string

Extraction requirements:
1) Extract explicitly labelled items: Definition, Theorem, Lemma, Proposition, Corollary, Formula, Proof, Remark, Example, Algorithm.
2) Also extract implicit theorem-like statements such as:
   "We say that...", "X is called...", "It follows that...", "A process is stationary if...", "The BLUP is given by..."
3) Preserve section info, source location, theorem numbering, and mathematical notation.
4) Classify importance from guidance:
   - must_know / partial / not_required / unknown
5) If unsure or text is incomplete, keep the item but set importance = "unknown" and add uncertaintyNote.
6) Output valid JSON only; no markdown fence, no commentary.

Source file: ${input.sourceFile}

Guidance text:
${input.guidanceText || "(none)"}

Lecture notes:
${input.notesText}`;
}

async function extractViaApi(input: {
  notesText: string;
  guidanceText: string;
  sourceFile: string;
  settings: LlmPipelineSettings;
}) {
  try {
    const response = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return [];
    const payload = (await response.json()) as { items?: RevisionItem[] };
    return payload.items ?? [];
  } catch {
    return [];
  }
}

const llmSettingsStorageKey = "rivision.llm.settings.v1";

export function loadLlmPipelineSettings(): LlmPipelineSettings {
  if (typeof window === "undefined") return defaultLlmPipelineSettings;
  const raw = window.localStorage.getItem(llmSettingsStorageKey);
  if (!raw) return defaultLlmPipelineSettings;
  try {
    return { ...defaultLlmPipelineSettings, ...(JSON.parse(raw) as Partial<LlmPipelineSettings>) };
  } catch {
    return defaultLlmPipelineSettings;
  }
}

export function saveLlmPipelineSettings(settings: LlmPipelineSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(llmSettingsStorageKey, JSON.stringify(settings));
}

function deterministicExtract(notesText: string, guidanceText: string, sourceFile: string): RevisionItem[] {
  if (!notesText.trim() || notesText.includes("[PDF placeholder]") || notesText.includes("[DOCX placeholder]")) {
    return [];
  }

  const lines = notesText.replace(/\r\n/g, "\n").split("\n");
  const markers = collectMarkers(lines);
  const items: RevisionItem[] = [];
  const timestamp = new Date().toISOString();

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const next = markers[index + 1];
    const endLine = next ? next.line : lines.length;
    const chunkLines = lines.slice(marker.line + 1, endLine);
    const section = nearestSection(lines, marker.line);
    const statement = clean([marker.tail, ...chunkLines].join(" ").trim());
    if (!statement || statement.length < 15) continue;

    const label = marker.label || marker.rawType;
    const title = titleFromLabel(marker.type, label, statement);
    const { importance, reason } = classifyImportance(marker.type, title, statement, guidanceText);
    const theoremNumber = extractNumber(label);
    const uncertaintyNote = statement.length < 40 ? "Statement may be incomplete after text parsing." : undefined;

    items.push({
      id: createId("card"),
      type: marker.type,
      title,
      statement,
      sourceFile,
      sourceLocation: label !== marker.rawType ? label : undefined,
      section,
      theoremNumber,
      tags: inferTags(marker.type, `${title} ${statement}`),
      importance: uncertaintyNote ? "unknown" : importance,
      guidanceReason: reason,
      uncertaintyNote,
      questionPrompt: buildQuestion(marker.type, title),
      answer: buildAnswer(marker.type, statement),
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewCount: 0,
    });
  }

  for (const match of notesText.matchAll(/\b(definition|theorem|lemma|proposition|corollary)\s+of\s+([^\n.:]{3,120}?)\s+(?:is|states?\s+that)\s+([^\n]{20,})/gi)) {
    const type = normaliseType(match[1]);
    if (!type) continue;
    const statement = clean(match[3]);
    const title = `${capitalise(type)} of ${clean(match[2])}`;
    const { importance, reason } = classifyImportance(type, title, statement, guidanceText);
    const uncertaintyNote = statement.length < 40 ? "Statement may be incomplete after text parsing." : undefined;

    items.push({
      id: createId("card"),
      type,
      title,
      statement,
      sourceFile,
      sourceLocation: "inline pattern",
      section: undefined,
      theoremNumber: extractNumber(title),
      tags: inferTags(type, `${title} ${statement}`),
      importance: uncertaintyNote ? "unknown" : importance,
      guidanceReason: reason,
      uncertaintyNote,
      questionPrompt: buildQuestion(type, title),
      answer: buildAnswer(type, statement),
      createdAt: timestamp,
      updatedAt: timestamp,
      reviewCount: 0,
    });
  }

  return dedupeItems(items);
}

function collectMarkers(lines: string[]) {
  const markers: Array<{ line: number; type: RevisionItemType; rawType: string; label?: string; tail: string }> = [];
  const headRegex = /^\s*(?:[-*]\s*)?(definition|def\.?|theorem|thm\.?|lemma|proposition|prop\.?|corollary|proof|remark|formula|equation|example|algorithm)\s*([A-Za-z]?\d+(?:\.\d+)*)?\s*[:.)-]?\s*(.*)$/i;

  for (let line = 0; line < lines.length; line += 1) {
    const text = lines[line].trim();
    if (!text) continue;

    const heading = text.match(headRegex);
    if (heading) {
      const type = normaliseType(heading[1]);
      if (!type) continue;
      const id = clean(heading[2] ?? "");
      markers.push({
        line,
        type,
        rawType: clean(heading[1]),
        label: id || undefined,
        tail: clean(heading[3] ?? ""),
      });
      continue;
    }

    if (isFormulaLikeLine(text)) {
      markers.push({ line, type: "formula", rawType: "formula", label: undefined, tail: text });
    }
  }

  return markers.sort((a, b) => a.line - b.line);
}

function normaliseType(value: string): RevisionItemType | null {
  const word = value.toLowerCase().replace(/\./g, "");
  if (word === "definition" || word === "def") return "definition";
  if (word === "theorem" || word === "thm") return "theorem";
  if (word === "lemma") return "lemma";
  if (word === "proposition" || word === "prop") return "proposition";
  if (word === "corollary") return "corollary";
  if (word === "proof") return "proof";
  if (word === "remark") return "remark";
  if (word === "example") return "example";
  if (word === "algorithm") return "algorithm";
  if (word === "formula" || word === "equation") return "formula";
  return null;
}

function nearestSection(lines: string[], fromLine: number) {
  for (let index = fromLine; index >= 0; index -= 1) {
    const text = lines[index].trim();
    const sectionMatch = text.match(/^(?:section|chapter)\s+(\d+(?:\.\d+)*)/i);
    if (sectionMatch) return `Section ${sectionMatch[1]}`;

    const markdownMatch = text.match(/^#{1,4}\s+(.+)/);
    if (markdownMatch) return clean(markdownMatch[1]);
  }
  return undefined;
}

function isFormulaLikeLine(text: string) {
  const hasEquals = text.includes("=") || text.includes("\\approx") || text.includes("\\sum");
  const hasMathChars = /[+\-*/^_()[\]{}]/.test(text);
  const hasMathTerms = /\b(var|cov|gamma|sigma|mu|blup|kriging|likelihood)\b/i.test(text);
  return text.length >= 10 && hasEquals && (hasMathChars || hasMathTerms);
}

function dedupeItems(items: RevisionItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.type}|${clean(item.title).toLowerCase()}|${clean(item.statement).toLowerCase().slice(0, 300)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clean(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function titleFromLabel(type: RevisionItemType, label: string, statement: string) {
  if (label && label !== type) return `${capitalise(type)} ${label}`;
  const firstWords = statement.split(" ").slice(0, 6).join(" ");
  return `${capitalise(type)}: ${firstWords}${statement.split(" ").length > 6 ? "..." : ""}`;
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function classifyImportance(type: RevisionItemType, title: string, statement: string, guidanceText: string): { importance: Importance; reason?: string } {
  const guidance = guidanceText.toLowerCase();
  const haystack = `${title} ${statement}`.toLowerCase();
  if (!guidance.trim()) return { importance: "unknown", reason: "No guidance file content was available." };

  if (guidance.includes("proof") && guidance.includes("not required") && type === "proof") {
    return { importance: "not_required", reason: "Guidance says proofs are not required." };
  }

  if (guidance.includes("only know the statement") && type === "proof") {
    return { importance: "not_required", reason: "Guidance says only the statement is required." };
  }

  if (guidance.includes("only know the statement") && ["theorem", "proposition", "lemma"].includes(type)) {
    return { importance: "must_know", reason: "Guidance says the statement is required." };
  }

  const numberMatch = title.match(/(\d+(?:\.\d+)+)/);
  if (numberMatch && guidance.includes(numberMatch[1])) {
    return { importance: "must_know", reason: `Guidance references ${numberMatch[1]}.` };
  }

  if (["must", "examinable", "memorise", "memorize"].some((word) => guidance.includes(word))) {
    const keywordHit = haystack.split(/\W+/).some((word) => word.length > 4 && guidance.includes(word));
    return {
      importance: keywordHit || type === "definition" ? "must_know" : "partial",
      reason: "Matched must-know style guidance.",
    };
  }

  if (guidance.includes("partial") || guidance.includes("statement")) {
    return { importance: "partial", reason: "Guidance suggests partial knowledge." };
  }

  if (guidance.includes("not required")) {
    return { importance: "not_required", reason: "Guidance says this material is not required." };
  }

  return { importance: "unknown", reason: "Could not confidently match this item to the guidance." };
}

function inferTags(type: RevisionItemType, text: string) {
  const tags = new Set<string>([type]);
  for (const keyword of ["stationarity", "covariance", "variogram", "kriging", "proof", "formula", "theorem", "algorithm", "example"]) {
    if (text.toLowerCase().includes(keyword)) tags.add(keyword);
  }
  return Array.from(tags);
}

function buildQuestion(type: RevisionItemType, title: string) {
  if (type === "definition") return `State the definition of ${title.replace(/^Definition\s*/i, "")}.`;
  if (type === "formula") return `Write down ${title} and explain each term.`;
  if (type === "proof") return `Outline the proof of ${title}.`;
  return `State ${title} and explain when it applies.`;
}

function buildAnswer(type: RevisionItemType, statement: string) {
  if (type === "formula") return `${statement}\n\nExplain the notation and conditions under which the formula applies.`;
  return statement;
}

function extractNumber(value: string) {
  const match = value.match(/(\d+(?:\.\d+)+)/);
  return match ? match[1] : undefined;
}
