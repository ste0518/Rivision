import { get, put } from "@vercel/blob";

export const JOB_PATHS = {
  upload(jobId: string, filename = "source.pdf") {
    return `uploads/${jobId}/${safePathSegment(filename)}`;
  },
  uploadMetadata(jobId: string) {
    return `uploads/${jobId}/metadata.json`;
  },
  status(jobId: string) {
    return `jobs/${jobId}/status.json`;
  },
  manifest(jobId: string) {
    return `jobs/${jobId}/manifest.json`;
  },
  pageChunk(jobId: string, pageStart: number, pageEnd: number) {
    return `chunks/${jobId}/pages/${pageStart}-${pageEnd}.json`;
  },
  candidates(jobId: string, chunkId: string) {
    return `chunks/${jobId}/candidates/${safePathSegment(chunkId)}.json`;
  },
  debug(jobId: string) {
    return `results/${jobId}/debug.json`;
  },
  examPack(jobId: string) {
    return `results/${jobId}/exam-pack.json`;
  },
};

export function safePathSegment(value: string) {
  return value
    .trim()
    .replace(/[/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 180) || "file";
}

export async function writeJsonBlob<T>(pathname: string, value: T) {
  return put(pathname, JSON.stringify(value, null, 2), {
    access: "public",
    allowOverwrite: true,
    contentType: "application/json",
    cacheControlMaxAge: 60,
  });
}

export async function readJsonBlob<T>(urlOrPathname: string): Promise<T | null> {
  const viaSdk = await get(urlOrPathname, { access: "public", useCache: false }).catch(() => null);
  if (viaSdk?.statusCode === 200) {
    const text = await new Response(viaSdk.stream).text();
    return JSON.parse(text) as T;
  }

  if (/^https?:\/\//i.test(urlOrPathname)) {
    const response = await fetch(urlOrPathname, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as T;
  }

  return null;
}

export async function readBlobAsFile(input: { url: string; filename: string; contentType?: string }) {
  const response = await fetch(input.url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not download uploaded file (${response.status}).`);
  const arrayBuffer = await response.arrayBuffer();
  return new File([arrayBuffer], input.filename, { type: input.contentType || response.headers.get("content-type") || "application/pdf" });
}

