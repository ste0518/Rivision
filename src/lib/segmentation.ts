import { createId } from "@/lib/utils";
import type { CandidateRevisionBlock, ParsedDocument, RevisionCandidateLabel, RevisionItemType } from "@/lib/types";

type Marker = {
  kind: "label" | "section";
  start: number;
  end: number;
  label: RevisionCandidateLabel;
  type?: RevisionItemType;
  number?: string;
};

export const majorLabelWords = [
  "Definition",
  "Theorem",
  "Lemma",
  "Proposition",
  "Corollary",
  "Remark",
  "Example",
  "Assumption",
  "Property",
  "Proof",
  "Algorithm",
];

const labelWords = [...majorLabelWords, "Formula", "Equation"];

export const ITEM_LABEL_RE = new RegExp(
  `\\b(${majorLabelWords.join("|")})\\s*(\\d+(?:\\.\\d+)*)?\\s*(?:\\[[^\\]]+\\])?\\s*[\\.:]?`,
  "g",
);

const FORMULA_LABEL_RE = /\b(Formula|Equation)\s*(\d+(?:\.\d+)*)?\s*[\.:]?/g;
const THEOREM_LIKE_TYPES: RevisionItemType[] = ["theorem", "lemma", "proposition", "corollary"];

export type SegmentationDebugLabel = {
  id: string;
  label: RevisionCandidateLabel;
  number?: string;
  sourceFile: string;
  pageNumber?: number;
  startOffset: number;
  endOffset: number;
  rawTextPreview: string;
  rawTextLength: number;
  containsMultipleMajorLabels: boolean;
};

export type SegmentationDebugDocument = {
  sourceFile: string;
  fullTextCharCount: number;
  labelRegexMatchCount: number;
  candidateCount: number;
  averageCandidateLength: number;
  maxCandidateLength: number;
  warnings: string[];
  labels: SegmentationDebugLabel[];
};

export function segmentRevisionCandidates(parsedDocuments: ParsedDocument[]): CandidateRevisionBlock[] {
  return parsedDocuments.flatMap(segmentRevisionDocument);
}

export function segmentRevisionDocument(document: ParsedDocument): CandidateRevisionBlock[] {
  const text = document.fullText.replace(/\r\n/g, "\n");
  if (!text.trim()) return [];

  const markers = collectMarkers(text);
  const labelledMarkers = markers.filter((marker) => marker.kind === "label" && marker.type);

  if (labelledMarkers.length === 0) return segmentUnlabelledDocument(document, text);

  return labelledMarkers
    .map((marker) => buildCandidateFromMarker(document, text, markers, marker))
    .filter((candidate): candidate is CandidateRevisionBlock => Boolean(candidate));
}

export function attachProofsToPreviousTheorem(candidates: CandidateRevisionBlock[]): CandidateRevisionBlock[] {
  const output: CandidateRevisionBlock[] = [];

  for (const candidate of candidates) {
    const previous = output.at(-1);
    if (
      candidate.type === "proof" &&
      previous &&
      THEOREM_LIKE_TYPES.includes(previous.type) &&
      previous.sourceFile === candidate.sourceFile
    ) {
      const statement = previous.statement ?? clean(stripLeadingLabel(previous.rawText));
      const proof = clean(stripLeadingLabel(candidate.rawText));
      output[output.length - 1] = {
        ...previous,
        statement,
        proof,
        extractionWarning: previous.extractionWarning,
      };
      continue;
    }

    output.push(candidate);
  }

  return output;
}

export function buildSegmentationDebug(parsedDocuments: ParsedDocument[]): SegmentationDebugDocument[] {
  return parsedDocuments.map((document) => {
    const text = document.fullText.replace(/\r\n/g, "\n");
    const looseLabelMatchCount = collectLooseLabelMatches(text).length;
    const candidates = segmentRevisionDocument(document);
    const labels = candidates.map((candidate) => ({
      id: candidate.id,
      label: candidate.label,
      number: candidate.number,
      sourceFile: candidate.sourceFile,
      pageNumber: candidate.pageNumber,
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
      rawTextPreview: candidate.rawText.slice(0, 300),
      rawTextLength: candidate.rawText.length,
      containsMultipleMajorLabels: countMajorLabels(candidate.rawText) > 1,
    }));
    const totalLength = labels.reduce((sum, label) => sum + label.rawTextLength, 0);
    const maxCandidateLength = labels.reduce((max, label) => Math.max(max, label.rawTextLength), 0);
    const warnings: string[] = [];

    if (labels.some((label) => label.rawTextLength > 1200)) {
      warnings.push("One or more candidates are longer than 1200 characters.");
    }
    if (labels.some((label) => label.containsMultipleMajorLabels)) {
      warnings.push("One or more candidates contain more than one major label.");
    }
    if (candidates.length < 3 && looseLabelMatchCount >= 3) {
      warnings.push("Segmentation likely failed. Do not trust extraction.");
    }

    return {
      sourceFile: document.sourceFile,
      fullTextCharCount: text.length,
      labelRegexMatchCount: looseLabelMatchCount,
      candidateCount: candidates.length,
      averageCandidateLength: labels.length ? Math.round(totalLength / labels.length) : 0,
      maxCandidateLength,
      warnings,
      labels,
    };
  });
}

