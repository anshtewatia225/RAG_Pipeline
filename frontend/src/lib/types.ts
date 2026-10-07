export interface Source {
  chunk_index: number;
  source: string;
  distance: number;
  text: string;
  page?: number | null;
}

export interface IngestFileReport {
  name: string;
  chunks: number;
}

export interface DeduplicatedFile {
  name: string;
  duplicate_of: string;
}

export interface IngestResponse {
  status: string;
  files_ingested: string[];
  files: IngestFileReport[];
  total_chunks: number;
  deduplicated: DeduplicatedFile[];
  chunk_config: { chunk_size: number; chunk_overlap: number };
  collection: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: Source[];
}

export interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
  sources?: Source[] | null;
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
