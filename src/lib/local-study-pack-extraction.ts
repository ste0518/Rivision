/**
 * Local heuristic extraction for the student-facing Study Pack (no APIs).
 * Parses labelled mathematical blocks, sections, formulas, proofs, and methods.
 */

import { mathStatusFromValidation, validateLatexSnippet } from "@/lib/latex-validate";
import { convertCommonMathToLatex } from "@/lib/revision-item-utils";
import type {
  DefinitionImportance,
  GeneratedCommonMistake,
  GeneratedCourseTopic,
  GeneratedCramSheet,
  GeneratedDefinitionItem,
  GeneratedFormulaItem,
  GeneratedMethodTemplate,
  GeneratedPastPaperPattern,
  GeneratedProofItem,
  GeneratedRevisionPack,
  StudyPackEntryKind,
  TopicImportance,
} from "@/lib/student-revision-schema";
import type { StudyFileRole } from "@/lib/types";
import { createId } from "@/lib/utils";
/** Mirrors {@link PackSourceFile} without importing revision-pack-generator (avoid circular deps). */
export type LecturePackFile = {
  id: string;
  name: string;
  role?: StudyFileRole;
  parsedText?: string;
};

export type PackGeneratorSettings = {
  revisionStyle: "concise_exam" | "detailed_guide" | "flashcard_heavy" | "problem_heavy";
  aiStrictness: "conservative" | "balanced" | "broad";
};

export type PackItemKind =
  | "definition"
  | "theorem"
  | "proposition"
  | "lemma"
  | "corollary"
  | "example"
  | "exercise"
  | "remark"
  | "algorithm"
  | "formula"
  | "proof";

export type ExtractedSection = {
  sectionNumber: string;
  title: string;
  startOffset: number;
};

export type LabelledBlock = {
  kind: PackItemKind;
  formalLabel: string;
  number: string;
  parenTitle?: string;
  displayTitle: string;
  body: string;
  rawBlock: string;
  sourceFile: string;
  sourcePage?: number;
  sourceSection?: string;
  startOffset: number;
  importance: DefinitionImportance;
};

const LABELLED_HEAD = new RegExp(
  [
    "(?:^|\\n)\\s*",
    "(Definition|Theorem|Proposition|Lemma|Corollary|Example|Exercise|Remark|Algorithm)",
    "\\s+",
    "(\\d+(?:\\.\\d+)*)",
    "\\s*",
    "(?:\\(([^)]+)\\))?",
    "\\s*",
    "(?:\\[[^\\]]+\\])?",
    "\\s*",
    "(?:[:.]\\s*)?",
  ].join(""),
  "gim",
);

const PROOF_HEAD = /(?:^|\n)\s*Proof\s*[.:]\s*/gim;

const CORE_IDEA_PLACEHOLDER = /^Core idea\s+\d+$/i;

function pageAtOffset(fullText: string, offset: number): number | undefined {
  let pageNumber: number | undefined;
  for (const match of fullText.matchAll(/\[Page\s+(\d+)\]/gi)) {
    if ((match.index ?? 0) > offset) break;
    pageNumber = Number(match[1]);
  }
  return pageNumber;
}

/** Extract section headings like "4.1 Discrete state space Markov chains". */
export function extractSectionHeadings(text: string): ExtractedSection[] {
  const sections: ExtractedSection[] = [];
  let offset = 0;
  for (const line of text.split("\n")) {
    const leading = line.length - line.trimStart().length;
    const trimmed = line.trim();
    const m = trimmed.match(/^(\d+(?:\.\d+)+)\s+(.{3,200})$/);
    if (m) {
      const rest = m[2].trim();
      if (!/^(definition|theorem|lemma|proposition|corollary|remark|example|proof|algorithm)\b/i.test(rest)) {
        sections.push({
          sectionNumber: m[1],
          title: rest,
          startOffset: offset + leading,
        });
      }
    }
    offset += line.length + 1;
  }
  return sections;
}

function sectionForOffset(sections: ExtractedSection[], offset: number): string | undefined {
  let best: ExtractedSection | undefined;
  for (const s of sections) {
    if (s.startOffset <= offset && (!best || s.startOffset > best.startOffset)) best = s;
  }
  if (!best) return undefined;
  return `${best.sectionNumber} ${best.title}`;
}