export function stripLeadingLabel(rawText: string) {
  return rawText
    .replace(/^\s*(Definition|Theorem|Lemma|Proposition|Corollary|Remark|Example|Assumption|Property|Formula|Equation|Proof|Algorithm)\s*\d*(?:\.\d+)*\s*(?:\[[^\]]+\])?\s*[:.)-]?\s*/i, "")
    .replace(/^\[[^\]]{1,24}\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function labelToType(label: string): RevisionItemType | null {
  const word = label.toLowerCase().replace(/\./g, "");
  if (word === "definition") return "definition";
  if (word === "theorem") return "theorem";
  if (word === "lemma") return "lemma";
  if (word === "proposition") return "proposition";
  if (word === "corollary") return "corollary";
  if (word === "proof") return "proof";
  if (word === "remark") return "remark";
  if (word === "example") return "example";
  if (word === "assumption") return "assumption";
  if (word === "property") return "property";
  if (word === "algorithm") return "algorithm";
  if (word === "formula" || word === "equation") return "formula";
  return null;
}

export function inferCandidateTitle(type: RevisionItemType, number: string | undefined, statement: string) {
  const topic = inferTopic(type, statement);
  const prefix = `${capitalise(type)}${number ? ` ${number}` : ""}`;
  if (topic) return `${prefix}. ${capitalise(topic)}`;
  return prefix;
}

export function inferTopic(type: RevisionItemType, statement: string) {
  const cleaned = statement.replace(/^\[[^\]]{1,24}\]\s*/, "").trim();
  const titled = splitShortLeadingTitle(cleaned);
  if (titled.title) return titled.title;

  if (type === "definition") {
    const match = cleaned.match(/^(?:A|An|The)\s+(.+?)\s+(?:is|are|means|denotes|consists|refers)\b/i);
    if (match) return match[1].replace(/\s+/g, " ").trim();
  }

  if (type === "formula") {
    const match = cleaned.match(/(?:formula|equation)\s+for\s+([^.:;]+)/i);
    if (match) return match[1].trim();
  }

  return undefined;
}

export function countMajorLabels(value: string) {
  const regex = new RegExp(`\\b(${majorLabelWords.join("|")})\\s*(\\d+(?:\\.\\d+)*)?\\s*(?:\\[[^\\]]+\\])?\\s*[\\.:]?`, "g");
  return collectRegexMatches(value, regex).filter((match) => isPlausibleLabelMatch(value, match.index, match.text, match.label, match.number)).length;
}

export function splitShortLeadingTitle(statement: string) {
  const firstSentence = statement.match(/^([^.!?]{2,80})[.!?]\s+([\s\S]+)$/);
  if (!firstSentence) return { title: undefined, statement };
  const candidate = firstSentence[1].trim();
  const words = candidate.split(/\s+/);
  const looksLikeStatement = /\b(is|are|if|then|defined|called|given|equals|denotes)\b/i.test(candidate);
  if (words.length <= 8 && !looksLikeStatement) {
    return { title: candidate, statement: firstSentence[2].trim() };
  }
  return { title: undefined, statement };
}

function collectMarkers(text: string) {
  const markers: Marker[] = [];
  ITEM_LABEL_RE.lastIndex = 0;

  for (const match of text.matchAll(ITEM_LABEL_RE)) {
    const label = normaliseCandidateLabel(match[1] ?? "");
    const start = match.index ?? 0;
    const type = labelToType(label);
    if (!type) continue;
    if (!isPlausibleLabelMatch(text, start, match[0], label, match[2])) continue;
    markers.push({
      kind: "label",
      start,
      end: (match.index ?? 0) + match[0].length,
      label,
      type,
      number: match[2],
    });
  }

  FORMULA_LABEL_RE.lastIndex = 0;
  for (const match of text.matchAll(FORMULA_LABEL_RE)) {
    const label = normaliseCandidateLabel(match[1] ?? "");
    const start = match.index ?? 0;
    if (!isPlausibleLabelMatch(text, start, match[0], label, match[2])) continue;
    markers.push({
      kind: "label",
      start,
      end: start + match[0].length,
      label,
      type: "formula",
      number: match[2],
    });
  }

  markers.push(...collectSectionMarkers(text));
  return markers.sort((a, b) => a.start - b.start || a.end - b.end);
}

function normaliseCandidateLabel(label: string): RevisionCandidateLabel {
  if (label === "Equation") return "Formula";
  if (labelWords.includes(label)) return label as RevisionCandidateLabel;
  return "Other";
}

