# RAG Pipeline

A full-stack **Retrieval-Augmented Generation (RAG)** application. Upload documents (PDF, TXT, MD, PY), ask natural-language questions, and get grounded, cited answers powered by Gemini embeddings and Groq inference.

---

## Tech Stack

### Backend
| Component | Technology | Purpose |
|---|---|---|
| Framework | FastAPI | REST + SSE streaming API |
| Orchestration | LangChain (LCEL) | Loaders, splitters, prompts, chains |
| Vector Store | LangChain FAISS wrapper | Per-collection cosine similarity search |
| Sparse Retrieval | `rank-bm25` | Lexical candidates fused with dense results |
| Reranking | Flashrank (local ONNX) | Cross-encoder reranking |
| Memory | SQLAlchemy + SQLite | Durable conversation history |
| Caching | LangChain `SQLiteCache` + custom embedding cache | Repeat-query cost/latency savings |
| Embeddings | Google Gemini (`gemini-embedding-2-preview`, 3072-dim) | Document/query embeddings |
| LLM | Groq (`openai/gpt-oss-120b`) | Answer synthesis |
| Config | pydantic-settings | Typed, validated environment config |
| Observability | LangSmith | Trace-level monitoring |

### Frontend
| Component | Technology | Purpose |
|---|---|---|
| Framework | Next.js 16 (App Router) & React 19 | UI |
| Styling | Tailwind CSS v4 | Dark-mode, glassmorphism |
| Markdown | react-markdown + remark-gfm + rehype-sanitize | Sanitized formatted answers |

---

## Features

