/**
 * Raw extraction candidates before any LLM curation (local-first, page/line grounded).
 */

import type { PageRecord } from "@/lib/page-records";

export type RawExamCandidateType =
  | "concept"
  | "definition"
  | "theorem"
  | "formula"
  | "proof"
  | "worked_example"
  | "exercise"
  | "method_template";

export type RawCandidateCleanupStatus = "ok" | "needs_review" | "failed";

export type FormulaCandidateKind = "raw_equation" | "formula_name" | "concept_formula" | "broken_math";

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
  cleanupStatus?: RawCandidateCleanupStatus;
  /** When {@link candidateType} is formula — how to use downstream (formula sheet vs method templates). */
  formulaKind?: FormulaCandidateKind;
};

const FORMULA_TRIGGERS =
  /[=∫∑√×^_→⇒⇔≤≥≈∝∂∇]|\\int|\\sum|\\partial|\\nabla|⟨|⟩|〈|〉|\|\s*\||\|\||\bcov\b|\bvar\b|\bVar\b|\bstd\b|\bMSE\b|\bRMSE\b|\bRAE\b|\bE\s*\{|\bE\s*\[|\bP\s*\(|\blog\b|\bexp\b|\bargmin\b|\bargmax\b|\bsup\b|\binf\b|\bdet\b|\btr\b|d\s*\/\s*d\s*t|\bgrad\b|\bdiv\b|\bcurl\b|[φϕδσμλπ]/u;

const FORMULA_CONTEXT =
  /\b(defined\s+as|given\s+by|we\s+define|satisfies|where|hence|therefore|model|estimator|likelihood|density|prior|posterior|covariance|curvature|transition|kernel|differential\s+equation|loss|objective|constraint|theorem|proposition)\b/i;

const PROOF_START =
  /^(proof|worked\s+example|example)\b|^show\s+that|^check\s+that|^derive\b|^determine\s+whether/i;

const THEOREM_LIKE_START =
  /^(theorem|lemma|proposition|corollary)\s+[\d.]+(?:\s*\([^)]+\))?/i;

/** Stops a proof / derivation block before the next structural unit. */
function isProofBoundary(u: string): boolean {
  return (
    /^(theorem|lemma|proposition|corollary|definition|remark|example|exercise|question|algorithm)\s+[\d.]+/i.test(u) ||
    /^(theorem|lemma|proposition|corollary|definition|remark|example|exercise|question|algorithm)\b/i.test(u) ||
    /^Proof[.:]?\b/i.test(u) ||
    /^Chapter\s*\d/i.test(u) ||
    /^Section\s+\d/i.test(u) ||
    /** Major numbered section banner "3 Introduction" (top-level, not 3.1). */
    (/^\d{1,2}\s+[A-Za-z\u00C0-\u024F(]/.test(u) && !/^\d+\.\d/.test(u) && u.length < 140) ||
    /^\d+\.\d+\.\d+\.\d+\s+\S/.test(u) ||
    /^\d+\.\d+\.\d+\s+\S/.test(u) ||
    /^\d+\.\d+\s+\S/.test(u)
  );
}

function classifyFormulaLineKind(t: string): FormulaCandidateKind {
  const s = t.trim();
  if (/\b(therfore|varience|poputation|fii+i+n|Dopulation)\b/i.test(s)) return "broken_math";
  const letters = (s.match(/[A-Za-z]/g) ?? []).length;
  const digits = (s.match(/\d/g) ?? []).length;
  if (s.length > 12 && digits / Math.max(1, s.length) > 0.42 && letters < 4) return "broken_math";
  const eqHeavy = /[=∫∑∂∇√]/.test(s) || /\\frac|\\sum|\\int|\\partial|\\nabla|\\mathbb|\\mathrm|\\hat|\\bar/.test(s);
  const words = (s.match(/[A-Za-z]{4,}/g) ?? []).length;
  if (eqHeavy && s.length < 520) return "raw_equation";
  if (words >= 1 && words <= 8 && s.length < 110 && !eqHeavy) return "formula_name";
  return "concept_formula";
}

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
      while (j < lines.length && j < i + 120) {
        const u = lines[j]!.trim();
        if (!u) {
          j += 1;
          continue;
        }
        if (j > i && isProofBoundary(u)) break;
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
        cleanupStatus: "ok",
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
        if (buf.length > 1 && /^(theorem|lemma|proposition|corollary|definition|remark|example|exercise|question|algorithm)\s+[\d.]+/i.test(u)) break;
        if (/^Chapter\s*\d/i.test(u)) break;
        if (/^Remark[.:]?\b/i.test(u) && buf.length > 3) break;
        if (/^Example\s*\d/i.test(u) && buf.length > 4) break;
        if (/^Exercise\s*\d/i.test(u) && buf.length > 4) break;
        if (/^Question\s*\d/i.test(u) && buf.length > 4) break;
        if (/^Algorithm\s*\d/i.test(u) && buf.length > 4) break;
        if (/^\d+\.\d+\s+\S/.test(u) && buf.length > 6) break;
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
        cleanupStatus: sawProof ? "ok" : "needs_review",
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
        cleanupStatus: "ok",
      });
      i = j - 1;
    }
  }
  return dedupeRaw(out, 200);
}

