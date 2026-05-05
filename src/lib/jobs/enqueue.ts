import { patchJobStatus } from "@/lib/jobs/status-store";

export type EnqueueResult = {
  mode: "queue-webhook" | "workflow-webhook" | "cron" | "dev-run-once" | "not-configured";
  queued: boolean;
  warning?: string;
};

export async function enqueueExtractionJob(jobId: string): Promise<EnqueueResult> {
  const queueWebhook = process.env.VERCEL_QUEUE_WEBHOOK_URL?.trim();
  const workflowWebhook = process.env.VERCEL_WORKFLOW_WEBHOOK_URL?.trim();
  const workerToken = process.env.JOB_WORKER_TOKEN?.trim();
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (workerToken) headers.authorization = `Bearer ${workerToken}`;

  if (queueWebhook) {
    try {
      await fetch(queueWebhook, {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId }),
      });
      return { mode: "queue-webhook", queued: true };
    } catch (error) {
      console.error("Failed to enqueue extraction job through Vercel Queue webhook", error);
      return { mode: "queue-webhook", queued: false, warning: "Queue enqueue failed; cron/manual processing can still pick up this queued job." };
    }
  }

  if (workflowWebhook) {
    try {
      await fetch(workflowWebhook, {
        method: "POST",
        headers,
        body: JSON.stringify({ jobId }),
      });
      return { mode: "workflow-webhook", queued: true };
    } catch (error) {
      console.error("Failed to enqueue extraction job through Vercel Workflow webhook", error);
      return { mode: "workflow-webhook", queued: false, warning: "Workflow enqueue failed; cron/manual processing can still pick up this queued job." };
    }
  }

  if (process.env.NODE_ENV !== "production") {
    await patchJobStatus(jobId, {
      currentStage: "queued",
      progress: 2,
    });
    return { mode: "dev-run-once", queued: false };
  }

  return {
    mode: "cron",
    queued: true,
    warning: "Job will be picked up by the Vercel Cron fallback. It can take up to one minute to start.",
  };
}
