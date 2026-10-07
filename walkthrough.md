# RAG Pipeline — Technical Walkthrough

A developer-level walkthrough of how document ingestion and querying work in this
project, and why the code is structured the way it is.

## 1. Overview

1. Upload files through `POST /ingest`.
2. Each file is hashed (SHA-256) and skipped if already ingested; a changed file
   with the same name replaces its old chunks.
3. Documents are loaded and split into overlapping chunks (page/offset kept for citations).
4. Chunks are embedded with Google Gemini (SQLite-cached) and stored in a per-collection FAISS index.
5. `POST /query/stream` loads conversation memory, condenses follow-ups, runs
   hybrid retrieval + reranking, and streams a grounded answer, then persists the turns.

## 2. Technology Choices

| Concern | Choice | Why |
|---|---|---|
| API | FastAPI | Async, typed, SSE support |
| Orchestration | LangChain | Standard loaders/splitters/prompts; LCEL streaming |
| Vector store | LangChain `FAISS` wrapper | Handles persistence, docstore, delete, normalization |
| Embeddings | `gemini-embedding-2-preview` | High quality, free tier |
| Sparse retrieval | `rank-bm25` | Lexical match complementing dense vectors |
| Reranking | Flashrank (local ONNX) | Cross-encoder quality without an API key |
| Memory | SQLAlchemy + SQLite | Durable, migration-ready, no extra service |
| Caching | LangChain `SQLiteCache` + custom embedding cache | Cut latency/cost on repeats |
| LLM | Groq `openai/gpt-oss-120b` | Very fast inference |
| Config | pydantic-settings | Validated, typed env config |

## 3. Project Layout

```
app/
├── config.py        # Settings, factories, LLM-cache setup
├── utils.py         # id validation, collection_dir
├── caching.py       # CachedEmbeddings (SQLite) + retries
├── memory.py        # SQLAlchemy conversation repository
├── vector_store.py  # VectorStore + per-collection cache, manifest
├── retrieval.py     # hybrid BM25+dense, MMR, rerank, threshold
├── rag_pipeline.py  # ingestion + query_stream + memory
├── schemas.py       # request/response models
└── main.py          # FastAPI app
```

## 4. Configuration

`app/config.py` defines a `Settings` class (cached via `lru_cache`) that reads
`.env`/environment. Required: `GOOGLE_API_KEY`, `GROQ_API_KEY`. Validation
happens at startup so misconfiguration fails fast.

Factories:
- `get_embeddings()` → `GoogleGenerativeAIEmbeddings`, wrapped in
  `CachedEmbeddings` (`app/caching.py`) when `EMBEDDING_CACHE` is on
- `get_llm(temperature=0.0)` → `ChatGroq` with `timeout` + `max_retries`
- `get_tracer()` → `LangChainTracer` (or `None` when tracing is disabled)
- `configure_llm_cache()` installs a LangChain `SQLiteCache` for LLM responses

Beyond keys, settings cover: conversation memory (`MAX_HISTORY_CHARS`,
`HISTORY_MAX_TURNS`), retrieval quality (`FETCH_K`, `MIN_SCORE`,
`HYBRID_SEARCH`, `MMR_*`, `RERANK_*`, `MIN_RERANK_SCORE`), and reliability
(`LLM_CACHE`, `EMBEDDING_CACHE`, retries/timeouts).

`get_settings()` also exports LangSmith variables so LangChain auto-traces all
runnable calls.

## 5. Ingestion

`RAGPipeline.ingest_documents(file_paths, file_names, chunk_size, chunk_overlap,
collection_name)`:

1. Read file bytes and compute SHA-256.
2. `VectorStore.find_duplicate_files(hash)` — skip and report if already present.
3. If the same file name exists with a *different* hash, delete its old chunks
   first (`get_file` + `delete_document`) so re-uploads never orphan vectors.
4. Load with `PyPDFLoader` (`.pdf`) or `TextLoader` (everything else).
5. Split with `RecursiveCharacterTextSplitter` (`add_start_index=True`).
6. Build LangChain `Document` objects with metadata
   (`source`, `file_name`, `chunk_index`, `chunk_size`, `chunk_overlap`, plus
   `page` from the PDF loader and `start_index` from the splitter for citations)
   and a unique id per chunk.
7. `VectorStore.add_documents(...)` embeds, indexes, and records the file in
   `manifest.json`.

The endpoint calls this via `asyncio.to_thread` to avoid blocking the event loop.

### Manifest
`faiss_indexes/<collection>/manifest.json`:
```json
{ "doc.pdf": { "sha256": "…", "ids": ["…", "…"] } }
```
It powers de-duplication and lets `delete_document` remove exactly the right
vectors — no re-embedding of the remaining chunks.

## 6. Vector Store

`app/vector_store.py` wraps `langchain_community.vectorstores.FAISS` with
`DistanceStrategy.MAX_INNER_PRODUCT` (cosine similarity on normalized vectors).

- Persistence: `save_local`/`load_local` per collection folder.
- Instances are cached per collection (`get_vector_store`) and guarded by a
  re-entrant lock, so concurrent requests share one loaded index.