const DEF_START = /^Definition\s+[\d.]+/i;
const THM_START = /^(Theorem|Proposition|Lemma|Corollary)\s+[\d.]+/i;
const ALGO_START = /^Algorithm\s+[\d.]+/i;

function collectLabelledStatementBlocks(
  pages: PageRecord[],
  sourceFile: string,
  kind: "definition" | "theorem",
): RawExamPackCandidate[] {
  const re = kind === "definition" ? DEF_START : THM_START;
  const out: RawExamPackCandidate[] = [];
  for (const p of pages) {
    const lines = printedLines(p);
    for (let i = 0; i < lines.length; i += 1) {
      const t = lines[i]!.trim();
      if (!re.test(t)) continue;
      const buf: string[] = [t];
      let j = i + 1;
      while (j < lines.length && j < i + 35) {
        const u = lines[j]!.trim();
        if (!u) {
          j += 1;
          continue;
        }
        if (j > i + 1 && (DEF_START.test(u) || THM_START.test(u) || /^Proof[.:]?\b/i.test(u))) break;
        buf.push(lines[j]!);
        if (buf.join("\n").length > 2800) break;
        j += 1;
      }
      const rawText = buf.join("\n").trim();
      if (rawText.length < 20) continue;
      out.push({
        candidateType: kind,
        rawText: rawText.slice(0, 3200),
        sourceFile,
        sourcePage: p.pageNumber,
        startLineIndex: i,
        endLineIndex: j,
        sourceExcerpt: rawText.slice(0, 400),
        confidence: 0.7,
        extractionReason: kind === "definition" ? "definition_labelled_block" : "theorem_like_labelled_block",
        cleanupStatus: "ok",
      });
      i = j - 1;
    }
  }
  return dedupeRaw(out, 200);
}

function collectAlgorithmMethodTemplates(pages: PageRecord[], sourceFile: string): RawExamPackCandidate[] {
  const out: RawExamPackCandidate[] = [];
  for (const p of pages) {
    const lines = printedLines(p);
    for (let i = 0; i < lines.length; i += 1) {
      const t = lines[i]!.trim();
      if (!ALGO_START.test(t)) continue;
      const buf: string[] = [t];
      let j = i + 1;
      while (j < lines.length && j < i + 55) {
        const u = lines[j]!.trim();
        if (!u) {
          j += 1;
          continue;
        }
        if (j > i + 2 && (DEF_START.test(u) || THM_START.test(u) || ALGO_START.test(u))) break;
        buf.push(lines[j]!);
        if (buf.join("\n").length > 4000) break;
        j += 1;
      }
      const rawText = buf.join("\n").trim();
      if (rawText.length < 24) continue;
      out.push({
        candidateType: "method_template",
        rawText: rawText.slice(0, 4000),
        sourceFile,
        sourcePage: p.pageNumber,
        startLineIndex: i,
        endLineIndex: j,
        sourceExcerpt: rawText.slice(0, 420),
        confidence: 0.66,
        extractionReason: "algorithm_block",
        cleanupStatus: "ok",
      });
      i = j - 1;
    }
  }
  return dedupeRaw(out, 80);
}

