export type JobExecutionMode = "workflow" | "queue" | "cron" | "manual";

export function jobEnvStatus() {
  const blobConfigured = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
  const workerTokenConfigured = Boolean(process.env.JOB_WORKER_TOKEN?.trim());
  const workflowConfigured = Boolean(process.env.VERCEL_WORKFLOW_WEBHOOK_URL?.trim());
  const queueConfigured = Boolean(process.env.VERCEL_QUEUE_WEBHOOK_URL?.trim());
  const cronConfigured = Boolean(process.env.CRON_SECRET?.trim() || process.env.JOB_WORKER_TOKEN?.trim());
  const mode: JobExecutionMode =
    workflowConfigured ? "workflow"
    : queueConfigured ? "queue"
    : cronConfigured ? "cron"
    : "manual";
  return {
    ok: blobConfigured && openAiConfigured,
    blobConfigured,
    openAiConfigured,
    workerTokenConfigured,
    queueOrWorkflowConfigured: workflowConfigured || queueConfigured,
    mode,
  };
}

export function requireProcessAuthorization(request: Request, _options?: { production?: boolean }) {
  const expected = process.env.JOB_WORKER_TOKEN?.trim();
  // Keep setup simple: if no token is configured, allow processing calls.
  if (!expected) return null;
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${expected}`) return "Invalid job worker authorization.";
  return null;
}

export function requireCronAuthorization(request: Request, _options?: { production?: boolean }) {
  const expected = process.env.CRON_SECRET?.trim() || process.env.JOB_WORKER_TOKEN?.trim();
  // Keep setup simple: if no secret/token is configured, allow cron calls.
  if (!expected) return null;
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${expected}`) return "Invalid cron authorization.";
  return null;
}
