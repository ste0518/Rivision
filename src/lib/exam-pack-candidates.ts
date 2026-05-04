/**
 * Raw extraction candidates before any LLM curation (local-first, page/line grounded).
 */

import type { PageRecord } from "@/lib/page-records";

export type RawExamCandidateType =
  | "concept"
  | "formula"
  | "proof"
  | "worked_example"
  | "exercise"
  | "method_template";

export type RawExamPackCandidate = {
  candidateType: RawExamCandidateType;
  rawText: string;
  sourceFile: string;
  sourcePage: number;
  sourceSection?: string;
  startLineIndex: number;
  endLineIndex: number;
  sourceExcerpt: string;
  confidence: number;
  extractionReason: string;
};

const FORMULA_TRIGGERS =
  /[=∫∑√×^_→⇒⇔≤≥∂∇]|\\int|\\sum|\\partial|\\nabla|⟨|⟩|〈|〉|\|\s*\||\|\||\bcov\b|\bvar\b|\bE\s*\{|\bP\s*\(|\blog\b|\bexp\b|\bargmin\b|\bsup\b|\binf\b|\bdet\b|\btr\b|d\s*\/\s*d\s*t|\bgrad\b|\bdiv\b|\bcurl\b/i;

const FORMULA_CONTEXT =
  /\b(defined\s+as|given\s+by|we\s+define|satisfies|where|hence|therefore|model|estimator|likelihood|density|covariance|curvature|transition|differential\s+equation|loss|objective|constraint)\b/i;

const PROOF_START =
  /^(proof|worked\s+example|example)\b|^show\s+that|^check\s+that|^derive\b|^determine\s+whether/i;

const THEOREM_LIKE_START =
  /^(theorem|lemma|proposition|corollary)\s+[\d.]+(?:\s*\([^)]+\))?/i;

function printedLines(p: PageRecord): string[] {
  return p.printedText.split("\n");
}

function countFormulaLikeLinesInPages(pages: PageRecord[]): number {
  let n = 0;
  for (const p of pages) {
    for (const ln of printedLines(p)) {
      const t = ln.trim();
      if (t.length < 6 || t.length > 520) continue;
      if (FORMULA_TRIGGERS.test(t) && (FORMULA_CONTEXT.test(t) || /[=∫∑∂]/.test(t))) n += 1;
      else if (FORMULA_TRIGGERS.test(t) && t.split(/\s+/).length < 22) n += 1;
    }
  }
  return n;
}

function collectProofBlocks(pages: PageRecord[], sourceFile: string): RawExamPackCandidate[] {
  const out: RawExamPackCandidate[] = [];
  for (const p of pages) {
    const lines = printedLines(p);
    for (let i = 0; i < lines.length; i += 1) {
      const t = lines[i]!.trim();
      if (!t) continue;
      if (!PROOF_START.test(t)) continue;
      const buf: string[] = [t];
      let j = i + 1;
      while (j < lines.length && j < i + 80) {
        const u = lines[j]!.trim();
        if (!u) {
          j += 1;
          continue;
        }
        if (/^(theorem|lemma|proposition|definition|chapter|section)\b/i.test(u)) break;
        buf.push(lines[j]!);
        if (buf.join("\n").length > 3500) break;
        j += 1;
      }
      const rawText = buf.join("\n").trim();
      if (rawText.length < 12) continue;
      out.push({
        candidateType: /^example|^worked/i.test(t) ? "worked_example" : "proof",
        rawText: rawText.slice(0, 4000),
        sourceFile,
        sourcePage: p.pageNumber,
        startLineIndex: i,
        endLineIndex: j,
        sourceExcerpt: rawText.slice(0, 420),
        confidence: 0.72,
        extractionReason: "block_starting_with_proof_or_example_marker",
      });
      i = j - 1;
    }
  }
  return out;
}

/** Chains starting Theorem/Lemma/… followed by reasoning or an explicit Proof block (candidate-first, pre-LLM). */
function collectTheoremLedReasoningBlocks(pages: PageRecord[], sourceFile: string): RawExamPackCandidate[] {
  const out: RawExamPackCandidate[] = [];
  for (const p of pages) {
    const lines = printedLines(p);
    for (let i = 0; i < lines.length; i += 1) {
      const t = lines[i]!.trim();
      if (!t || !THEOREM_LIKE_START.test(t)) continue;
      const buf: string[] = [t];
      let j = i + 1;
      let sawProof = false;
      let reasoningScore = 0;
      while (j < lines.length && j < i + 120) {
        const u = lines[j]!.trim();
        if (!u) {
          j += 1;
          continue;
        }
        if (/^(theorem|lemma|proposition|corollary|definition)\s+[\d.]+/i.test(u) && buf.length > 1) break;
        if (/^Chapter\s*\d/i.test(u)) break;
        if (/^Proof[.:]?\b/i.test(u)) sawProof = true;
        if (/^(hence|therefore|thus|it\s+follows|we\s+have|observe\s+that)\b/i.test(u)) reasoningScore += 1;
        if (/[=∫∑∂]/.test(u) && u.length < 400) reasoningScore += 1;
        buf.push(lines[j]!);
        if (sawProof && /^Proof[.:]?\b/i.test(u) === false && buf.length > 8 && u.length > 200 && /^(example|exercise)\b/i.test(u)) break;
        if (buf.join("\n").length > 4500) break;
        j += 1;
        if (sawProof && j - i > 6 && reasoningScore >= 2 && u.length < 12) break;
      }
      const rawText = buf.join("\n").trim();
      if (rawText.length < 40) continue;
      if (!sawProof && reasoningScore < 3) continue;
      out.push({
        candidateType: "proof",
        rawText: rawText.slice(0, 4500),
        sourceFile,
        sourcePage: p.pageNumber,
        startLineIndex: i,
        endLineIndex: j,
        sourceExcerpt: rawText.slice(0, 420),
        confidence: sawProof ? 0.74 : 0.55,
        extractionReason: sawProof ? "theorem_or_lemma_then_proof_block" : "theorem_or_lemma_then_reasoning_chain",
      });
      i = Math.max(i, j - 1);
    }
  }
  return dedupeRaw(out, 120);
}

function collectExerciseStemBlocks(pages: PageRecord[], sourceFile: string): RawExamPackCandidate[] {
  const out: RawExamPackCandidate[] = [];
  const STEM = /^(exercise|problem|question)\s+[\d.]+[.:)]?\s+/i;
  for (const p of pages) {
    const lines = printedLines(p);
    for (let i = 0; i < lines.length; i += 1) {
      const t = lines[i]!.trim();
      if (!t || !STEM.test(t)) continue;
      const buf: string[] = [t];
      let j = i + 1;
      while (j < lines.length && j < i + 45) {
        const u = lines[j]!.trim();
        if (!u) {
          j += 1;
          continue;
        }
        if (STEM.test(u) && buf.length > 1) break;
        if (/^(theorem|lemma|proof|chapter|section)\b/i.test(u)) break;
        buf.push(lines[j]!);
        if (buf.join("\n").length > 2800) break;
        j += 1;
      }
      const rawText = buf.join("\n").trim();
      if (rawText.length < 16) continue;
      out.push({
        candidateType: "exercise",
        rawText: rawText.slice(0, 3000),
        sourceFile,
        sourcePage: p.pageNumber,
        startLineIndex: i,
        endLineIndex: j,
        sourceExcerpt: rawText.slice(0, 400),
        confidence: 0.68,
        extractionReason: "exercise_problem_question_stem_block",
      });
      i = j - 1;
    }
  }
  return dedupeRaw(out, 200);
}

