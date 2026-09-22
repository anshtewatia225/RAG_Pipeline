# RAG Pipeline

PDF/Text ingestion and retrieval-augmented generation pipeline. Upload documents, ask questions, get AI-powered answers grounded in your content.

**Live:** https://rag-pipeline-ovwp.onrender.com

## Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| API | FastAPI | REST endpoints |
| Orchestration | LangChain | Loaders, splitters, chains |
| Vector Store | FAISS | Cosine similarity search |
| Embeddings | Google Gemini (`gemini-embedding-2-preview`) | 3072-dim vectors |
| LLM | Groq (`openai/gpt-oss-120b`) | Answer generation |
| Tracing | LangSmith | Observability |

## Quick Start (Local)

```bash
git clone https://github.com/YOUR_USERNAME/RAG_Pipeline.git
cd RAG_Pipeline
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

Create `.env`:

```
GOOGLE_API_KEY=your-google-api-key
GROQ_API_KEY=your-groq-api-key
LANGSMITH_API_KEY=your-langsmith-api-key
LANGSMITH_PROJECT=rag-pipeline
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://apac.api.smith.langchain.com
```

Run:

```bash
python -m app.main
```

Server: `http://localhost:8000`

## API

Base URL: `https://rag-pipeline-ovwp.onrender.com`

### Health Check

```
GET /health
```

### Ingest Files

```
POST /ingest
Content-Type: multipart/form-data
```

| Field | Type | Required | Default |
|-------|------|----------|---------|
| `files` | File[] | Yes | — |
| `chunk_size` | int | No | 500 |
| `chunk_overlap` | int | No | 50 |
| `collection_name` | string | No | rag_documents |

### Query

```
POST /query
Content-Type: application/json
```

```json
{
  "question": "What is this document about?",
  "top_k": 5,
  "collection_name": "rag_documents"
}
```

### List Collections

```
GET /collections
```

### Collection Stats

```
GET /collections/{name}/stats
```

### Delete Collection

```
DELETE /collections/{name}
```

## Postman

Import `RAG_Pipeline.postman_collection.json` into Postman. All endpoints pre-configured with the live URL.

## Tracing

Every query is traced in LangSmith:

1. Go to https://smith.langchain.com
2. Click **Tracing** → select `rag-pipeline`
3. View retrieval latency, chunks, LLM calls, sources

## Project Structure

```
RAG_Pipeline/
├── app/
│   ├── __init__.py
│   ├── main.py              # FastAPI endpoints
│   ├── config.py             # Settings and clients
│   ├── rag_pipeline.py       # Ingestion and query logic
│   └── vector_store.py       # FAISS wrapper
├── faiss_indexes/            # Vector storage (ephemeral on Render)
├── requirements.txt
├── render.yaml               # Render deployment config
├── .env
├── .gitignore
├── RAG_Pipeline.postman_collection.json
└── README.md
```

## How It Works

```
Upload → Load (PyPDF/Text) → Chunk (500/50) → Embed (Gemini) → Store (FAISS)
                                                                           ↓
Question → Embed (Gemini) → FAISS Search → Top-K Chunks → LLM (Groq) → Answer
```

## Deploy on Render

1. Push to GitHub
2. Render > New > Web Service
3. Connect repo, set start command: `python -m app.main`
4. Add environment variables
5. Deploy

**Note:** FAISS indexes are ephemeral on Render's free tier. Re-ingest after each restart.