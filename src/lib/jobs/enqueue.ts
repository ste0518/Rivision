import { patchJobStatus } from "@/lib/jobs/status-store";

export type EnqueueResult = {
  mode: "queue-webhook" | "workflow-webhook" | "dev-run-once" | "not-configured";
  queued: boolean;
};

export async function enqueueExtractionJob(jobId: string): Promise<EnqueueResult> {
  const queueWebhook = process.env.VERCEL_QUEUE_WEBHOOK_URL?.trim();
  const workflowWebhook = process.env.VERCEL_WORKFLOW_WEBHOOK_URL?.trim();
  const workerToken = process.env.JOB_WORKER_TOKEN?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (workerToken) headers.authorization = `Bearer ${workerToken}`;

  if (queueWebhook) {
    await fetch(queueWebhook, {
      method: "POST",
      headers,
      body: JSON.stringify({ jobId }),
    });
    return { mode: "queue-webhook", queued: true };
  }

  if (workflowWebhook) {
    await fetch(workflowWebhook, {
      method: "POST",
      headers,
      body: JSON.stringify({ jobId }),
    });
    return { mode: "workflow-webhook", queued: true };
  }

  if (process.env.NODE_ENV !== "production") {
    await patchJobStatus(jobId, {
      currentStage: "queued",
      progress: 2,
    });
    return { mode: "dev-run-once", queued: false };
  }

  return { mode: "not-configured", queued: false };
}