function collectFormulaLineCandidates(pages: PageRecord[], sourceFile: string): RawExamPackCandidate[] {
  const out: RawExamPackCandidate[] = [];
  for (const p of pages) {
    const lines = printedLines(p);
    lines.forEach((line, lineIndex) => {
      const t = line.trim();
      if (t.length < 8 || t.length > 500) return;
      if (!FORMULA_TRIGGERS.test(t)) return;
      if (/^[=≤≥<>]/.test(t)) return;
      out.push({
        candidateType: "formula",
        rawText: t,
        sourceFile,
        sourcePage: p.pageNumber,
        startLineIndex: lineIndex,
        endLineIndex: lineIndex + 1,
        sourceExcerpt: t.slice(0, 400),
        confidence: FORMULA_CONTEXT.test(t) ? 0.78 : 0.55,
        extractionReason: "formula_like_printed_line",
      });
    });
  }
  return dedupeRaw(out, 2500);
}

function dedupeRaw(items: RawExamPackCandidate[], max: number): RawExamPackCandidate[] {
  const seen = new Set<string>();
  const out: RawExamPackCandidate[] = [];
  for (const x of items) {
    const k = `${x.sourcePage}|${x.startLineIndex}|${x.rawText.slice(0, 80)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

export type RawExamPackCandidateBuckets = {
  conceptCandidates: RawExamPackCandidate[];
  formulaCandidates: RawExamPackCandidate[];
  proofCandidates: RawExamPackCandidate[];
  workedExampleCandidates: RawExamPackCandidate[];
  exerciseCandidates: RawExamPackCandidate[];
  methodTemplateCandidates: RawExamPackCandidate[];
  formulaLineScanCount: number;
};

export function extractRawExamPackCandidates(sourceFile: string, pages: PageRecord[]): RawExamPackCandidateBuckets {
  const formulaLineScanCount = countFormulaLikeLinesInPages(pages);
  const proofBlocks = collectProofBlocks(pages, sourceFile);
  const theoremLed = collectTheoremLedReasoningBlocks(pages, sourceFile);
  const formulaLines = collectFormulaLineCandidates(pages, sourceFile);
  const exercises = collectExerciseStemBlocks(pages, sourceFile);
  const proofs = [...proofBlocks.filter((c) => c.candidateType === "proof"), ...theoremLed];
  const worked = proofBlocks.filter((c) => c.candidateType === "worked_example");

  return {
    conceptCandidates: [],
    formulaCandidates: formulaLines,
    proofCandidates: dedupeRaw(proofs, 400),
    workedExampleCandidates: worked,
    exerciseCandidates: exercises,
    methodTemplateCandidates: [],
    formulaLineScanCount,
  };
}

export function countProofLikeLineMarkers(pages: PageRecord[]): number {
  let n = 0;
  for (const p of pages) {
    for (const ln of printedLines(p)) {
      const t = ln.trim();
      if (PROOF_START.test(t) || THEOREM_LIKE_START.test(t) || /^lemma\s+\d|^theorem\s+\d|^proposition\s+\d|^corollary\s+\d/i.test(t)) {
        n += 1;
      }
    }
  }
  return n;
}