- Drag-and-drop upload with live progress and automatic ingestion.
- Rich, **sanitized** Markdown answers (tables, code, lists) with numbered source citations.
- **Page-aware citations** for PDFs (`[1] doc.pdf · p.3`).
- **Server-side conversation memory** (SQLite): bounded history plus follow-up question condensation. The UI opens a clean conversation each load; history is retained server-side and available via the conversations API.
- **Hybrid retrieval**: dense FAISS + BM25 fused with reciprocal rank fusion, MMR diversification, and a local Flashrank cross-encoder reranker.
- **Reliability**: LLM response cache, an embedding cache, and automatic retries/timeouts on provider calls.
- Per-response metrics (retrieval latency, chunk counts) and source references.
- Per-conversation vector collections, deleted together with the conversation.
- Granular document deletion (removes only that document's chunks).
- Content-hash de-duplication: re-uploading an identical file is skipped; re-uploading a *changed* file replaces its old chunks (no orphans).
- Context budgeting so top-K chunks never overflow the model window.
- Configurable relevance threshold with a graceful "no relevant information" response.

---

## Quick Start

### Backend
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1   # source venv/bin/activate on Unix
pip install -r requirements.txt
copy .env.example .env        # then fill in your keys
.\venv\Scripts\python -m app.main
```
API at `http://localhost:8000`.

### Frontend
```powershell
cd frontend
npm install
npm run dev
```
UI at `http://localhost:3000`. Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` for non-local backends.

---

## Configuration

All settings live in `app/config.py` and are loaded from environment variables (or `.env`).

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GOOGLE_API_KEY` | Yes | — | Gemini embeddings |
| `GROQ_API_KEY` | Yes | — | Groq LLM |
| `LANGSMITH_API_KEY` | No | — | LangSmith tracing |
| `LANGSMITH_PROJECT` | No | `rag-pipeline` | Trace project name |
| `LANGSMITH_TRACING` | No | `true` | Enable tracing |
| `LANGSMITH_ENDPOINT` | No | — | LangSmith region endpoint |
| `CORS_ORIGINS` | No | `*` | Comma-separated allowed origins |
| `MAX_UPLOAD_MB` | No | `20` | Per-file upload cap |
| `MAX_CONTEXT_CHARS` | No | `12000` | Retrieved-context budget |
| `DEFAULT_TOP_K` | No | `5` | Default retrieval depth |
| `MAX_TOP_K` | No | `20` | Retrieval depth cap |
| `MAX_HISTORY_CHARS` | No | `6000` | Conversation history char budget |
| `HISTORY_MAX_TURNS` | No | `20` | Max stored turns fed to the model |
| `FETCH_K` | No | `20` | Candidate pool size before fusion/rerank |
| `MIN_SCORE` | No | `0.0` | Min dense score (0 disables); see `MIN_RERANK_SCORE` |
| `HYBRID_SEARCH` | No | `true` | Enable BM25 + dense fusion |
| `MMR_ENABLED` | No | `true` | Diversify dense candidates with MMR |
| `MMR_LAMBDA` | No | `0.5` | MMR relevance/diversity trade-off |
| `BM25_WEIGHT` / `DENSE_WEIGHT` | No | `0.4` / `0.6` | Fusion weights |
| `RERANK_ENABLED` | No | `true` | Enable Flashrank cross-encoder reranking |
| `RERANK_MODEL` | No | `ms-marco-MiniLM-L-12-v2` | Flashrank model |
| `MIN_RERANK_SCORE` | No | `0.0` | Min rerank score when reranking |
| `LLM_CACHE` / `EMBEDDING_CACHE` | No | `true` | SQLite response/embedding caches |
| `LLM_TIMEOUT` / `LLM_MAX_RETRIES` | No | `60` / `2` | Groq call timeout and retries |
| `EMBEDDING_MAX_RETRIES` | No | `3` | Embedding call retries |

Constants: `FAISS_INDEX_DIR` (`./faiss_indexes`), `DATA_DIR` (`./data`, memory + caches), embedding model, LLM model.

---

## Project Structure

```
RAG_Pipeline/
├── app/
│   ├── config.py          # pydantic-settings Settings + client factories
│   ├── utils.py           # Collection/conversation id validation, path safety
│   ├── caching.py         # SQLite-backed embeddings cache + retries
│   ├── memory.py          # SQLAlchemy conversation repository (SQLite)
│   ├── vector_store.py    # LangChain FAISS wrapper, per-collection cache
│   ├── retrieval.py       # Hybrid BM25+dense, MMR, Flashrank rerank, threshold
│   ├── rag_pipeline.py    # Ingestion, dedup, memory, retrieval, streaming chain
│   ├── schemas.py         # Pydantic request/response models
│   └── main.py            # FastAPI routes
├── frontend/
│   └── src/
│       ├── app/{layout,page}.tsx
│       ├── components/{Chat,Sidebar,ThemeProvider}.tsx
│       └── lib/{api,types}.ts
├── faiss_indexes/         # Persistent vector storage (gitignored)
├── data/                  # Conversation DB + caches (gitignored)
├── requirements.txt
├── .env.example
└── README.md
```

Each collection is a folder under `faiss_indexes/<collection>/` containing the
FAISS index (`index.faiss` + `index.pkl`) and a `manifest.json` mapping files to
their content hashes and chunk ids (used for de-duplication and deletion).

---

## Architecture

```
Upload (.pdf, .txt, .md, .py)
   │  hash + dedup check (changed file replaces its old chunks)
   ▼
RecursiveCharacterTextSplitter (default 500 / 50)
   ▼
Gemini embeddings (3072-dim, SQLite-cached)
   ▼
LangChain FAISS (cosine, per collection)
   ▲
Query ──► optional condensation (uses history)
   │
   ├─ dense candidates (MMR) ─┐
   └─ BM25 candidates ────────┴─► reciprocal rank fusion ─► Flashrank rerank ─► threshold ─► context budget/dedup
   ▼
ChatPromptTemplate (system + MessagesPlaceholder(history) + human) | Groq | StrOutputParser
   ▼
SSE stream: metadata (sources + latency) → tokens → done   (+ persist turns to SQLite)
```

Retrieval runs in a worker thread (`asyncio.to_thread`) so the event loop is
never blocked; generation streams token-by-token.

---

## API Reference

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Liveness + storage-writable check |
| `POST` | `/ingest` | Multipart upload; fields `files`, `chunk_size`, `chunk_overlap`, `collection_name` |
| `POST` | `/query/stream` | JSON `{question, top_k, collection_name, conversation_id}`; SSE stream |
| `GET` | `/collections` | List collection names |
| `GET` | `/collections/{name}/stats` | `{collection, total_chunks, file_count}` |
| `DELETE` | `/collections/{name}` | Delete a collection (and its conversation) |
| `POST`/`DELETE` | `/clear` | Clear a collection (`?collection_name=`) |
| `DELETE` | `/documents/{file_name}` | Delete one document's chunks (`?collection_name=`) |
| `GET` | `/conversations/{id}` | Stored conversation messages with sources |
| `DELETE` | `/conversations/{id}` | Delete a stored conversation |

### SSE events (`POST /query/stream`)
```text
data: {"type":"metadata","sources":[{...,"page":2}],"retrieval_latency_ms":12.3,"chunks_retrieved":5,"top_k":5}
data: {"type":"token","content":"The document ..."}
data: {"type":"done"}
```

### Ingest response
```json
{
  "status": "success",
  "files_ingested": ["doc.pdf"],
  "files": [{"name": "doc.pdf", "chunks": 42}],
  "total_chunks": 42,
  "deduplicated": [],
  "chunk_config": {"chunk_size": 500, "chunk_overlap": 50},
  "collection": "rag_documents"
}
```

Collection names must match `[A-Za-z0-9_-]{1,64}`; other values return HTTP 400.

---

## Observability

Every loader/splitter/embedding/retrieval/generation step is traced in LangSmith
when `LANGSMITH_API_KEY` is set. Open the project (default `rag-pipeline`) to
inspect latencies, token usage, and retrieved chunks.

---

## Deployment (Render)

1. Build command: `pip install -r requirements.txt`
2. Start command: `python -m app.main`
3. Set the environment variables above.
4. Set `CORS_ORIGINS` to your frontend origin and point the frontend at the
   backend via `NEXT_PUBLIC_API_URL`.

`faiss_indexes/` and `data/` (conversation memory + caches) must be on
persistent storage; FAISS local storage assumes a single writer instance.

---

## Security Notes

- API keys are read from the environment and never committed.
- Collection names and conversation ids are validated and path-checked (no traversal).
- Uploads are extension-checked and size-capped.
- Markdown is rendered through `rehype-sanitize` to prevent XSS.
- The API itself is unauthenticated — conversations are addressed by a
  client-generated UUID, so treat that id like a bearer token. Add auth/rate
  limiting before public use.
