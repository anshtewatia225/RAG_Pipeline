# RAG Pipeline

PDF/Text ingestion and retrieval-augmented generation pipeline using FastAPI, LangChain, FAISS, Groq, and LangSmith.

## Stack

- **FastAPI** - REST API
- **LangChain** - Document loading, text splitting, chaining
- **FAISS** - Vector similarity search (persistent)
- **Google Gemini** - Embeddings (`gemini-embedding-2-preview`)
- **Groq** - LLM inference (`openai/gpt-oss-120b`)
- **LangSmith** - Tracing and observability

## Setup

### 1. Clone and install

```bash
cd RAG_Pipeline
python -m venv venv
venv\Scripts\activate        # Windows
# source venv/bin/activate   # macOS/Linux
pip install -r requirements.txt
```

### 2. Configure environment

Create `.env` in the project root:

```
GOOGLE_API_KEY=your-google-api-key
GROQ_API_KEY=your-groq-api-key
LANGSMITH_API_KEY=your-langsmith-api-key
LANGSMITH_PROJECT=rag-pipeline
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://apac.api.smith.langchain.com
```

### 3. Start the server

```bash
python -m app.main
```

Server runs at `http://localhost:8000`.

## API Endpoints

### POST /ingest

Upload one or more PDF or text files. Chunks them and stores in FAISS.

**Postman setup:**
- Method: `POST`
- URL: `http://localhost:8000/ingest`
- Body > form-data:
  - `files` (File) - select one or more PDF/TXT/MD files
  - `chunk_size` (Text) - default `500`
  - `chunk_overlap` (Text) - default `50`
  - `collection_name` (Text) - default `rag_documents`

**Example response:**
```json
{
  "status": "success",
  "files_ingested": ["document.pdf"],
  "total_chunks": 42,
  "chunk_config": {"chunk_size": 500, "chunk_overlap": 50},
  "collection": "rag_documents"
}
```

### POST /query

Ask a question. Retrieves relevant chunks and generates an answer.

**Postman setup:**
- Method: `POST`
- URL: `http://localhost:8000/query`
- Body > raw > JSON:
```json
{
  "question": "What is the main topic of the document?",
  "top_k": 5,
  "collection_name": "rag_documents"
}
```

**Example response:**
```json
{
  "answer": "The document discusses...",
  "sources": [
    {
      "chunk_index": 1,
      "source": "document.pdf",
      "distance": 0.3421,
      "text": "First few lines of the chunk..."
    }
  ],
  "retrieval_latency_ms": 120.5,
  "llm_latency_ms": 850.3,
  "total_latency_ms": 970.8,
  "chunks_retrieved": 5,
  "top_k": 5
}
```

### GET /collections

List all FAISS collections.

**Postman:** `GET http://localhost:8000/collections`

### GET /collections/{name}/stats

Get chunk count for a collection.

**Postman:** `GET http://localhost:8000/collections/rag_documents/stats`

### DELETE /collections/{name}

Delete a collection.

**Postman:** `DELETE http://localhost:8000/collections/rag_documents`

### POST /experiment/chunk-sizes

Ingest files with two chunk configs (500/50 and 1000/100) for comparison.

**Postman setup:**
- Method: `POST`
- URL: `http://localhost:8000/experiment/chunk-sizes`
- Body > form-data:
  - `files` (File) - select files
  - `collection_prefix` (Text) - optional, default `experiment`

Creates `experiment_500_50` and `experiment_1000_100` collections. Query each to compare precision in LangSmith.

## Chunk Size Experimentation

### Via API

```bash
# Ingest with both configs
POST /experiment/chunk-sizes with your files

# Query small chunks
POST /query {"question": "...", "collection_name": "experiment_500_50"}

# Query large chunks
POST /query {"question": "...", "collection_name": "experiment_1000_100"}
```

### Via script

```bash
python experiments/chunk_size_comparison.py path/to/file.pdf "Your question here"
```

Results are logged to `experiments/results.json` and traced in LangSmith.

## LangSmith Tracing

Every query is automatically traced. View in the LangSmith dashboard:

1. Go to https://smith.langchain.com
2. Click **Tracing** in the left sidebar
3. Select project `rag-pipeline`
4. Each trace shows:
   - Retrieval latency
   - Number of chunks retrieved
   - LLM call details
   - Source documents

## Project Structure

```
RAG_Pipeline/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI endpoints
│   ├── config.py             # Settings and clients
│   ├── rag_pipeline.py       # Ingestion and query logic
│   └── vector_store.py       # FAISS wrapper
├── experiments/
│   └── chunk_size_comparison.py
├── faiss_indexes/            # Persistent vector storage
├── requirements.txt
├── .env                      # API keys (not committed)
├── .gitignore
├── walkthrough.md
├── RAG_Pipeline.postman_collection.json
└── README.md
```
