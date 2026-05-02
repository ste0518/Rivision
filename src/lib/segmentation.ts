import { createId } from "@/lib/utils";
import type { CandidateRevisionBlock, ParsedDocument, RevisionCandidateKind, RevisionCandidateLabel, RevisionItemType } from "@/lib/types";

type Marker = {
  kind: "label" | "section" | "heading";
  start: number;
  end: number;
  label: RevisionCandidateLabel;
  type?: RevisionItemType;
  candidateKind?: RevisionCandidateKind;
  number?: string;
  headingLevel?: number;
  headingTitle?: string;
};

export const majorLabelWords = [
  "Definition",
  "Theorem",
  "Lemma",
  "Proposition",
  "Corollary",
  "Remark",
  "Example",
  "Question",
  "Assumption",
  "Property",
  "Proof",
  "Algorithm",
];

const labelWords = [...majorLabelWords, "Formula", "Equation"];

export const ITEM_LABEL_RE = new RegExp(
  `\\b(${majorLabelWords.join("|")})\\s*(\\d+(?:\\.\\d+)*)?\\s*(?:\\([^)]+\\))?\\s*(?:\\[[^\\]]+\\])?\\s*[\\.:]?`,
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

  if (labelledMarkers.length === 0) {
    return dedupeCandidates([
      ...segmentUnlabelledDocument(document, text),
      ...segmentHeadingBlocks(document, text, markers),
      ...segmentConceptualDistinctions(document, text),
    ]);
  }

  const labelledCandidates = labelledMarkers
    .map((marker) => buildCandidateFromMarker(document, text, markers, marker))
    .filter((candidate): candidate is CandidateRevisionBlock => Boolean(candidate));
  const headingCandidates = segmentHeadingBlocks(document, text, markers);
  return dedupeCandidates([...labelledCandidates, ...headingCandidates, ...segmentConceptualDistinctions(document, text)]);
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
    .replace(
      /^\s*(Definition|Theorem|Lemma|Proposition|Corollary|Remark|Example|Question|Assumption|Property|Formula|Equation|Proof|Algorithm)\s*\d*(?:\.\d+)*\s*(?:\([^)]+\))?\s*(?:\[[^\]]+\])?\s*[:.)-]?\s*/i,
      "",
    )
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
  if (word === "question") return "example";
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
    const stationarity = cleaned.match(/^(?:A|An|The)\s+[^.!?]{1,80}?\s+is\s+(weakly|strictly|intrinsically|second-order)\s+stationary\s+if\b/i);
    if (stationarity) return `${stationarity[1].replace(/ly$/i, "")} stationarity`;

    const match = cleaned.match(/^(?:A|An|The)\s+([A-Za-z][A-Za-z\s-]{1,60}?)(?:\s*\([^)]{0,120}\)\s*['’]?)?\s+(?:is|are|has|means|denotes|consists|refers)\b/i);
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
  const looksLikeStatement = /\b(is|are|has|if|then|defined|called|given|equals|denotes|consists)\b/i.test(candidate);
  const looksLikeBrokenMath = /[,(]$|[,()]|(?:^|\s)[A-Z][a-z]?\d\b|(?:^|\s)X_?\d\b/.test(candidate);
  const startsLikeStatement = /^(?:A|An|The|Let|Suppose|Assume)\b/i.test(candidate);
  if (words.length <= 8 && !looksLikeStatement && !looksLikeBrokenMath && !startsLikeStatement) {
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
  markers.push(...collectHeadingMarkers(text));
  return markers.sort((a, b) => a.start - b.start || a.end - b.end);
}

function normaliseCandidateLabel(label: string): RevisionCandidateLabel {
  if (label === "Equation") return "Formula";
  if (labelWords.includes(label)) return label as RevisionCandidateLabel;
  return "Other";
}

function isPlausibleLabelMatch(text: string, start: number, matchText: string, label: RevisionCandidateLabel, number?: string) {
  const before = text.slice(Math.max(0, start - 16), start);
  if (/\b(from|see|using|by|as|than)\s+$/i.test(before)) return false;
  if (/\bof\s+$/i.test(before)) return true;
  const previousChar = text[start - 1];
  const isAtTextStart = start === 0;
  const followsBoundary = !previousChar || /[\s([{:;.?!]/.test(previousChar);
  if (!isAtTextStart && !followsBoundary) return false;

  const matched = matchText.trim();
  const hasTerminator = /[\.:]$/.test(matched);
  const hasBracketTitle = /\[[^\]]+\]$/.test(matched);
  const canBeUnnumbered = ["Remark", "Proof", "Example", "Question", "Assumption", "Property", "Algorithm"].includes(label);
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
      trimmed.match(/^\d+(?:\.\d+)*\s+[A-Za-z][^\n]{2,120}$/);
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

function collectHeadingMarkers(text: string) {
  const markers: Marker[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    const leadingWhitespace = line.length - line.trimStart().length;
    if (!trimmed) {
      offset += line.length + 1;
      continue;
    }
    const numericHeading = trimmed.match(/^(\d+(?:\.\d+){1,4})\s+([A-Za-z][A-Za-z0-9(),\- /]{3,120})$/);
    const chapterHeading = trimmed.match(/^(?:Chapter|Section)\s+(\d+(?:\.\d+)*)\s*[:.-]?\s+(.{3,120})$/i);
    const modelHeading = trimmed.match(/^\[(\d+)\]\s+(.{3,120})$/);
    const workedExample = trimmed.match(/^(?:Worked\s+example|Example)\s*[:.-]\s+(.{3,140})$/i);
    const summaryLike = /^(?:Summary(?:\s+and\s+examples)?|Properties\s+and\s+Notation)$/i.test(trimmed);
    if (!numericHeading && !chapterHeading && !modelHeading && !workedExample && !summaryLike) {
      offset += line.length + 1;
      continue;
    }
    const headingTitle = (numericHeading?.[2] ?? chapterHeading?.[2] ?? modelHeading?.[2] ?? workedExample?.[1] ?? trimmed).replace(/\s+/g, " ").trim();
    const headingLevel = numericHeading
      ? numericHeading[1].split(".").length
      : chapterHeading
        ? chapterHeading[1].split(".").length
        : 3;
    markers.push({
      kind: "heading",
      start: offset + leadingWhitespace,
      end: offset + line.length,
      label: "Other",
      headingLevel,
      headingTitle,
      candidateKind: inferHeadingCandidateKind(headingTitle),
      type: inferTypeFromHeadingTitle(headingTitle),
      number: numericHeading?.[1] ?? chapterHeading?.[1] ?? modelHeading?.[1],
    });
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
    candidateKind: marker.candidateKind ?? inferCandidateKind(marker.type, marker.label, statement, marker.headingTitle),
    conceptName: inferCandidateConceptName(statement, marker.headingTitle),
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

function segmentHeadingBlocks(document: ParsedDocument, text: string, markers: Marker[]): CandidateRevisionBlock[] {
  const headingMarkers = markers.filter((marker) => marker.kind === "heading");
  return headingMarkers.flatMap((heading, index) => {
    const next = headingMarkers.slice(index + 1).find((candidate) => (candidate.headingLevel ?? 99) <= (heading.headingLevel ?? 99));
    const endOffset = Math.min(next?.start ?? text.length, heading.start + 3800);
    const rawText = text.slice(heading.start, endOffset).trim();
    if (!rawText || rawText.length < 35) return [];
    const subBlocks = splitLongHeadingBlock(rawText, heading);
    return subBlocks.map((block, blockIndex) => {
      const startOffset = heading.start + block.relativeStart;
      const statement = clean(stripLeadingLabel(block.rawText));
      const type = block.type ?? inferTypeFromHeadingTitle(block.title) ?? "other";
      return {
        id: createId("candidate"),
        label: typeToLabel(type),
        type,
        candidateKind: block.candidateKind ?? inferHeadingCandidateKind(block.title),
        conceptName: inferCandidateConceptName(statement, block.title),
        number: heading.number ? `${heading.number}${subBlocks.length > 1 ? `.${blockIndex + 1}` : ""}` : undefined,
        title: block.title,
        statement,
        startOffset,
        endOffset: Math.min(startOffset + block.rawText.length, endOffset),
        sourceFile: document.sourceFile,
        sourceLocation: block.title,
        pageNumber: pageNumberAtOffset(text, startOffset),
        section: sectionAtOffset(document, startOffset),
        rawText: block.rawText,
        extractionWarning: buildCandidateWarning(block.rawText),
      } satisfies CandidateRevisionBlock;
    });
  });
}

function splitLongHeadingBlock(rawText: string, heading: Marker) {
  if (rawText.length < 1200) {
    return [{
      title: heading.headingTitle ?? "Heading block",
      rawText,
      relativeStart: 0,
      type: heading.type,
      candidateKind: heading.candidateKind,
    }];
  }
  const lines = rawText.split("\n").map((line) => line.trim()).filter(Boolean);
  const breaks: Array<{ index: number; title: string; type: RevisionItemType; candidateKind: RevisionCandidateKind }> = [];
  let runningOffset = 0;
  for (const line of lines) {
    const isModel = /\b(?:MA\(\s*q\s*\)|AR\(\s*p\s*\)|ARMA\(\s*p\s*,\s*q\s*\)|ARCH\(\s*p\s*\)|ARIMA\(\s*p\s*,\s*d\s*,\s*q\s*\)|white noise|general linear process)\b/i.test(line);
    const isCondition = /\b(?:stationarity|invertibility|roots outside the unit circle|condition)\b/i.test(line);
    const isFormula = /[=][^=]|cov\{|var\{|E\{|\\Phi\(B\)|\\Theta\(B\)/.test(line);
    const isWorked = /worked example|example/i.test(line);
    if (isModel || isCondition || isFormula || isWorked) {
      breaks.push({
        index: runningOffset,
        title: line.slice(0, 90),
        type: isFormula ? "formula" : isWorked ? "example" : isCondition ? "property" : "definition",
        candidateKind: isFormula ? "formula" : isWorked ? "calculation_template" : isCondition ? "condition" : "model_definition",
      });
    }
    runningOffset += line.length + 1;
  }
  if (breaks.length < 2) {
    return [{
      title: heading.headingTitle ?? "Heading block",
      rawText: rawText.slice(0, 1800),
      relativeStart: 0,
      type: heading.type,
      candidateKind: heading.candidateKind,
    }];
  }
  const uniqueBreaks = breaks.sort((a, b) => a.index - b.index).filter((value, idx, all) => idx === 0 || value.index - all[idx - 1].index > 120);
  return uniqueBreaks.map((value, idx) => {
    const start = value.index;
    const end = uniqueBreaks[idx + 1]?.index ?? Math.min(rawText.length, start + 900);
    return {
      title: value.title,
      rawText: rawText.slice(start, end).trim(),
      relativeStart: start,
      type: value.type,
      candidateKind: value.candidateKind,
    };
  }).filter((block) => block.rawText.length > 30);
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

function segmentConceptualDistinctions(document: ParsedDocument, text: string): CandidateRevisionBlock[] {
  const candidates: CandidateRevisionBlock[] = [];
  const comparisonRegex = /(?:strict|weak|intrinsic|isotropy|stationarity|covariance|semivariogram|variogram|CAR|SAR|point process|random field|first-order|second-order)[^.!?]{0,180}\b(?:versus|vs\.?|compared with|different from|difference between|whereas|while|not necessarily|implies|equivalent to|if and only if)\b[^.!?]{10,220}[.!?]/gi;

  for (const match of text.matchAll(comparisonRegex)) {
    const rawText = clean(match[0]);
    const startOffset = match.index ?? 0;
    if (rawText.length < 50 || rawText.length > 500) continue;
    candidates.push({
      id: createId("candidate"),
      label: "Other",
      type: "other",
      title: inferConceptualDistinctionTitle(rawText),
      rawText,
      statement: rawText,
      sourceFile: document.sourceFile,
      sourceLocation: inferConceptualDistinctionTitle(rawText),
      pageNumber: pageNumberAtOffset(text, startOffset),
      section: sectionAtOffset(document, startOffset),
      startOffset,
      endOffset: startOffset + rawText.length,
    });
  }

  return candidates;
}

function inferConceptualDistinctionTitle(statement: string) {
  const lower = statement.toLowerCase();
  if (lower.includes("strict") && lower.includes("weak") && lower.includes("stationar")) return "Strict vs weak stationarity";
  if (lower.includes("weak") && lower.includes("intrinsic") && lower.includes("stationar")) return "Weak vs intrinsic stationarity";
  if (lower.includes("isotropy") && lower.includes("stationar")) return "Isotropy vs stationarity";
  if (lower.includes("covariance") && (lower.includes("semivariogram") || lower.includes("variogram"))) return "Covariance vs semivariogram";
  if (lower.includes("car") && lower.includes("sar")) return "CAR vs SAR";
  if (lower.includes("point process") && lower.includes("random field")) return "Point process vs random field";
  if (lower.includes("first-order") && lower.includes("second-order")) return "First-order vs second-order properties";
  return "Conceptual distinction";
}

function collectLooseLabelMatches(text: string) {
  const regex = new RegExp(`\\b(${majorLabelWords.join("|")})\\s*(\\d+(?:\\.\\d+)*)?\\s*(?:\\[[^\\]]+\\])?\\s*[\\.:]?`, "g");
  return collectRegexMatches(text, regex);
}

function inferHeadingCandidateKind(title: string): RevisionCandidateKind {
  const lower = title.toLowerCase();
  if (/\bworked example|example\b/.test(lower)) return "calculation_template";
  if (/\bsummary|notation|table\b/.test(lower)) return "summary_table";
  if (/\bljung-?box|test\b/.test(lower)) return "test_statistic";
  if (/\b(?:ma\(|ar\(|arma|arch|arima|white noise|general linear process)\b/.test(lower)) return "model_definition";
  if (/\bcondition|equivalence|iff|if and only if|roots outside\b/.test(lower)) return "condition";
  if (/\bstationarity|autocovariance|autocorrelation|spectral density|periodogram|tapering|forecasting\b/.test(lower)) return "implicit_definition";
  return "ordinary_text";
}

function inferTypeFromHeadingTitle(title: string): RevisionItemType | undefined {
  const lower = title.toLowerCase();
  if (/\bworked example|example\b/.test(lower)) return "example";
  if (/\btheorem|representation theorem\b/.test(lower)) return "theorem";
  if (/\bcondition|property|equivalence\b/.test(lower)) return "property";
  if (/\bformula|equation|operator|periodogram|density\b/.test(lower)) return "formula";
  if (/\bprocedure|method|diagnostic|test|forecasting\b/.test(lower)) return "algorithm";
  if (/\b(?:ma\(|ar\(|arma|arch|arima|white noise|process)\b/.test(lower)) return "definition";
  if (/\bstationarity|autocovariance|autocorrelation|spectrum\b/.test(lower)) return "definition";
  return undefined;
}

function inferCandidateKind(type: RevisionItemType | undefined, label: RevisionCandidateLabel, statement: string, title?: string): RevisionCandidateKind {
  if (label === "Definition") return "explicit_definition";
  if (label === "Theorem" || label === "Lemma" || label === "Proposition" || label === "Corollary") return "theorem_statement";
  if (label === "Property") return "property";
  if (label === "Formula") return "formula";
  if (label === "Algorithm") return "method";
  if (label === "Example") return "worked_example";
  const lower = `${title ?? ""} ${statement}`.toLowerCase();
  if (/\bif and only if|condition|equivalent\b/.test(lower)) return "condition";
  if (/\bworked example|example\b/.test(lower)) return "calculation_template";
  if (/\bljung-?box|test statistic\b/.test(lower)) return "test_statistic";
  if (/\b(?:ma\(|ar\(|arma|arch|arima|white noise)\b/.test(lower)) return "model_definition";
  if (/\bstrict stationarity|weak stationarity|autocovariance|autocorrelation|spectral density|periodogram\b/.test(lower)) return "implicit_definition";
  if (type === "other") return "ordinary_text";
  return "ordinary_text";
}

function inferCandidateConceptName(statement: string, title?: string) {
  const text = `${title ?? ""} ${statement}`.replace(/\s+/g, " ").trim();
  const pairs: Array<[RegExp, string]> = [
    [/\bcomplete\/strong\/strict stationarity|strict stationarity\b/i, "Strict stationarity"],
    [/\bsecond-order\/weak\/covariance stationarity|weak stationarity|covariance stationarity\b/i, "Second-order stationarity"],
    [/\bautocovariance sequence\b/i, "Autocovariance sequence"],
    [/\bautocorrelation sequence\b/i, "Autocorrelation sequence"],
    [/\bwhite noise process\b/i, "White noise process"],
    [/\bma\(\s*q\s*\)\b/i, "MA(q) process"],
    [/\bar\(\s*p\s*\)\b/i, "AR(p) process"],
    [/\barma\(\s*p\s*,\s*q\s*\)\b/i, "ARMA(p,q) process"],
    [/\barch\(\s*p\s*\)\b/i, "ARCH(p) model"],
    [/\barima\(\s*p\s*,\s*d\s*,\s*q\s*\)\b/i, "ARIMA(p,d,q)"],
    [/\bgeneral linear process\b/i, "General Linear Process"],
    [/\bbackshift operator\b/i, "Backshift operator"],
    [/\bseasonal differencing\b/i, "Seasonal differencing"],
    [/\bdifferencing\b/i, "Differencing"],
    [/\bstationarity condition\b/i, "Stationarity condition"],
    [/\binvertibility condition\b/i, "Invertibility condition"],
    [/\bspectral representation theorem\b/i, "Spectral representation theorem"],
    [/\bintegrated spectrum\b/i, "Integrated spectrum"],
    [/\bspectral density function\b/i, "Spectral density function"],
    [/\bperiodogram\b/i, "Periodogram"],
    [/\bdirect spectral estimator\b/i, "Direct spectral estimator"],
    [/\btapering\b/i, "Tapering"],
    [/\bljung-?box test\b/i, "Ljung-Box test"],
    [/\bforecasting\b/i, "Forecasting"],
  ];
  const matched = pairs.find(([regex]) => regex.test(text));
  if (matched) return matched[1];
  return undefined;
}

function typeToLabel(type: RevisionItemType): RevisionCandidateLabel {
  if (type === "definition") return "Definition";
  if (type === "theorem") return "Theorem";
  if (type === "lemma") return "Lemma";
  if (type === "proposition") return "Proposition";
  if (type === "corollary") return "Corollary";
  if (type === "remark") return "Remark";
  if (type === "example") return "Example";
  if (type === "formula") return "Formula";
  if (type === "assumption") return "Assumption";
  if (type === "property") return "Property";
  if (type === "algorithm") return "Algorithm";
  if (type === "proof") return "Proof";
  return "Other";
}

function dedupeCandidates(candidates: CandidateRevisionBlock[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.type}|${candidate.pageNumber ?? ""}|${(candidate.sourceLocation ?? "").toLowerCase()}|${(candidate.conceptName ?? candidate.title ?? "").toLowerCase()}|${clean(candidate.statement ?? "").toLowerCase().slice(0, 180)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
