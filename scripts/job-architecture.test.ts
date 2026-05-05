import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { JOB_PATHS, safePathSegment } from "../src/lib/jobs/blob-store";
import { initialJobStatus } from "../src/lib/jobs/status-store";
import { splitPagesIntoChunks } from "../src/lib/extraction/chunking";
import type { PageRecord } from "../src/lib/extraction/page-records";

const jobId = "job_test_123";

assert.equal(JOB_PATHS.upload(jobId, "Lecture 1?.pdf"), "uploads/job_test_123/Lecture-1-.pdf");
assert.equal(JOB_PATHS.status(jobId), "jobs/job_test_123/status.json");
assert.equal(JOB_PATHS.examPack(jobId), "results/job_test_123/exam-pack.json");
assert.equal(safePathSegment("a/b:c.pdf"), "a-b-c.pdf");

const status = initialJobStatus(jobId);
assert.equal(status.status, "queued");
assert.equal(status.progress, 0);
assert.equal(status.jobId, jobId);

const pages: PageRecord[] = Array.from({ length: 11 }, (_, index) => ({
  pageNumber: index + 1,
  text: `Section ${index + 1}\n${"definition theorem formula ".repeat(180)}`,
  sourceFile: "notes.pdf",
  role: "lecture_notes",
  headings: [],
  charCount: 2000,
}));
const chunks = splitPagesIntoChunks(pages, "standard", {
  maxPagesPerChunk: 4,
  maxCharsPerChunk: 30000,
  maxOpenAiInputChars: 10000,
});
assert.equal(chunks.length, 3);
assert.deepEqual(chunks.map((chunk) => [chunk.pageStart, chunk.pageEnd]), [[1, 4], [5, 8], [9, 11]]);
assert.ok(chunks.every((chunk) => chunk.text.length <= 10000));

const uploadPage = readFileSync("src/app/upload/page.tsx", "utf8");
assert.ok(uploadPage.includes("/api/jobs"));
assert.ok(!uploadPage.includes("/api/extract"));

const settingsPage = readFileSync("src/app/settings/page.tsx", "utf8");
assert.ok(settingsPage.includes("does not store or send OpenAI keys from the browser"));
assert.ok(!settingsPage.includes("sk-..."));

const allSource = [
  readFileSync("src/app/upload/page.tsx", "utf8"),
  readFileSync("src/app/settings/page.tsx", "utf8"),
  readFileSync("src/app/api/openai-health/route.ts", "utf8"),
  readFileSync("src/app/api/ai-clean-math/route.ts", "utf8"),
].join("\n");
assert.ok(!allSource.includes("NEXT_PUBLIC_OPENAI_API_KEY"));
assert.ok(!allSource.includes("body.openaiApiKey"));

console.log("job architecture tests passed");
