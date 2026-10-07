import type { ConversationMessage, IngestResponse, Source } from "./types";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {}
    throw new Error(typeof detail === "string" ? detail : "Request failed");
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
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("Malformed server response"));
        }
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
  | { type: "token"; content: string }
  | { type: "error"; message: string };

function isSource(value: unknown): value is Source {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Source).source === "string" &&
    typeof (value as Source).text === "string"
  );
}

export async function* queryStream(
  question: string,
  opts: {
    topK?: number;
    collectionName?: string;
    conversationId?: string;
    signal?: AbortSignal;
  } = {}
): AsyncGenerator<QueryStreamEvent> {
  const response = await fetch(`${API_URL}/query/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      top_k: opts.topK ?? 5,
      collection_name: opts.collectionName || null,
      conversation_id: opts.conversationId || null,
    }),
    signal: opts.signal,
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
  try {
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
            const sources = Array.isArray(data.sources)
              ? data.sources.filter(isSource)
              : [];
            yield { type: "metadata", sources };
          } else if (data.type === "token") {
            yield { type: "token", content: String(data.content ?? "") };
          } else if (data.type === "error") {
            yield { type: "error", message: String(data.message ?? "Query failed") };
          }
        } catch (err) {
          console.error("Failed to parse SSE line:", err);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function clearAll(
  collectionName: string = "rag_documents"
): Promise<{ status: string }> {
  const query = collectionName
    ? `?collection_name=${encodeURIComponent(collectionName)}`
    : "";
  return handle(await fetch(`${API_URL}/clear${query}`, { method: "POST" }));
}

export async function deleteCollection(
  collectionName: string
): Promise<{ status: string; collection: string }> {
  return handle(
    await fetch(`${API_URL}/collections/${encodeURIComponent(collectionName)}`, {
      method: "DELETE",
    })
  );
}

export async function deleteDocument(
  fileName: string,
  collectionName?: string
): Promise<{ status: string }> {
  return handle(
    await fetch(
      `${API_URL}/documents/${encodeURIComponent(fileName)}${collectionName ? `?collection_name=${encodeURIComponent(collectionName)}` : ""}`,
      { method: "DELETE" }
    )
  );
}

export async function getConversation(
  conversationId: string
): Promise<{ conversation_id: string; messages: ConversationMessage[] }> {
  return handle(
    await fetch(`${API_URL}/conversations/${encodeURIComponent(conversationId)}`)
  );
}

export async function deleteConversation(
  conversationId: string
): Promise<{ status: string }> {
  return handle(
    await fetch(`${API_URL}/conversations/${encodeURIComponent(conversationId)}`, {
      method: "DELETE",
    })
  );
}