const EX_OR_Q_START = /^(Example|Exercise|Question)\s+[\d.]+/i;
const SOLUTION_LINE = /^Solution[.:]?\b/i;

/** Example / Exercise / Question immediately followed by Solution → worked-example candidate. */
function collectExampleSolutionPairs(pages: PageRecord[], sourceFile: string): RawExamPackCandidate[] {
  const out: RawExamPackCandidate[] = [];
  for (const p of pages) {
    const lines = printedLines(p);
    for (let i = 0; i < lines.length; i += 1) {
      const t = lines[i]!.trim();
      if (!EX_OR_Q_START.test(t)) continue;
      let sol = -1;
      for (let j = i + 1; j < lines.length && j < i + 40; j += 1) {
        const u = lines[j]!.trim();
        if (/^(Theorem|Lemma|Definition|Proposition|Chapter)\b/i.test(u)) break;
        if (EX_OR_Q_START.test(u)) break;
        if (SOLUTION_LINE.test(u)) {
          sol = j;
          break;
        }
      }
      if (sol < 0) continue;
      const buf: string[] = [];
      let endLine = sol;
      for (let k = i; k < lines.length && k < sol + 50; k += 1) {
        const u = lines[k]!.trim();
        if (k > sol + 2 && buf.length > 2 && isProofBoundary(u)) break;
        buf.push(lines[k]!);
        endLine = k;
        if (buf.join("\n").length > 4000) break;
      }
      const rawText = buf.join("\n").trim();
      if (rawText.length < 24) continue;
      out.push({
        candidateType: "worked_example",
        rawText: rawText.slice(0, 4000),
        sourceFile,
        sourcePage: p.pageNumber,
        startLineIndex: i,
        endLineIndex: endLine + 1,
        sourceExcerpt: rawText.slice(0, 420),
        confidence: 0.75,
        extractionReason: "example_or_exercise_then_solution",
        cleanupStatus: "ok",
      });
      i = endLine;
    }
  }
  return dedupeRaw(out, 120);
}

function collectFormulaLineCandidates(pages: PageRecord[], sourceFile: string): RawExamPackCandidate[] {
  const out: RawExamPackCandidate[] = [];
  for (const p of pages) {
    const lines = printedLines(p);
    let lineIndex = 0;
    while (lineIndex < lines.length) {
      const line = lines[lineIndex]!;
      const t = line.trim();
      if (t.length < 8 || t.length > 500 || !FORMULA_TRIGGERS.test(t) || /^[=≤≥<>]/.test(t)) {
        lineIndex += 1;
        continue;
      }
      const buf: string[] = [t];
      let end = lineIndex + 1;
      while (end < lines.length && end < lineIndex + 8) {
        const u = lines[end]!.trim();
        if (!u) break;
        if (!FORMULA_TRIGGERS.test(u) && !/^[=+\-]/.test(u)) break;
        if (u.length > 500) break;
        buf.push(u);
        end += 1;
      }
      const rawText = buf.join("\n").trim();
      const formulaKind = classifyFormulaLineKind(rawText);
      out.push({
        candidateType: "formula",
        rawText,
        sourceFile,
        sourcePage: p.pageNumber,
        startLineIndex: lineIndex,
        endLineIndex: end,
        sourceExcerpt: rawText.slice(0, 400),
        confidence: FORMULA_CONTEXT.test(rawText) ? 0.78 : 0.55,
        extractionReason: "formula_like_printed_line",
        cleanupStatus: rawText.length > 200 || formulaKind === "broken_math" ? "needs_review" : "ok",
        formulaKind,
      });
      lineIndex = end;
    }
  }
  return dedupeRaw(out, 2500);
}

