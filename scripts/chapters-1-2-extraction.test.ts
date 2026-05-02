/**
 * Acceptance tests for chapters 1–2 style stochastic simulation notes.
 * Run: `npm run test:chapters12`
 */
import assert from "node:assert/strict";
import {
  buildHeuristicStudentRevisionPack,
  extractSectionHeadings,
} from "../src/lib/local-study-pack-extraction";
import {
  buildRevisionItemsFromStudentPack,
  countTypedPackItems,
} from "../src/lib/revision-pack-generator";
import { chapters12StochasticExcerpt } from "../src/lib/test-fixtures/chapters-1-2-stochastic-excerpt";

const fixtureFile = {
  id: "ch12",
  name: "chapters-1-2.pdf",
  role: "lecture_notes" as const,
  parsedText: chapters12StochasticExcerpt,
};

const sections = extractSectionHeadings(chapters12StochasticExcerpt);
assert.ok(sections.some((s) => /introduction/i.test(s.title)), `expected Introduction section, got ${sections.map((x) => x.title).join(", ")}`);
assert.ok(
  sections.some((s) => s.sectionNumber === "2" && /exact generation|random variates/i.test(s.title)),
  `expected chapter 2 banner; got ${sections.map((x) => `${x.sectionNumber} ${x.title}`).join(" | ")}`,
);

const pack = buildHeuristicStudentRevisionPack({
  files: [fixtureFile],
  settings: { revisionStyle: "concise_exam", aiStrictness: "balanced" },
  combinedLectureText: chapters12StochasticExcerpt,
  hasPastEvidence: false,
});

const mapTitles = pack.courseMap.map((t) => t.title.toLowerCase());
assert.ok(mapTitles.some((t) => t.includes("1 introduction")), `course map: ${mapTitles.join(" | ")}`);
assert.ok(mapTitles.some((t) => t.includes("2") && t.includes("exact generation")), `course map missing ch2: ${mapTitles.join(" | ")}`);

assert.ok(pack.definitions.length >= 2, `definitions: ${pack.definitions.length}`);
const defTerms = pack.definitions.map((d) => d.term.toLowerCase()).join(" | ");
assert.ok(defTerms.includes("conditional"), `missing conditional independence heuristic: ${defTerms}`);
assert.ok(defTerms.includes("pseudo"), `missing pseudo-random heuristic: ${defTerms}`);

assert.ok(pack.formulas.length >= 8, `formulas: ${pack.formulas.length}`);

const proofLabels = pack.proofs.map((p) => (p.sourceLabel ?? p.name).toLowerCase()).join(" | ");
assert.ok(proofLabels.includes("theorem 2.1") || proofLabels.includes("theorem 2.1:"), `expected Theorem 2.1 proof row: ${proofLabels}`);

const methodLines = pack.methods.map((m) => m.problemType.toLowerCase()).join(" | ");
assert.ok(methodLines.includes("algorithm 1"), `methods missing Algorithm 1: ${methodLines}`);
assert.ok(methodLines.includes("algorithm 2"), `methods missing Algorithm 2: ${methodLines}`);

const typed = countTypedPackItems(pack);
assert.ok(typed > 0, `typed pack items: ${typed}`);
const recall = buildRevisionItemsFromStudentPack(pack);
assert.ok(recall.length === typed, `recall cards ${recall.length} should match typed count ${typed}`);
assert.ok(
  !(typed > 0 && recall.length === 0),
  "when typed pack is non-empty, recall builder should emit cards",
);

const nonemptyTabs =
  pack.definitions.length > 0 &&
  pack.formulas.length > 0 &&
  pack.proofs.length > 0 &&
  pack.methods.length > 0;
assert.ok(nonemptyTabs, "definitions, formulas, proofs, and methods should all be non-empty for this fixture");

assert.ok(/stochastic simulation/i.test(pack.examOverview.courseName ?? ""), `course title: ${pack.examOverview.courseName}`);
const courseName = pack.examOverview.courseName ?? "";
assert.ok(courseName.length < 100, `course title should be short, got len=${courseName.length}: ${courseName}`);
assert.ok(!/\b(department|imperial college|akyildiz)\b/i.test(courseName), `title should not include author/affiliation: ${courseName}`);

for (const topic of pack.courseMap) {
  assert.ok(
    topic.title.length <= 100,
    `course map heading should be a title, not a paragraph: ${topic.title.slice(0, 120)}…`,
  );
}

const algo2 = pack.methods.find((m) => /algorithm\s*2/i.test(m.problemType));
assert.ok(algo2, "expected Algorithm 2 in methods");
assert.ok(!/\d+\s*:\s*input/i.test(algo2.problemType), `Algorithm 2 label should not include "1: Input": ${algo2.problemType}`);
const remarkInSteps = algo2.steps.some((s) => /remark\s*2\.1/i.test(s));
assert.ok(!remarkInSteps, "Algorithm 2 steps should not contain Remark 2.1");

assert.ok(pack.formulas.some((f) => Boolean(f.formulaPlain)), "expected formulaPlain on heuristic formulas");

console.log("chapters 1–2 extraction acceptance test passed.");
console.log(`  sections sample: ${sections.slice(0, 6).map((s) => `${s.sectionNumber} ${s.title}`).join("; ")}`);
console.log(`  definitions=${pack.definitions.length}, formulas=${pack.formulas.length}, proofs=${pack.proofs.length}, methods=${pack.methods.length}, recall=${recall.length}`);
