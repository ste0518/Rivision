# Rivision

Rivision builds exam revision packs from lecture notes, problem sheets, solutions, and past papers.

## Vercel-Only Large PDF Architecture

Large PDFs should not be uploaded through a normal `/api/extract` request and should not be processed in one synchronous Vercel Function. Rivision now uses a job-based flow:

1. The browser uploads source files directly to Vercel Blob.
2. The browser creates an extraction job with `POST /api/jobs`.
3. The UI polls `GET /api/jobs/[jobId]` every two seconds.
4. A background Queue or Workflow runner calls `runExtractionJob(jobId)`.
5. The worker reads the PDF from Blob, extracts text, splits it into chunks, calls OpenAI on bounded chunks, checkpoints intermediate JSON, writes the final exam pack JSON, then marks the job completed.

Blob paths:

- `uploads/{jobId}/{filename}`
- `uploads/{jobId}/metadata.json`
- `jobs/{jobId}/status.json`
- `jobs/{jobId}/manifest.json`
- `chunks/{jobId}/pages/{pageStart}-{pageEnd}.json`
- `chunks/{jobId}/candidates/{chunkId}.json`
- `results/{jobId}/debug.json`
- `results/{jobId}/exam-pack.json`

## Required Vercel Environment Variables

- `BLOB_READ_WRITE_TOKEN`
- `OPENAI_API_KEY`

Optional tuning:

- `MAX_UPLOAD_BYTES`
- `MAX_PAGES_PER_CHUNK`
- `MAX_CHARS_PER_CHUNK`
- `MAX_OPENAI_INPUT_CHARS`
- `VERCEL_QUEUE_WEBHOOK_URL`
- `VERCEL_WORKFLOW_WEBHOOK_URL`
- `JOB_WORKER_TOKEN`
- `CRON_SECRET` (set this to the same value as `JOB_WORKER_TOKEN` for Vercel Cron)
- `ALLOW_SYNC_JOB_RUN_ONCE`
- `ALLOW_LARGE_RUN_ONCE`
- `JOB_STEP_MAX_CHUNKS` (default `1`)
- `JOB_STEP_MAX_RUNTIME_MS` (default `45000`)
- `JOB_LOCK_TTL_MS` (default `120000`)

Do not add `NEXT_PUBLIC_OPENAI_API_KEY`. OpenAI calls must stay server-side.

## Background Processing

Production now includes a Vercel Cron fallback in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/jobs/cron",
      "schedule": "* * * * *"
    }
  ]
}
```

The cron endpoint scans Blob for queued or in-progress jobs and advances one bounded step at a time. By default, each invocation processes at most one OpenAI chunk and stops before the runtime budget is exhausted. This means a job may take up to one minute to start after upload and large PDFs advance over several cron invocations, but one cron call should not try to process a whole large PDF.

You can later replace or supplement cron with Vercel Queues or Vercel Workflows by calling `POST /api/jobs/process` with `{ "jobId": "..." }`, or the worker function directly:

```ts
import { runExtractionJob } from "@/lib/jobs/worker";

await runExtractionJob(jobId);
```

The job worker checkpoints after text extraction, chunk creation, each chunk-level OpenAI call, debug JSON, and final pack JSON. If a chunk fails, already completed chunks remain in Blob and the same job can be rerun to resume from the manifest.

For local development only, `/api/jobs/[jobId]/run-once` can process small files synchronously. It is disabled in production unless `ALLOW_SYNC_JOB_RUN_ONCE=true`.

## Deployment Steps

1. Create a Vercel Blob store.
2. Set `BLOB_READ_WRITE_TOKEN` and `OPENAI_API_KEY` in Vercel.
3. Deploy the Next.js app to Vercel.
4. Set `CRON_SECRET` to the same value as `JOB_WORKER_TOKEN` so Vercel Cron can authenticate `/api/jobs/cron`.
5. Deploy to production. Vercel will install the cron job from `vercel.json`.
6. Optional: configure Vercel Queue or Workflow to receive the job id and call `POST /api/jobs/process` or `runExtractionJob(jobId)`.
5. Upload files from `/upload`, choose Fast, Standard, or Deep, then generate the exam pack.

## Commands

```bash
npm run dev
npm run build
npm run lint
node_modules/.bin/tsx scripts/job-architecture.test.ts
```