const INFORMAL_CONCEPT = /\b(we\s+define|recall\s+that|throughout\s+we\s+assume|throughout\s+this)\b/i;

function collectInformalConceptLines(pages: PageRecord[], sourceFile: string): RawExamPackCandidate[] {
  const out: RawExamPackCandidate[] = [];
  for (const p of pages) {
    const lines = printedLines(p);
    lines.forEach((line, lineIndex) => {
      const t = line.trim();
      if (t.length < 24 || t.length > 320) return;
      if (!INFORMAL_CONCEPT.test(t)) return;
      if (DEF_START.test(t) || THM_START.test(t)) return;
      out.push({
        candidateType: "concept",
        rawText: t,
        sourceFile,
        sourcePage: p.pageNumber,
        startLineIndex: lineIndex,
        endLineIndex: lineIndex + 1,
        sourceExcerpt: t.slice(0, 360),
        confidence: 0.52,
        extractionReason: "informal_definition_or_recall_line",
        cleanupStatus: "needs_review",
      });
    });
  }
  return dedupeRaw(out, 200);
}

function dedupeRaw(items: RawExamPackCandidate[], max: number): RawExamPackCandidate[] {
  const seen = new Set<string>();
  const out: RawExamPackCandidate[] = [];
  for (const x of items) {
    const k = `${x.sourcePage}|${x.startLineIndex}|${x.candidateType}|${x.rawText.slice(0, 80)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (out.length >= max) break;
  }
  return out;
}

export type RawExamPackCandidateBuckets = {
  conceptCandidates: RawExamPackCandidate[];
  definitionCandidates: RawExamPackCandidate[];
  theoremCandidates: RawExamPackCandidate[];
  formulaCandidates: RawExamPackCandidate[];
  proofCandidates: RawExamPackCandidate[];
  workedExampleCandidates: RawExamPackCandidate[];
  exerciseCandidates: RawExamPackCandidate[];
  methodTemplateCandidates: RawExamPackCandidate[];
  formulaLineScanCount: number;
  /** Count of formula rows classified as display/equation-like (not names-only). */
  formulaRawEquationCount: number;
};

export function extractRawExamPackCandidates(sourceFile: string, pages: PageRecord[]): RawExamPackCandidateBuckets {
  const formulaLineScanCount = countFormulaLikeLinesInPages(pages);
  const proofBlocks = collectProofBlocks(pages, sourceFile);
  const theoremLed = collectTheoremLedReasoningBlocks(pages, sourceFile);
  const formulaLines = collectFormulaLineCandidates(pages, sourceFile);
  const exercises = collectExerciseStemBlocks(pages, sourceFile);
  const definitions = collectLabelledStatementBlocks(pages, sourceFile, "definition");
  const theorems = collectLabelledStatementBlocks(pages, sourceFile, "theorem");
  const methods = collectAlgorithmMethodTemplates(pages, sourceFile);
  const exampleSolutionWorked = collectExampleSolutionPairs(pages, sourceFile);
  const proofs = [...proofBlocks.filter((c) => c.candidateType === "proof"), ...theoremLed];
  const worked = [...proofBlocks.filter((c) => c.candidateType === "worked_example"), ...exampleSolutionWorked];

  const conceptCandidates = collectInformalConceptLines(pages, sourceFile);

  const formulaRawEquationCount = formulaLines.filter((f) => f.formulaKind === "raw_equation").length;

  return {
    conceptCandidates,
    definitionCandidates: definitions,
    theoremCandidates: theorems,
    formulaCandidates: formulaLines,
    proofCandidates: dedupeRaw(proofs, 400),
    workedExampleCandidates: dedupeRaw(worked, 200),
    exerciseCandidates: exercises,
    methodTemplateCandidates: methods,
    formulaLineScanCount,
    formulaRawEquationCount,
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
