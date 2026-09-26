export interface QueryResponse {
  answer: string;
  sources: Source[];
  retrieval_latency_ms: number;
  llm_latency_ms: number;
  total_latency_ms: number;
  chunks_retrieved: number;
  top_k: number;
}

export interface Source {
  chunk_index: number;
  source: string;
  distance: number;
  text: string;
}

export interface IngestResponse {
  status: string;
  files_ingested: string[];
  total_chunks: number;
  chunk_config: { chunk_size: number; chunk_overlap: number };
  collection: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

export interface IngestedFile {
  name: string;
  chunks: number;
  collection: string;
  status: "ingesting" | "done" | "error";
  error?: string;
  progress?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: Message[];
  files: IngestedFile[];
  createdAt: number;
}
