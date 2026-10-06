import type { IngestResponse, Source } from "./types";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8000"
    : "https://rag-pipeline-ovwp.onrender.com");

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

export async function health(): Promise<{ status: string }> {
  return handle(await fetch(`${API_URL}/health`));
}

export async function ingest(
  files: File[],
  opts: { chunkSize?: number; chunkOverlap?: number; collectionName?: string } = {},
  onProgress?: (pct: number) => void
): Promise<IngestResponse> {
  const form = new FormData();
  files.forEach((f) => form.append("files", f));
  if (opts.chunkSize) form.append("chunk_size", String(opts.chunkSize));
  if (opts.chunkOverlap) form.append("chunk_overlap", String(opts.chunkOverlap));
  if (opts.collectionName) form.append("collection_name", opts.collectionName);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/ingest`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try {
          reject(new Error(JSON.parse(xhr.responseText).detail));
        } catch {
          reject(new Error(xhr.statusText));
        }
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(form);
  });
}

export type QueryStreamEvent =
  | { type: "metadata"; sources: Source[] }
  | { type: "token"; content: string };

export async function* queryStream(
  question: string,
  opts: { topK?: number; collectionName?: string } = {}
): AsyncGenerator<QueryStreamEvent> {
  const response = await fetch(`${API_URL}/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      top_k: opts.topK ?? 5,
      collection_name: opts.collectionName || null,
    }),
  });

  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.json();
      detail = body.detail || detail;
    } catch {}
    throw new Error(detail);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No reader available");

  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      if (!part.startsWith("data: ")) continue;
      try {
        const data = JSON.parse(part.substring(6));
        if (data.type === "metadata") {
          yield { type: "metadata", sources: data.sources || [] };
        } else if (data.type === "token") {
          yield { type: "token", content: data.content };
        }
      } catch (err) {
        console.error("Failed to parse SSE line:", err);
      }
    }
  }
}

export async function clearAll(collectionName: string = "rag_documents"): Promise<{ status: string }> {
  try {
    const res = await fetch(`${API_URL}/clear${collectionName ? `?collection_name=${encodeURIComponent(collectionName)}` : ""}`, {
      method: "POST",
    });
    if (res.ok) return res.json();
  } catch {}

  // Fallback to existing DELETE /collections/{name} endpoint
  return handle(
    await fetch(`${API_URL}/collections/${encodeURIComponent(collectionName)}`, {
      method: "DELETE",
    })
  );
}

export async function deleteDocument(fileName: string, collectionName?: string): Promise<{ status: string }> {
  return handle(
    await fetch(
      `${API_URL}/documents/${encodeURIComponent(fileName)}${collectionName ? `?collection_name=${encodeURIComponent(collectionName)}` : ""}`,
      { method: "DELETE" }
    )
  );
}
