import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { jobEnvStatus, requireProcessAuthorization } from "../src/lib/jobs/env";
import { initialJobStatus } from "../src/lib/jobs/status-store";

const originalToken = process.env.JOB_WORKER_TOKEN;
const originalBlob = process.env.BLOB_READ_WRITE_TOKEN;
const originalOpenAi = process.env.OPENAI_API_KEY;
const originalCronSecret = process.env.CRON_SECRET;

delete process.env.JOB_WORKER_TOKEN;
assert.equal(requireProcessAuthorization(new Request("https://example.com/api/jobs/process"), { production: true }), null);

process.env.JOB_WORKER_TOKEN = "test-worker-token";
assert.equal(requireProcessAuthorization(new Request("https://example.com/api/jobs/process"), { production: true }), "Invalid job worker authorization.");
assert.equal(
  requireProcessAuthorization(new Request("https://example.com/api/jobs/process", {
    headers: { authorization: "Bearer test-worker-token" },
  }), { production: true }),
  null,
);

process.env.BLOB_READ_WRITE_TOKEN = "blob";
process.env.OPENAI_API_KEY = "openai";
process.env.CRON_SECRET = "cron";
const env = jobEnvStatus();
assert.equal(env.ok, true);
assert.equal(env.mode, "cron");
assert.equal(env.blobConfigured, true);
assert.equal(env.workerTokenConfigured, true);

const queued = initialJobStatus("job_processing_test");
assert.equal(queued.status, "queued");
assert.equal(queued.currentStage, "queued");

const processRoute = readFileSync("src/app/api/jobs/process/route.ts", "utf8");
assert.ok(processRoute.includes("processExtractionJobs"));
assert.ok(!processRoute.includes("runExtractionJob("));

const cronRoute = readFileSync("src/app/api/jobs/cron/route.ts", "utf8");
assert.ok(cronRoute.includes("processExtractionJobs"));
assert.ok(!cronRoute.includes("runExtractionJob("));

const worker = readFileSync("src/lib/jobs/worker.ts", "utf8");
assert.ok(worker.includes("runExtractionJobStep"));
assert.ok(worker.includes("tryAcquireJobLease"));
assert.ok(worker.includes("JOB_STEP_MAX_CHUNKS"));
assert.ok(worker.includes("JOB_STEP_MAX_RUNTIME_MS"));
assert.ok(worker.includes("processedChunks >= maxChunks"));
assert.ok(worker.includes("Date.now() - startedAt > maxRuntimeMs"));
assert.ok(worker.includes("currentChunk.status === \"completed\""));
assert.ok(worker.includes("processExtractionJobs"));
assert.ok(worker.includes("nextStage: \"extracting_candidates\""));
assert.ok(worker.includes("nextStage: \"completed\""));

const statusStore = readFileSync("src/lib/jobs/status-store.ts", "utf8");
assert.ok(statusStore.includes("leaseExpiresAt"));
assert.ok(statusStore.includes("JOB_LOCK_TTL_MS"));
assert.ok(statusStore.includes("staleProcessing"));

const resultRoute = readFileSync("src/app/api/jobs/[jobId]/result/route.ts", "utf8");
assert.ok(resultRoute.includes("resultPath"));
assert.ok(resultRoute.includes("resultUrl"));
assert.ok(!processRoute.includes("debug.json"));
assert.ok(!cronRoute.includes("exam-pack.json"));

if (originalToken === undefined) delete process.env.JOB_WORKER_TOKEN;
else process.env.JOB_WORKER_TOKEN = originalToken;
if (originalBlob === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
else process.env.BLOB_READ_WRITE_TOKEN = originalBlob;
if (originalOpenAi === undefined) delete process.env.OPENAI_API_KEY;
else process.env.OPENAI_API_KEY = originalOpenAi;
if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
else process.env.CRON_SECRET = originalCronSecret;

console.log("job processing tests passed");