function kindFromWord(word: string): PackItemKind {
  const w = word.toLowerCase();
  if (w === "definition") return "definition";
  if (w === "theorem") return "theorem";
  if (w === "proposition") return "proposition";
  if (w === "lemma") return "lemma";
  if (w === "corollary") return "corollary";
  if (w === "example") return "example";
  if (w === "exercise") return "exercise";
  if (w === "remark") return "remark";
  if (w === "algorithm") return "algorithm";
  return "definition";
}

function importanceForKind(kind: PackItemKind): DefinitionImportance {
  if (kind === "definition" || kind === "theorem" || kind === "proposition" || kind === "lemma" || kind === "algorithm") return "must_know";
  if (kind === "corollary" || kind === "example") return "high";
  if (kind === "remark" || kind === "exercise") return "medium";
  return "high";
}

function titleForBlock(kind: PackItemKind, parenTitle: string | undefined, body: string): string {
  if (parenTitle?.trim()) return parenTitle.trim().replace(/\s+/g, " ");
  const first = body.replace(/^\s+/, "").split(/(?<=[.!?])\s+/)[0] ?? body;
  const sentence = first.length > 140 ? `${first.slice(0, 137)}…` : first;
  if (sentence.length >= 12 && sentence.length < 160) return sentence.replace(/\s+/g, " ").trim();
  return `${kind} statement`;
}

function extractLabelledBlocks(fullText: string, sourceFile: string, sections: ExtractedSection[]): LabelledBlock[] {
  const text = fullText.replace(/\r\n/g, "\n");
  const hits: Array<{ index: number; headerLen: number; kind: string; number: string; paren?: string }> = [];
  LABELLED_HEAD.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LABELLED_HEAD.exec(text)) !== null) {
    hits.push({
      index: m.index,
      headerLen: m[0].length,
      kind: m[1] ?? "",
      number: m[2] ?? "",
      paren: m[3]?.trim(),
    });
  }

  const blocks: LabelledBlock[] = [];
  for (let i = 0; i < hits.length; i += 1) {
    const cur = hits[i]!;
    const next = hits[i + 1];
    const bodyStart = cur.index + cur.headerLen;
    const end = next ? next.index : text.length;
    const rawBlock = text.slice(cur.index, end).trim();
    const body = text.slice(bodyStart, end).trim();
    if (body.length < 8 && rawBlock.length < 15) continue;

    const kind = kindFromWord(cur.kind);
    const formalLabel = `${cur.kind} ${cur.number}`;
    const displayTitle = titleForBlock(kind, cur.paren, body);
    const offset = cur.index;
    blocks.push({
      kind,
      formalLabel,
      number: cur.number,
      parenTitle: cur.paren,
      displayTitle,
      body,
      rawBlock,
      sourceFile,
      sourcePage: pageAtOffset(text, offset),
      sourceSection: sectionForOffset(sections, offset),
      startOffset: offset,
      importance: importanceForKind(kind),
    });
  }
  return blocks;
}

/** Strip duplicate header line from proof body if present. */
function extractProofBlocks(fullText: string, sourceFile: string, sections: ExtractedSection[]): LabelledBlock[] {
  const text = fullText.replace(/\r\n/g, "\n");
  const out: LabelledBlock[] = [];
  PROOF_HEAD.lastIndex = 0;
  let pm: RegExpExecArray | null;
  const proofMatches: Array<{ start: number; contentStart: number }> = [];
  while ((pm = PROOF_HEAD.exec(text)) !== null) {
    const contentStart = pm.index + pm[0].length;
    proofMatches.push({ start: pm.index, contentStart });
  }
  for (let i = 0; i < proofMatches.length; i += 1) {
    const cur = proofMatches[i]!;
    const next = proofMatches[i + 1];
    const after = next ? next.start : text.length;
    const body = text.slice(cur.contentStart, after).trim();
    if (body.length < 15) continue;
    out.push({
      kind: "proof",
      formalLabel: "Proof",
      number: "",
      displayTitle: `Proof (${pageAtOffset(text, cur.start) ?? "notes"})`,
      body,
      rawBlock: text.slice(cur.start, after).trim(),
      sourceFile,
      sourcePage: pageAtOffset(text, cur.start),
      sourceSection: sectionForOffset(sections, cur.start),
      startOffset: cur.start,
      importance: "high",
    });
  }
  return out;
}

