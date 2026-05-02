/**
 * Acceptance test for the local Study Pack extractor against chapter-4.pdf
 * (Markov Chain Monte Carlo). Uses a hand-curated text fixture mirroring the
 * parsed PDF so we can run without re-invoking pdf.js.
 *
 * Run via: `npm run test:chapter4`.
 */
import assert from "node:assert/strict";
import {
  buildHeuristicStudentRevisionPack,
  extractSectionHeadings,
} from "../src/lib/local-study-pack-extraction";
import { chapter4McmcExcerpt } from "../src/lib/test-fixtures/chapter-4-mcmc-excerpt";

const fixtureFile = {
  id: "chapter-4",
  name: "chapter-4.pdf",
  role: "lecture_notes" as const,
  parsedText: chapter4McmcExcerpt,
};

const sections = extractSectionHeadings(chapter4McmcExcerpt);
const sectionNumbers = sections.map((s) => s.sectionNumber);
assert.ok(sectionNumbers.includes("4.1"), `expected section 4.1, got ${sectionNumbers.join(",")}`);
assert.ok(sectionNumbers.includes("4.2"), `expected section 4.2, got ${sectionNumbers.join(",")}`);
assert.ok(sectionNumbers.includes("4.3"), `expected section 4.3, got ${sectionNumbers.join(",")}`);
assert.ok(sectionNumbers.includes("4.4"), `expected section 4.4, got ${sectionNumbers.join(",")}`);

const pack = buildHeuristicStudentRevisionPack({
  files: [fixtureFile],
  settings: { revisionStyle: "concise_exam", aiStrictness: "balanced" },
  combinedLectureText: chapter4McmcExcerpt,
  hasPastEvidence: false,
});

// 1. Course Map covers the four top-level sections (not just the filename stem).
const courseTitles = pack.courseMap.map((t) => t.title);
for (const num of ["4.1", "4.2", "4.3", "4.4"]) {
  assert.ok(
    courseTitles.some((t) => t.startsWith(`${num} `)),
    `course map missing ${num}; got: ${courseTitles.join(" | ")}`,
  );
}
assert.ok(!courseTitles.some((t) => /^chapter\s*4$/i.test(t.trim())), "course map should not be only the filename stem");

// 2. Definitions tab includes the four definitions and excludes Examples/Exercises.
const defLabels = pack.definitions.map((d) => d.formalLabel ?? "");
for (const lbl of ["Definition 4.1", "Definition 4.2", "Definition 4.3", "Definition 4.4"]) {
  assert.ok(defLabels.includes(lbl), `definitions missing ${lbl}; got: ${defLabels.join(", ")}`);
}
assert.ok(!defLabels.some((l) => l.startsWith("Example")), `definitions must not include examples; got: ${defLabels.join(", ")}`);
assert.ok(!defLabels.some((l) => l.startsWith("Exercise")), `definitions must not include exercises; got: ${defLabels.join(", ")}`);
assert.ok(!defLabels.some((l) => l.startsWith("Proposition")), `definitions must not include propositions; got: ${defLabels.join(", ")}`);
assert.ok(!defLabels.some((l) => l.startsWith("Remark")), `definitions must not include remarks; got: ${defLabels.join(", ")}`);

// Definition titles include the parenthesised concept names.
const defTerms = pack.definitions.map((d) => d.term.toLowerCase());
for (const term of ["markov chain", "transition matrix", "k-invariance", "detailed balance"]) {
  assert.ok(defTerms.some((t) => t.includes(term)), `definition titles missing "${term}"; got: ${defTerms.join(" | ")}`);
}

