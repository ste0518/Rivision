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
    ok: blobConfigured && openAiConfigured && (process.env.NODE_ENV !== "production" || workerTokenConfigured),
    blobConfigured,
    openAiConfigured,
    workerTokenConfigured,
    queueOrWorkflowConfigured: workflowConfigured || queueConfigured,
    mode,
  };
}

export function requireProcessAuthorization(request: Request, options?: { production?: boolean }) {
  const isProduction = options?.production ?? process.env.NODE_ENV === "production";
  const expected = process.env.JOB_WORKER_TOKEN?.trim();
  if (!expected) return isProduction ? "JOB_WORKER_TOKEN is required in production." : null;
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${expected}`) return "Invalid job worker authorization.";
  return null;
}

export function requireCronAuthorization(request: Request, options?: { production?: boolean }) {
  const isProduction = options?.production ?? process.env.NODE_ENV === "production";
  const expected = process.env.CRON_SECRET?.trim() || process.env.JOB_WORKER_TOKEN?.trim();
  if (!expected) return isProduction ? "CRON_SECRET or JOB_WORKER_TOKEN is required for cron processing." : null;
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization !== `Bearer ${expected}`) return "Invalid cron authorization.";
  return null;
}