function jaccardSimilarity(a: string, b: string): number {
  const ta = new Set(
    a
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  const tb = new Set(
    b
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2),
  );
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

function normalizeTitleKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(theorem|definition|proposition|lemma|corollary|remark|example)\b/g, "")
    .trim();
}

export function dedupeLabelledBlocks(blocks: LabelledBlock[]): LabelledBlock[] {
  const byKey = new Map<string, LabelledBlock>();
  for (const b of blocks) {
    const key =
      b.kind === "proof"
        ? `proof|${b.sourceFile}|${b.startOffset}`
        : `${b.sourceFile}|${b.formalLabel}`.toLowerCase();
    const prev = byKey.get(key);
    if (!prev || scoreBlock(b) > scoreBlock(prev)) byKey.set(key, b);
  }
  const merged = Array.from(byKey.values());
  const final: LabelledBlock[] = [];
  for (const b of merged) {
    const dupIdx = final.findIndex(
      (e) =>
        e.kind === b.kind &&
        normalizeTitleKey(e.displayTitle) === normalizeTitleKey(b.displayTitle) &&
        normalizeTitleKey(b.displayTitle).length > 6 &&
        jaccardSimilarity(e.body, b.body) > 0.72,
    );
    if (dupIdx >= 0) {
      if (scoreBlock(b) > scoreBlock(final[dupIdx]!)) final[dupIdx] = b;
      continue;
    }
    const nearIdx = final.findIndex((e) => e.kind === b.kind && jaccardSimilarity(e.body, b.body) > 0.9);
    if (nearIdx >= 0) {
      if (scoreBlock(b) > scoreBlock(final[nearIdx]!)) final[nearIdx] = b;
      continue;
    }
    final.push(b);
  }
  return final;
}

function scoreBlock(b: LabelledBlock): number {
  let s = b.body.length;
  if (b.importance === "must_know") s += 200;
  if (b.formalLabel && b.formalLabel !== "Proof") s += 100;
  if (b.parenTitle) s += 50;
  return s;
}

