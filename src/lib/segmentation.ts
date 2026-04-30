import type { CandidateRevisionBlock, ParsedDocument, RevisionItemType } from "@/lib/types";

type Marker = {
  kind: "label" | "section";
  start: number;
  end: number;
  label: string;
  type?: RevisionItemType;
  number?: string;
};

const labelWords = [
  "Definition",
  "Def\\.?",
  "Theorem",
  "Thm\\.?",
  "Lemma",
  "Proposition",
  "Prop\\.?",
  "Corollary",
  "Remark",
  "Example",
  "Assumption",
  "Property",
  "Formula",
  "Equation",
  "Proof",
];

const labelRegex = new RegExp(
  `(^|[\\n\\r]|[.!?]\\s+|\\]\\s+|\\s{2,})(${labelWords.join("|")})\\s*([A-Za-z]?\\d+(?:\\.\\d+)*)?\\s*[:.)-]?\\s*`,
  "gi",
);

export function segmentRevisionCandidates(document: ParsedDocument): CandidateRevisionBlock[] {
  const text = document.fullText.replace(/\r\n/g, "\n");
  if (!text.trim()) return [];

  const markers = collectMarkers(text);
  const labelledMarkers = markers.filter((marker) => marker.kind === "label" && marker.type);

  return labelledMarkers.map((marker) => {
    const next = markers.find((candidate) => candidate.start > marker.start);
    const endOffset = next?.start ?? text.length;
    const rawText = text.slice(marker.start, endOffset).trim();
    const statement = stripLeadingLabel(rawText);
    const title = inferCandidateTitle(marker.type ?? "other", marker.number, statement);

    return {
      label: marker.label,
      type: marker.type ?? "other",
      number: marker.number,
      title,
      startOffset: marker.start,
      endOffset,
      sourceFile: document.sourceFile,
      sourceLocation: marker.number ? `${normalisedLabelName(marker.label)} ${marker.number}` : normalisedLabelName(marker.label),
      pageNumber: pageNumberAtOffset(text, marker.start),
      section: sectionAtOffset(document, marker.start),
      rawText,
    };
  });
}

export function stripLeadingLabel(rawText: string) {
  return rawText
    .replace(/^\s*(Definition|Def\.?|Theorem|Thm\.?|Lemma|Proposition|Prop\.?|Corollary|Remark|Example|Assumption|Property|Formula|Equation|Proof)\s*[A-Za-z]?\d*(?:\.\d+)*\s*[:.)-]?\s*/i, "")
    .replace(/^\[[^\]]{1,24}\]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function labelToType(label: string): RevisionItemType | null {
  const word = label.toLowerCase().replace(/\./g, "");
  if (word === "definition" || word === "def") return "definition";
  if (word === "theorem" || word === "thm") return "theorem";
  if (word === "lemma") return "lemma";
  if (word === "proposition" || word === "prop") return "proposition";
  if (word === "corollary") return "corollary";
  if (word === "proof") return "proof";
  if (word === "remark") return "remark";
  if (word === "example") return "example";
  if (word === "assumption") return "assumption";
  if (word === "property") return "property";
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
  labelRegex.lastIndex = 0;

  for (const match of text.matchAll(labelRegex)) {
    const prefix = match[1] ?? "";
    const label = match[2] ?? "";
    const start = (match.index ?? 0) + prefix.length;
    const type = labelToType(label);
    if (!type) continue;
    markers.push({
      kind: "label",
      start,
      end: (match.index ?? 0) + match[0].length,
      label,
      type,
      number: match[3],
    });
  }

  markers.push(...collectSectionMarkers(text));
  markers.push(...collectFormulaMarkers(text, markers));
  return markers.sort((a, b) => a.start - b.start || a.end - b.end);
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
        label: trimmed,
      });
    }
    offset += line.length + 1;
  }
  return markers;
}

function collectFormulaMarkers(text: string, existingMarkers: Marker[]) {
  const markers: Marker[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const start = offset + line.length - line.trimStart().length;
    const overlapsExplicitLabel = existingMarkers.some((marker) => marker.kind === "label" && marker.start <= start && marker.end >= start);
    if (!overlapsExplicitLabel && isFormulaLikeLine(trimmed)) {
      markers.push({
        kind: "label",
        start,
        end: offset + line.length,
        label: "Formula",
        type: "formula",
      });
    }
    offset += line.length + 1;
  }
  return markers;
}

function isFormulaLikeLine(text: string) {
  const hasEquals = text.includes("=") || text.includes("\\approx") || text.includes("\\sum");
  const hasMathChars = /[+\-*/^_()[\]{}]/.test(text);
  const hasMathTerms = /\b(var|cov|gamma|sigma|mu|blup|kriging|likelihood)\b/i.test(text);
  return text.length >= 10 && text.length <= 500 && hasEquals && (hasMathChars || hasMathTerms);
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