- `query()` returns `{documents, metadatas, distances}` (distance = cosine
  similarity, higher is better).
- `similarity_search_with_score()`, `max_marginal_relevance_search()`,
  `all_documents()` (BM25 corpus), `get_file()`, and `revision()` (index size
  used to invalidate the BM25 cache) support the hybrid retriever.
- `delete_document()` / `clear()` / `get_collection_stats()`.
- `list_collections()` / `delete_collection()` are module-level helpers.

## 6b. Conversation Memory

`app/memory.py` defines a SQLAlchemy `ConversationRepository` over SQLite
(`data/conversations.db`). One `messages` table stores `conversation_id`, `role`,
`content`, an optional JSON `meta` (source citations), and a timestamp.

- `append()` stores a turn; `get_history()` returns a chronological window
  bounded by `MAX_HISTORY_CHARS` and `HISTORY_MAX_TURNS`; `list_messages()`
  powers the HTTP endpoint; `delete()` clears a conversation.
- The endpoint calls the repository through `asyncio.to_thread`.
- SQLite is enough for a single instance; the engine/session abstraction lets
  the same code target Postgres later.

## 6c. Retrieval

`app/retrieval.py` (`HybridRetriever`):

1. Dense candidates from FAISS (MMR-diversified when `MMR_ENABLED`).
2. BM25 candidates (`rank-bm25`), rebuilt when the index size changes.
3. Reciprocal rank fusion with `DENSE_WEIGHT`/`BM25_WEIGHT`.
4. Optional Flashrank cross-encoder rerank (`RERANK_MODEL`); if the model or
   package is unavailable it logs a warning and falls back to fused order.
5. Threshold filter (`MIN_RERANK_SCORE` when reranked, else `MIN_SCORE`) and
   truncation to `top_k`.

## 7. Querying

`RAGPipeline.query_stream(question, top_k, collection_name, conversation_id)`:

1. If `conversation_id` is set, load bounded history from the repository.
2. If history exists, condense the follow-up into a standalone question (an LLM
   chain loaded in a worker thread) before retrieval.
3. Retrieve in a worker thread via `HybridRetriever.retrieve(...)`.
4. `_prepare_context` de-duplicates chunks and enforces
   `MAX_CONTEXT_CHARS`, numbering each block `[1]`, `[2]`, … and attaching
   `source`/`page` for citations.
5. Emit `metadata` (sources + `retrieval_latency_ms`).
6. If nothing is retrieved, emit either the "upload a document first" or the
   "no relevant information" message.
7. Otherwise stream tokens from the LCEL chain:
   `ChatPromptTemplate | ChatGroq | StrOutputParser`, with the history injected
   via `MessagesPlaceholder`.
8. Persist the user turn and the streamed assistant answer (with sources) back
   to the conversation store.

The system prompt instructs the model to answer only from context, admit when it
cannot, and cite bracketed block numbers matching the source list in the UI.

## 8. API Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/health` | 503 if storage is not writable |
| POST | `/ingest` | Multipart; validates extension, size, chunk params, collection |
| POST | `/query/stream` | SSE: `metadata` → `token`* → `done`; accepts `conversation_id` |
| GET | `/collections` | |
| GET | `/collections/{name}/stats` | |
| DELETE | `/collections/{name}` | also deletes the matching conversation |
| POST/DELETE | `/clear` | also clears the matching conversation |
| DELETE | `/documents/{file_name}` | |
| GET | `/conversations/{id}` | stored messages with sources |
| DELETE | `/conversations/{id}` | delete a conversation |

## 9. Frontend

- `src/app/page.tsx` — chat sessions + per-chat collection names
  (`chat_<uuid>`); every load starts a fresh conversation (no local restore);
  deleting a conversation deletes its collection and server conversation.
- `src/components/Chat.tsx` — SSE consumption with `AbortController`, stable
  message ids, sanitized Markdown (`rehype-sanitize`), source rendering with
  page numbers, and `conversationId` propagation for memory.
- `src/components/Sidebar.tsx` — drag-and-drop upload, live progress, per-file
  chunk counts, clear/delete.
- `src/lib/api.ts` — typed fetch/XHR + SSE parser, conversation get/delete.

## 10. Security & Limits

- Collection names validated (`[A-Za-z0-9_-]{1,64}`) and path-checked;
  conversation ids validated (`[A-Za-z0-9_-]{1,128}`).
- Uploads: extension allow-list, per-file size cap, temp-dir isolation,
  basename-only filenames.
- Errors are logged server-side and surfaced generically to clients.
- Markdown output sanitized against XSS.
- No auth/rate limiting — conversation ids act as bearer tokens until auth is
  added.

## 11. Persistence & Scaling

FAISS indexes and the conversation SQLite DB live on local disk and assume a
single writer. For horizontal scaling or serverless hosting, move the vector
store to a managed vector database (pgvector, Qdrant, Chroma, Pinecone) and
point the SQLAlchemy repository at Postgres; the rest of the pipeline is
unchanged.