/** PDF / OCR cleanup for math-heavy notes; conservative — formatting only. */
export function normalizeMathText(text: string): string {
  let t = text.replace(/\r\n/g, "\n");
  t = t.replace(/\uFFFE|\u0000/g, "");
  t = t.replace(/\\\(\s*\\\(/g, "\\(").replace(/\\\)\s*\\\)/g, "\\)");
  t = t.replace(/\\?\(([^)]*)\\?\)\s*\)\s*n\s*([≥≥>=])\s*0/gi, (_, inner: string, rel: string) => {
    const ge = rel.includes(">") ? "\\ge 0" : rel;
    return `\\( (${inner.trim()})_{n ${ge}} \\)`;
  });
  t = t.replace(/\(\s*X\s*_?\s*n\s*\)\s*\)\s*n\s*[≥>=]\s*0/gi, "\\( (X_n)_{n \\ge 0} \\)");
  t = t.replace(/\(X\s*n\)\s*n\s*[≥>=]\s*0/gi, "\\( (X_n)_{n \\ge 0} \\)");
  t = t.replace(/\bM\s*_?\s*ij\b/gi, "\\( M_{ij} \\)");
  t = t.replace(/\bM\s*_?\s*ji\b/gi, "\\( M_{ji} \\)");
  t = t.replace(/\bp\s*_?\s*n\b(?![a-z])/gi, "\\( p_n \\)");
  t = t.replace(/\bp\s*\(\s*0\b/gi, "\\( p_0 \\)");
  t = t.replace(/\bx\s*_?\s*0\b/gi, "\\( x_0 \\)");
  t = t.replace(/\bn\s*[≥≥]\s*0\b/g, "\\( n \\ge 0 \\)");
  t = t.replace(/∑\s*_?\s*j\s*=\s*1\s*\^?\s*d/gi, "\\( \\sum_{j=1}^d \\)");
  t = t.replace(/Pd\s+j\s*=\s*1/gi, "\\( \\sum_{j=1}^d \\)");
  t = t.replace(/\bp\?\b/g, "\\( p^\\star \\)");
  t = t.replace(/\bp\*\(/g, "\\( p^\\star(");
  const ctx = `${t} markov metropolis gibbs chain transition detailed balance mcmc`;
  const profile =
    /\b(markov|mcmc|metropolis|gibbs|transition matrix|detailed balance|invariant|kernel)\b/i.test(ctx) ? "monte_carlo_sampling" : "generic";
  return convertCommonMathToLatex(t, profile, ctx);
}

function extractFormulaLines(text: string, sourceFile: string, sections: ExtractedSection[]): GeneratedFormulaItem[] {
  const lines = text.split("\n");
  let offset = 0;
  const out: GeneratedFormulaItem[] = [];
  const seen = new Set<string>();

  const formulaLike =
    /[=∑∫]|\\sum|\\int|\\propto|∝|\\\(|\$|\\frac|\\mathbb\{P\}|M\^\{|M\^|p\^\*|p_n|K\(|detailed balance|transition/i;

  for (const line of lines) {
    const trimmed = line.trim();
    const isCandidate =
      trimmed.length >= 8 &&
      trimmed.length < 500 &&
      formulaLike.test(trimmed) &&
      (/[=]/.test(trimmed) || /\\sum|\\int|∑|∫|∝|\\\\propto|conditional|\\mathbb\{P\}|M_\{|M\^|p_n|p\^\*|K\(/i.test(trimmed));

    if (isCandidate) {
      const normalized = normalizeMathText(trimmed);
      const sig = normalized.replace(/\s+/g, " ").slice(0, 160).toLowerCase();
      if (seen.has(sig)) {
        offset += line.length + 1;
        continue;
      }
      seen.add(sig);
      const v = validateLatexSnippet(normalized);
      const nameGuess = trimmed.match(/^([^=:{]+)[:=]/);
      const name = nameGuess ? nameGuess[1]!.trim().slice(0, 72) : `Relation near “${trimmed.slice(0, 40)}…”`;
      out.push({
        id: createId("form"),
        name: name.replace(/\s+/g, " "),
        latex: normalized,
        whenToUse: "Use when revising transition kernels, balance conditions, or acceptance ratios in MCMC.",
        source: sourceFile,
        sourceFile,
        sourceSection: sectionForOffset(sections, offset),
        sourcePage: pageAtOffset(text.replace(/\r\n/g, "\n"), offset),
        sourceExcerpt: trimmed.slice(0, 420),
        mathStatus: mathStatusFromValidation(v),
      });
    }
    offset += line.length + 1;
  }
  return dedupeFormulas(out);
}

function dedupeFormulas(items: GeneratedFormulaItem[]): GeneratedFormulaItem[] {
  const out: GeneratedFormulaItem[] = [];
  for (const f of items) {
    const sig = f.latex.replace(/\s+/g, " ").slice(0, 120).toLowerCase();
    if (out.some((x) => x.latex.replace(/\s+/g, " ").slice(0, 120).toLowerCase() === sig)) continue;
    if (out.some((x) => jaccardSimilarity(x.latex, f.latex) > 0.92)) continue;
    out.push(f);
  }
  return out.slice(0, 40);
}

function proofSkeletonFromBody(body: string): { skeleton: string; mistake: string } {
  const lower = body.toLowerCase();
  if (lower.includes("detailed balance") && lower.includes("stationary")) {
    return {
      skeleton: "Assume detailed balance → multiply by appropriate marginals → sum/integrate → conclude π is invariant.",
      mistake: "Forgetting to verify summability / interchange limits when passing from pointwise balance to global stationarity.",
    };
  }
  if (lower.includes("metropolis") && lower.includes("accept")) {
    return {
      skeleton: "Write proposal ratio r(x,x′) → verify reversibility with target × proposal → acceptance min(1,r).",
      mistake: "Using the wrong conditional order in q(x′|x) vs q(x|x′) in the ratio.",
    };
  }
  if (lower.includes("gibbs") && (lower.includes("invariant") || lower.includes("kernel"))) {
    return {
      skeleton: "Express kernel as composition / conditional updates → show each leaves π invariant → conclude Gibbs kernel invariant.",
      mistake: "Assuming order of Gibbs updates does not matter without checking (random scan vs systematic).",
    };
  }
  return {
    skeleton: "State assumptions → expand definitions → algebraic manipulation → conclude.",
    mistake: "Skipping hypotheses (irreducibility, aperiodicity, positivity) when invoking limit theorems.",
  };
}

function blocksToDefinitions(blocks: LabelledBlock[]): GeneratedDefinitionItem[] {
  const defKinds: PackItemKind[] = ["definition", "theorem", "proposition", "lemma", "corollary", "remark", "example", "exercise"];
  return blocks
    .filter((b) => defKinds.includes(b.kind))
    .map((b) => {
      const defText = normalizeMathText(b.body.slice(0, 3500));
      const snippet = defText.slice(0, 700);
      const v = validateLatexSnippet(snippet);
      return {
        id: createId("def"),
        term: b.displayTitle,
        definition: defText,
        source: b.sourceFile,
        sourceFile: b.sourceFile,
        sourcePage: b.sourcePage,
        sourceSection: b.sourceSection,
        sourceLabel: b.formalLabel,
        sourceExcerpt: b.rawBlock.slice(0, 900),
        formalLabel: b.formalLabel,
        itemKind: b.kind as StudyPackEntryKind,
        importance: b.importance,
        mathStatus: mathStatusFromValidation(v),
      };
    });
}

function blocksToProofs(blocks: LabelledBlock[]): GeneratedProofItem[] {
  return blocks
    .filter((b) => b.kind === "proof")
    .map((b) => {
      const { skeleton, mistake } = proofSkeletonFromBody(b.body);
      const heading =
        b.sourceSection != null ? `Proof · ${b.sourceSection}` : b.sourcePage != null ? `Proof (p. ${b.sourcePage})` : "Proof from notes";
      return {
        id: createId("prf"),
        name: heading,
        proofName: heading,
        statement: normalizeMathText(b.body.slice(0, 1200)),
        proofSkeleton: skeleton,
        commonMistake: mistake,
        source: b.sourceFile,
        sourceFile: b.sourceFile,
        sourcePage: b.sourcePage,
        sourceSection: b.sourceSection,
        sourceLabel: b.formalLabel,
        sourceExcerpt: b.rawBlock.slice(0, 900),
      };
    });
}

function algorithmBlocksToMethods(blocks: LabelledBlock[]): GeneratedMethodTemplate[] {
  const algos = blocks.filter((b) => b.kind === "algorithm");
  const methods: GeneratedMethodTemplate[] = algos.map((b) => ({
    id: createId("meth"),
    problemType: `${b.formalLabel}: ${b.displayTitle}`,
    steps: normalizeMathText(b.body)
      .split(/(?:\n|;|\.)\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 8)
      .slice(0, 8),
    triggerWords: [b.displayTitle, "MCMC", "Metropolis", "Gibbs"].filter(Boolean),
    relatedPracticeType: "Exam-style algorithm recall",
  }));

  const textBlob = blocks.map((b) => b.body).join("\n").toLowerCase();
  const extras: Array<{ title: string; steps: string[]; triggers: string[] }> = [
    {
      title: "Simulate a discrete Markov chain",
      steps: [
        "Choose initial state X0 from p0 or fixed state.",
        "For each step, sample next state from row Xn of transition matrix M.",
        "Repeat to obtain a path; optionally discard burn-in for Monte Carlo averages.",
      ],
      triggers: ["transition matrix", "discrete", "markov chain"],
    },
    {
      title: "Compute n-step transition probabilities",
      steps: ["Identify one-step kernel M.", "Use M(n)=Mn for discrete time homogeneous chains.", "For probabilities, track pn=p0Mn."],
      triggers: ["m^n", "chapman", "transition"],
    },
    {
      title: "Verify an invariant distribution",
      steps: ["Candidate π — check πM=π row-wise.", "Or integrate π(x')K(x|x')dx'=π(x) for continuous state.", "Confirm positivity/normalisation."],
      triggers: ["invariant", "stationary"],
    },
    {
      title: "Use detailed balance",
      steps: ["Write π(i)Mij=π(j)Mji or continuous analogue.", "Conclude π is invariant.", "Note: DB ⇒ stationarity but not always necessary."],
      triggers: ["detailed balance"],
    },
    {
      title: "Run Metropolis–Hastings",
      steps: ["Choose proposal q(x'|x).", "Compute acceptance ratio r(x,x′).", "Accept/reject; repeat.", "Verify detailed balance for correctness intuition."],
      triggers: ["metropolis", "hastings", "acceptance"],
    },
    {
      title: "Derive the MH acceptance ratio",
      steps: ["Start from detailed balance with π∝p*", "Include proposal densities q(x'|x) and q(x|x').", "Simplify to min(1,r) form."],
      triggers: ["acceptance ratio", "r(x"],
    },
    {
      title: "Derive a Gibbs sampler from full conditionals",
      steps: ["Write full conditional distributions.", "Cycle updates (systematic or random scan).", "Each update leaves π invariant — verify using conditional detail."],
      triggers: ["gibbs", "full conditional"],
    },
  ];

  for (const ex of extras) {
    if (!ex.triggers.some((t) => textBlob.includes(t))) continue;
    if (methods.some((m) => m.problemType.toLowerCase().includes(ex.title.slice(0, 12).toLowerCase()))) continue;
    methods.push({
      id: createId("meth"),
      problemType: ex.title,
      steps: ex.steps,
      triggerWords: ex.triggers,
      relatedPracticeType: "Timed derivation / algorithm outline",
    });
  }
  return methods.slice(0, 14);
}

function courseTopicsFromSections(files: LecturePackFile[], lectureText: string): GeneratedCourseTopic[] {
  const sections = extractSectionHeadings(lectureText);
  if (sections.length) {
    return sections.map((s) => ({
      id: createId("topic"),
      title: `${s.sectionNumber} ${s.title}`,
      sourceFileNames: files.filter((f) => f.role === "lecture_notes" || !f.role).map((f) => f.name),
      importance: "high" as TopicImportance,
      evidenceReason: "Detected numbered section heading in lecture text.",
    }));
  }
  return [];
}

export type HeuristicPackContext = {
  files: LecturePackFile[];
  settings: PackGeneratorSettings;
  combinedLectureText: string;
  hasPastEvidence: boolean;
};

/** Build structured study pack from parsed file text using local rules. */
export function buildHeuristicStudentRevisionPack(ctx: HeuristicPackContext): GeneratedRevisionPack {
  const { files, settings, combinedLectureText, hasPastEvidence } = ctx;
  const lectureFiles = files.filter((f) => f.role === "lecture_notes" || f.role === "formula_sheet" || f.role === "other");
  const primaryName = lectureFiles[0]?.name ?? files[0]?.name ?? "your materials";
  const sections = extractSectionHeadings(combinedLectureText);

  const allBlocks: LabelledBlock[] = [];
  for (const f of lectureFiles) {
    const t = f.parsedText ?? "";
    if (!t.trim()) continue;
    allBlocks.push(...extractLabelledBlocks(t, f.name, sections));
    allBlocks.push(...extractProofBlocks(t, f.name, sections));
  }
  const blocks = dedupeLabelledBlocks(allBlocks);

  let definitions = blocksToDefinitions(blocks);
  definitions = dedupeDefinitions(definitions);

  const formulas = extractFormulaLines(combinedLectureText.replace(/\r\n/g, "\n"), primaryName, sections).map((f) => {
    const v = validateLatexSnippet(f.latex);
    return { ...f, mathStatus: mathStatusFromValidation(v) };
  });

  let proofs = blocksToProofs(blocks);
  proofs = dedupeProofs(proofs);

  const methods = algorithmBlocksToMethods(blocks);

  const chapterTitle =
    combinedLectureText.split("\n").map((l) => l.trim()).find((l) => /markov|monte carlo|mcmc/i.test(l) && l.length < 120) ??
    files.find((f) => f.role === "lecture_notes")?.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");

  let courseMap = courseTopicsFromSections(files, combinedLectureText);
  if (!courseMap.length) {
    courseMap = guessTopicsFallback(files);
  }

  const mistakes: GeneratedCommonMistake[] = [
    {
      id: createId("mis"),
      mistake: "Confusing stationarity with detailed balance",
      whyItHappens: "Detailed balance is sufficient but not necessary for π.",
      howToAvoid: "When checking invariance, verify πK=π directly if detailed balance is unclear.",
    },
    {
      id: createId("mis"),
      mistake: "Wrong proposal direction in MH ratio",
      whyItHappens: "Asymmetric proposals need q(x′|x) and q(x|x′) consistently.",
      howToAvoid: "Write the ratio before cancelling terms; track conditioning carefully.",
    },
  ];

  const patterns = buildPastPaperPatterns(hasPastEvidence, settings);

  const cram: GeneratedCramSheet = {
    definitionBullets: definitions.slice(0, 10).map((d) => `${d.formalLabel ?? d.term}: ${d.definition.slice(0, 100)}${d.definition.length > 100 ? "…" : ""}`),
    formulaBullets: formulas.slice(0, 10).map((f) => `${f.name}: ${f.latex}`),
    proofSkeletonBullets: proofs.slice(0, 8).map((p) => `${p.name}: ${p.proofSkeleton}`),
    trapBullets: mistakes.map((m) => `${m.mistake} — ${m.howToAvoid}`),
  };

  const overview = {
    courseName: chapterTitle,
    summary: `Structured locally from ${files.length} file(s). ${definitions.filter((d) => !CORE_IDEA_PLACEHOLDER.test(d.term)).length} labelled items detected; style ${settings.revisionStyle.replace(/_/g, " ")}.`,
    likelyExamStructure: hasPastEvidence
      ? "Past/problem-sheet evidence present — cross-check emphasis against these notes."
      : "Lecture-only snapshot: definitions, algorithms, and balance conditions — add past papers to estimate exam weighting.",
    highPriorityTopics: courseMap.filter((t) => t.importance === "high").map((t) => t.title).slice(0, 10),
  };

  return {
    generatedAt: new Date().toISOString(),
    examOverview: overview,
    courseMap,
    definitions,
    formulas,
    proofs,
    methods,
    pastPaperPatterns: patterns,
    commonMistakes: mistakes,
    cramSheet: cram,
  };
}

function dedupeDefinitions(items: GeneratedDefinitionItem[]): GeneratedDefinitionItem[] {
  const out: GeneratedDefinitionItem[] = [];
  for (const d of items) {
    const dupIdx = out.findIndex(
      (x) =>
        (Boolean(d.sourceLabel) && x.sourceLabel === d.sourceLabel) ||
        (normalizeTitleKey(x.term) === normalizeTitleKey(d.term) && normalizeTitleKey(d.term).length > 4),
    );
    if (dupIdx >= 0) {
      const prev = out[dupIdx]!;
      if ((d.definition?.length ?? 0) > (prev.definition?.length ?? 0)) out[dupIdx] = d;
      continue;
    }
    out.push(d);
  }
  return out;
}

function dedupeProofs(items: GeneratedProofItem[]): GeneratedProofItem[] {
  const out: GeneratedProofItem[] = [];
  for (const p of items) {
    if (out.some((x) => jaccardSimilarity(x.statement, p.statement) > 0.85)) continue;
    out.push(p);
  }
  return out.slice(0, 16);
}

function guessTopicsFallback(files: LecturePackFile[]): GeneratedCourseTopic[] {
  const byStem = new Map<string, { names: string[]; roles: Set<StudyFileRole | undefined> }>();
  for (const file of files) {
    const stem = file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim().slice(0, 60);
    const cur = byStem.get(stem) ?? { names: [], roles: new Set() };
    cur.names.push(file.name);
    cur.roles.add(file.role);
    byStem.set(stem, cur);
  }
  const topics: GeneratedCourseTopic[] = [];
  for (const [title, { names, roles }] of byStem) {
    const lectureHit = roles.has("lecture_notes");
    let importance: TopicImportance = "medium";
    let evidenceReason = "Inferred from uploaded filenames.";
    if (lectureHit) {
      importance = "high";
      evidenceReason = "Lecture notes filename stem.";
    }
    topics.push({
      id: createId("topic"),
      title: title || "Topic",
      sourceFileNames: names,
      importance,
      evidenceReason,
    });
  }
  return topics.sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 };
    return order[a.importance] - order[b.importance];
  });
}

function buildPastPaperPatterns(hasEvidence: boolean, settings: PackGeneratorSettings): GeneratedPastPaperPattern[] {
  if (!hasEvidence) {
    return [
      {
        id: createId("pat"),
        title: "Past paper evidence",
        evidence: "No past paper evidence uploaded yet. Upload past papers or problem sheets to identify exam patterns.",
        likelyExamStyle: "Unknown until assessment materials are added.",
        suggestedPracticeQuestion: "Upload a past paper or problem sheet, regenerate, then revisit this tab.",
      },
    ];
  }
  return [
    {
      id: createId("pat"),
      title: "Repeated exam emphasis",
      evidence: "Assessment-class files included in this project.",
      likelyExamStyle: settings.revisionStyle === "problem_heavy" ? "Multi-part calculation with interpretation" : "Short recall plus applied follow-up",
      suggestedPracticeQuestion: "Timed past-paper question: definitions first, then a medium-length computation.",
    },
  ];
}
