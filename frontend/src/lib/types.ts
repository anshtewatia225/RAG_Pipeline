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