function isPlausibleLabelMatch(text: string, start: number, matchText: string, label: RevisionCandidateLabel, number?: string) {
  const before = text.slice(Math.max(0, start - 16), start);
  if (/\bof\s+$/i.test(before)) return true;
  const previousChar = text[start - 1];
  const isAtTextStart = start === 0;
  const followsBoundary = !previousChar || /[\s([{:;.?!]/.test(previousChar);
  if (!isAtTextStart && !followsBoundary) return false;

  const matched = matchText.trim();
  const hasTerminator = /[\.:]$/.test(matched);
  const hasBracketTitle = /\[[^\]]+\]$/.test(matched);
  const canBeUnnumbered = ["Remark", "Proof", "Example", "Assumption", "Property", "Algorithm"].includes(label);
  return Boolean(number || hasTerminator || hasBracketTitle || canBeUnnumbered);
}

function collectSectionMarkers(text: string) {
  const markers: Marker[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const leadingWhitespace = line.length - line.trimStart().length;
    const sectionMatch =
      trimmed.match(/^(?:Chapter|Section)\s+\d+(?:\.\d+)*\s*[:.-]?\s+\S/i) ??
      trimmed.match(/^\d+(?:\.\d+)*\s+[A-Z][^\n.]{2,90}$/);
    if (sectionMatch) {
      markers.push({
        kind: "section",
        start: offset + leadingWhitespace,
        end: offset + line.length,
        label: "Other",
      });
    }
    offset += line.length + 1;
  }
  return markers;
}

function buildCandidateFromMarker(document: ParsedDocument, text: string, markers: Marker[], marker: Marker): CandidateRevisionBlock | undefined {
  if (!marker.type) return undefined;
  const next = markers.find((candidate) => candidate.start > marker.start);
  const endOffset = next?.start ?? text.length;
  const rawText = text.slice(marker.start, endOffset).trim();
  if (!rawText) return undefined;
  const statement = clean(stripLeadingLabel(rawText));
  const title = inferCandidateTitle(marker.type, marker.number, statement);
  const extractionWarning = buildCandidateWarning(rawText);

  return {
    id: createId("candidate"),
    label: marker.label,
    type: marker.type,
    number: marker.number,
    title,
    statement,
    startOffset: marker.start,
    endOffset,
    sourceFile: document.sourceFile,
    sourceLocation: marker.number ? `${normalisedLabelName(marker.label)} ${marker.number}` : normalisedLabelName(marker.label),
    pageNumber: pageNumberAtOffset(text, marker.start),
    section: sectionAtOffset(document, marker.start),
    rawText,
    extractionWarning,
  } satisfies CandidateRevisionBlock;
}

function buildCandidateWarning(rawText: string) {
  if (rawText.length > 1200) return "Candidate is longer than 1200 characters and may be over-merged.";
  if (countMajorLabels(rawText) > 1) return "Candidate contains more than one major label.";
  return undefined;
}

function segmentUnlabelledDocument(document: ParsedDocument, text: string): CandidateRevisionBlock[] {
  const chunks = document.sections?.length
    ? document.sections.map((section) => ({
      rawText: section.text,
      startOffset: section.startOffset,
      endOffset: section.endOffset,
      section: section.sectionTitle,
    }))
    : [{ rawText: text.trim(), startOffset: 0, endOffset: text.length, section: undefined }];

  return chunks
    .filter((chunk) => chunk.rawText.trim().length > 0)
    .map((chunk) => ({
      id: createId("candidate"),
      label: "Other",
      type: "other",
      title: "Other",
      rawText: chunk.rawText.trim(),
      statement: clean(chunk.rawText),
      sourceFile: document.sourceFile,
      sourceLocation: chunk.section ?? document.sourceFile,
      pageNumber: pageNumberAtOffset(text, chunk.startOffset),
      section: chunk.section,
      startOffset: chunk.startOffset,
      endOffset: chunk.endOffset,
      extractionWarning: chunk.rawText.length > 1200 ? "Unlabelled candidate is longer than 1200 characters." : undefined,
    }));
}

function collectLooseLabelMatches(text: string) {
  const regex = new RegExp(`\\b(${majorLabelWords.join("|")})\\s*(\\d+(?:\\.\\d+)*)?\\s*(?:\\[[^\\]]+\\])?\\s*[\\.:]?`, "g");
  return collectRegexMatches(text, regex);
}

function collectRegexMatches(text: string, regex: RegExp) {
  return Array.from(text.matchAll(regex)).map((match) => ({
    index: match.index ?? 0,
    text: match[0],
    label: normaliseCandidateLabel(match[1] ?? ""),
    number: match[2],
  }));
}

function pageNumberAtOffset(text: string, offset: number) {
  let pageNumber: number | undefined;
  for (const match of text.matchAll(/\[Page\s+(\d+)\]/gi)) {
    if ((match.index ?? 0) > offset) break;
    pageNumber = Number(match[1]);
  }
  return pageNumber;
}

function sectionAtOffset(document: ParsedDocument, offset: number) {
  const section = document.sections?.find((candidate) => candidate.startOffset <= offset && candidate.endOffset >= offset);
  return section?.sectionTitle;
}

function normalisedLabelName(label: string) {
  const type = labelToType(label);
  return type ? capitalise(type) : capitalise(label.replace(/\./g, ""));
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function clean(value = "") {
  return value.replace(/\s+/g, " ").trim();
}
