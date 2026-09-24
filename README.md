# RAG Pipeline

A full-stack, production-ready **Retrieval-Augmented Generation (RAG)** application. Upload documents (PDF, TXT, MD, Python), ask natural language questions, and receive grounded, cited AI answers powered by high-dimensional embeddings and ultra-fast LLM inference.

**Backend Live:** [https://rag-pipeline-ovwp.onrender.com](https://rag-pipeline-ovwp.onrender.com)

---

## Tech Stack

### Backend
| Component | Technology | Purpose |
|---|---|---|
| Framework | FastAPI | Asynchronous REST API endpoints |
| Orchestration | LangChain | Document loading, text splitting, prompt chains |
| Vector Store | FAISS | In-memory & disk-persisted cosine similarity search |
| Embeddings | Google Gemini (`gemini-embedding-2-preview`) | 3072-dimensional document embeddings |
| LLM | Groq (`openai/gpt-oss-120b`) | Sub-second generative response synthesis |
| Observability | LangSmith | Trace-level latency, chunk retrieval, and token monitoring |

### Frontend
| Component | Technology | Purpose |
|---|---|---|
| Framework | Next.js 16 (App Router) & React 19 | Responsive server & client-side UI |
| Styling | Tailwind CSS v4 & Custom Design Tokens | Sleek dark-mode aesthetic with glassmorphism |
| Markdown & Tables | React Markdown, Remark GFM, Rehype Raw | Formatted tables, code blocks, lists, and line breaks |
| Document Management | Secondary Sidebar | Auto-ingestion dropzone, live progress, and file management |

---

## Features

- **Secondary Document Sidebar**: Upload files via drag-and-drop or file picker with instant auto-ingestion (no separate ingest button needed).
- **Rich Markdown Answers**: Formatted tables, syntax-styled blocks, bold text, and numbered citations rendered cleanly.
- **One-Click Answer Copying**: Built-in clipboard copying with instant visual feedback.
- **Live Observability & Metadata**: Per-response latency breakdown (retrieval vs. LLM vs. total), chunk counts, and source references.
- **Session Cleanliness**: Automated index reset on page refresh and a manual **Clear** button to purge vector storage across sessions.
- **Granular Document Control**: Delete individual documents directly from the sidebar, automatically removing their chunks from the FAISS vector index.

---

## Quick Start (Local Setup)

### 1. Clone Repository
```bash
git clone https://github.com/YOUR_USERNAME/RAG_Pipeline.git
cd RAG_Pipeline
```

### 2. Backend Setup
```powershell
# Create and activate virtual environment
python -m venv venv
.\venv\Scripts\Activate.ps1   # On Windows (or source venv/bin/activate on Unix)

# Install dependencies
pip install -r requirements.txt
```

Create a `.env` file in the root directory:
```env
GOOGLE_API_KEY=your-google-api-key
GROQ_API_KEY=your-groq-api-key
LANGSMITH_API_KEY=your-langsmith-api-key
LANGSMITH_PROJECT=rag-pipeline
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://apac.api.smith.langchain.com
```

Run the backend server:
```powershell
.\venv\Scripts\python -m app.main
```
Backend API will be running at `http://localhost:8000`.

### 3. Frontend Setup
In a new terminal window:
```powershell
cd frontend
npm install
npm run dev
```
Frontend will be running at `http://localhost:3000`.

## Project Structure

```
RAG_Pipeline/
├── app/
│   ├── __init__.py
│   ├── config.py              # Environment variables & client setup
│   ├── main.py                # FastAPI routes & request handling
│   ├── rag_pipeline.py        # LangChain text splitting, prompts & chains
│   └── vector_store.py        # FAISS vector store & disk persistence
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── favicon.ico
│   │   │   ├── globals.css    # Dark theme tokens, glassmorphism & prose styling
│   │   │   ├── layout.tsx     # Root layout & theme wrapper
│   │   │   └── page.tsx       # Main page layout (Sidebar + Chat)
│   │   ├── components/
│   │   │   ├── Chat.tsx       # Chat interface, ReactMarkdown & metrics
│   │   │   ├── Nav.tsx        # Top navigation & theme toggle
│   │   │   ├── Sidebar.tsx    # Auto-upload dropzone & document manager
│   │   │   └── ThemeProvider.tsx # Dark/Light theme provider
│   │   └── lib/
│   │       ├── api.ts         # Frontend API client (ingest, query, delete, clear)
│   │       └── types.ts       # TypeScript interfaces for API payloads
│   ├── next.config.ts
│   ├── package.json
│   └── tsconfig.json
├── faiss_indexes/             # Persistent local vector storage
├── requirements.txt           # Python dependencies
├── render.yaml                # Render deployment configuration
├── RAG_Pipeline.postman_collection.json # Postman test collection
├── walkthrough.md             # In-depth technical architecture breakdown
├── .env                       # Environment variables (API keys)
├── .gitignore
└── README.md
```

---

## Architecture Flow

```
Document Upload (.pdf, .txt, .md, .py)
   │
   ▼
Chunking (RecursiveCharacterTextSplitter: 500 chars / 50 overlap)
   │
   ▼
Embedding (Google Gemini: gemini-embedding-2-preview, 3072 dims)
   │
   ▼
Vector Index (FAISS IndexFlatIP + L2 Normalization)
   │
   ├───────────────────────────────┐
   ▼                               ▼
Natural Language Query         Cosine Similarity Search (Top-K Chunks)
   │                               │
   └───────────────┬───────────────┘
                   ▼
Prompt Construction with Context & Instructions
                   │
                   ▼
Inference & Generation (Groq: openai/gpt-oss-120b)
                   │
                   ▼
Clean Markdown Response + Latency Breakdown & Source Citations
```

---

## Observability & Tracing

Every query is automatically traced in LangSmith:
1. Log in to [LangSmith](https://smith.langchain.com).
2. Select the `rag-pipeline` project.
3. Inspect chunk similarity scores, token counts, retrieval latencies, and LLM execution steps in real time.

---

## Deployment (Render)

1. Push your repository to GitHub.
2. In Render, select **New > Web Service** and link your repository.
3. Configure the build and start commands:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python -m app.main`
4. Add your environment variables (`GOOGLE_API_KEY`, `GROQ_API_KEY`, `LANGSMITH_API_KEY`, etc.).
5. Deploy.