// 3. Formulas tab has multiple entries and includes the canonical forms.
assert.ok(pack.formulas.length > 5, `expected >5 formulas, got ${pack.formulas.length}`);
const formulaNames = pack.formulas.map((f) => f.name).join(" | ");
const formulaLatex = pack.formulas.map((f) => f.latex).join(" | ");
assert.ok(/transition matrix/i.test(formulaNames) || /M_\{ij\}\s*=\s*\\Pr\(X_\{n\+1\}/.test(formulaLatex), "expected transition-matrix formula");
assert.ok(/acceptance ratio/i.test(formulaNames) || /r\(x, x'\)/.test(formulaLatex), "expected MH acceptance-ratio formula");
assert.ok(/Chapman/i.test(formulaNames) || /M\^\{\(m\+n\)\}\s*=\s*M\^\{\(m\)\}/.test(formulaLatex), "expected Chapman–Kolmogorov");
assert.ok(/Detailed balance/i.test(formulaNames) || /p\^\\\?star\(i\) M_\{ij\}/.test(formulaLatex) || /p\^\\star\(i\) M_\{ij\}/.test(formulaLatex), "expected discrete detailed balance");

// 4. Methods tab detects Algorithm 9 with a clean title.
const algo9 = pack.methods.find((m) => m.problemType.startsWith("Algorithm 9"));
assert.ok(algo9, `expected Algorithm 9 method; got: ${pack.methods.map((m) => m.problemType).join(" | ")}`);
assert.ok(/Metropolis/i.test(algo9.problemType), `Algorithm 9 title should mention Metropolis–Hastings; got: ${algo9.problemType}`);
assert.ok(!/Pseudocode/i.test(algo9.problemType), `Algorithm 9 title should not contain "Pseudocode"; got: ${algo9.problemType}`);
assert.ok(!/1: Input/i.test(algo9.problemType), `Algorithm 9 title should not include step text; got: ${algo9.problemType}`);
assert.ok(algo9.steps.length >= 4, `Algorithm 9 should have multiple steps; got ${algo9.steps.length}`);

// 5. Cram sheet definitions section excludes examples/exercises/propositions.
for (const bullet of pack.cramSheet.definitionBullets) {
  assert.ok(!/^Example /.test(bullet), `cram definition bullet should not be an Example: ${bullet}`);
  assert.ok(!/^Exercise /.test(bullet), `cram definition bullet should not be an Exercise: ${bullet}`);
  assert.ok(!/^Proposition /.test(bullet), `cram definition bullet should not be a Proposition: ${bullet}`);
  assert.ok(!/^Remark /.test(bullet), `cram definition bullet should not be a Remark: ${bullet}`);
}

// 6. Proof skeletons present for the three propositions.
const proofLabels = pack.proofs.map((p) => p.sourceLabel ?? "");
for (const lbl of ["Proposition 4.1", "Proposition 4.2", "Proposition 4.3"]) {
  assert.ok(proofLabels.includes(lbl), `proofs missing ${lbl}; got: ${proofLabels.join(", ")}`);
}

// 7. No "Core idea N" placeholder titles when labelled blocks exist.
assert.ok(!pack.definitions.some((d) => /^Core idea\s+\d+$/i.test(d.term)), "definitions should not use Core idea placeholder when labelled blocks exist");

// 8. Proposition 4.1 statement must not include Remark 4.2 / Exercise content.
const prop41 = pack.proofs.find((p) => p.sourceLabel === "Proposition 4.1");
assert.ok(prop41, "Proposition 4.1 proof item should be present");
assert.ok(!/Remark\s*4\.2/i.test(prop41.statement), `Proposition 4.1 statement leaked Remark 4.2; got: ${prop41.statement.slice(0, 200)}`);
assert.ok(!/Exercise\s*4\./i.test(prop41.statement), `Proposition 4.1 statement leaked an Exercise; got: ${prop41.statement.slice(0, 200)}`);
assert.ok(!/^Proof\b/i.test(prop41.statement), "Proposition 4.1 statement should not start with the proof body");

// 9. Cram sheet definitions list is non-empty and well-formed.
assert.ok(pack.cramSheet.definitionBullets.length >= 4, `expected ≥4 cram-sheet definition bullets, got ${pack.cramSheet.definitionBullets.length}`);

// 10. Formula latex is wrapped in math delimiters so MathMarkdown can render it.
const wrappedFormulas = pack.formulas.filter((f) => /\\\(|\\\[|\$/.test(f.latex));
assert.ok(wrappedFormulas.length >= pack.formulas.length - 1, `most formulas should be wrapped in math delimiters; ${wrappedFormulas.length}/${pack.formulas.length}`);

// 11. Algorithm 9 first step looks like the input declaration.
assert.ok(/Input/i.test(algo9.steps[0]!), `Algorithm 9 step 1 should describe the input; got: ${algo9.steps[0]}`);
// Last algorithm step should not absorb a paragraph of trailing prose.
const lastStep = algo9.steps[algo9.steps.length - 1]!;
assert.ok(lastStep.length < 250, `Algorithm 9 last step should be short, got ${lastStep.length} chars: ${lastStep.slice(0, 200)}`);

console.log("chapter-4 extraction acceptance test passed.");
console.log(`  sections=${sectionNumbers.join(",")}`);
console.log(`  definitions=${defLabels.join(", ")}`);
console.log(`  formulas=${pack.formulas.length}`);
console.log(`  proofs=${proofLabels.join(", ")}`);
console.log(`  methods=${pack.methods.map((m) => m.problemType).join(" | ")}`);
