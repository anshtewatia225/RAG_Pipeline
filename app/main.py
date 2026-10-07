import asyncio
import json
import logging
import os
import shutil
import tempfile
from typing import Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from app.config import FAISS_INDEX_DIR, configure_llm_cache, get_settings
from app.memory import get_conversation_repository
from app.rag_pipeline import RAGPipeline
from app.schemas import (
    CollectionStats,
    ConversationResponse,
    HealthResponse,
    IngestResponse,
    QueryRequest,
)
from app.utils import validate_collection_name, validate_conversation_id
from app.vector_store import (
    delete_collection,
    get_vector_store,
    list_collections,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("app.main")

settings = get_settings()
configure_llm_cache()

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md", ".py"}

app = FastAPI(
    title="RAG Pipeline API",
    description="PDF/Text ingestion and retrieval-augmented generation pipeline",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


def _resolve_collection(name: Optional[str]) -> str:
    try:
        return validate_collection_name(name or settings.default_collection)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _resolve_conversation(conversation_id: str) -> str:
    try:
        return validate_conversation_id(conversation_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


def _conversation_for_collection(collection: str) -> Optional[str]:
    return collection[len("chat_"):] if collection.startswith("chat_") else None


@app.get("/health", response_model=HealthResponse, tags=["system"])
def health_check():
    try:
        FAISS_INDEX_DIR.mkdir(parents=True, exist_ok=True)
        writable = os.access(FAISS_INDEX_DIR, os.W_OK)
    except OSError:
        writable = False
    if not writable:
        raise HTTPException(status_code=503, detail="Vector storage is not writable")
    return {"status": "healthy"}


@app.post("/query/stream", tags=["query"])
async def stream_query_documents(request: QueryRequest):
    collection = _resolve_collection(request.collection_name)
    try:
        pipeline = RAGPipeline(collection_name=collection)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    async def event_generator():
        try:
            async for event in pipeline.query_stream(
                question=request.question,
                top_k=request.top_k,
                collection_name=collection,
                conversation_id=request.conversation_id,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception:
            logger.exception("Streaming query failed for collection %s", collection)
            yield f"data: {json.dumps({'type': 'error', 'message': 'Query failed'})}\n\n"

        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/ingest", response_model=IngestResponse, tags=["ingest"])
async def ingest_files(
    files: list[UploadFile] = File(...),
    chunk_size: int = Form(default=500),
    chunk_overlap: int = Form(default=50),
    collection_name: str = Form(default=settings.default_collection),
):
    if not files:
        raise HTTPException(status_code=400, detail="No files were uploaded.")
    if chunk_size < 50 or chunk_size > settings.max_chunk_size:
        raise HTTPException(
            status_code=400,
            detail=f"chunk_size must be between 50 and {settings.max_chunk_size}.",
        )
    if chunk_overlap < 0 or chunk_overlap >= chunk_size:
        raise HTTPException(
            status_code=400,
            detail="chunk_overlap must be >= 0 and smaller than chunk_size.",
        )

    collection = _resolve_collection(collection_name)
    max_bytes = settings.max_upload_bytes
    file_paths: list[str] = []
    file_names: list[str] = []
    tmp_dir = tempfile.mkdtemp()

    try:
        for file in files:
            file_name = os.path.basename(file.filename or "")
            ext = os.path.splitext(file_name)[1].lower()
            if not file_name or ext not in ALLOWED_EXTENSIONS:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type: {file_name or 'unknown'}. "
                    "Allowed: PDF, TXT, MD, PY",
                )

            file_path = os.path.join(tmp_dir, file_name)
            size = 0
            with open(file_path, "wb") as handle:
                while chunk := await file.read(1024 * 1024):
                    size += len(chunk)
                    if size > max_bytes:
                        raise HTTPException(
                            status_code=413,
                            detail=f"{file_name} exceeds the {settings.max_upload_mb} MB limit.",
                        )
                    handle.write(chunk)

            file_paths.append(file_path)
            file_names.append(file_name)

        pipeline = RAGPipeline(collection_name=collection)
        result = await asyncio.to_thread(
            pipeline.ingest_documents,
            file_paths,
            file_names,
            chunk_size,
            chunk_overlap,
            collection,
        )
        return IngestResponse(**result)
    except HTTPException:
        raise
    except Exception:
        logger.exception("Ingestion failed for collection %s", collection)
        raise HTTPException(status_code=500, detail="Ingestion failed.")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@app.get("/collections", tags=["collections"])
def get_collections():
    return {"collections": list_collections()}


@app.get(
    "/collections/{name}/stats",
    response_model=CollectionStats,
    tags=["collections"],
)
def collection_stats(name: str):
    collection = _resolve_collection(name)
    try:
        return get_vector_store(collection).get_collection_stats()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.delete("/collections/{name}", tags=["collections"])
def remove_collection(name: str):
    collection = _resolve_collection(name)
    try:
        delete_collection(collection)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    conversation = _conversation_for_collection(collection)
    if conversation:
        get_conversation_repository().delete(conversation)
    return {"status": "deleted", "collection": collection}


@app.post("/clear", tags=["collections"])
@app.delete("/clear", tags=["collections"])
def clear_all(collection_name: Optional[str] = None):
    collection = _resolve_collection(collection_name)
    try:
        get_vector_store(collection).clear()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    conversation = _conversation_for_collection(collection)
    if conversation:
        get_conversation_repository().delete(conversation)
    return {"status": "cleared", "collection": collection}


@app.get(
    "/conversations/{conversation_id}",
    response_model=ConversationResponse,
    tags=["conversations"],
)
def get_conversation(conversation_id: str):
    conversation = _resolve_conversation(conversation_id)
    messages = get_conversation_repository().list_messages(conversation)
    return {"conversation_id": conversation, "messages": messages}


@app.delete("/conversations/{conversation_id}", tags=["conversations"])
def remove_conversation(conversation_id: str):
    conversation = _resolve_conversation(conversation_id)
    deleted = get_conversation_repository().delete(conversation)
    return {"status": "deleted", "conversation_id": conversation, "messages_deleted": deleted}


@app.delete("/documents/{file_name}", tags=["ingest"])
def remove_document(file_name: str, collection_name: Optional[str] = None):
    collection = _resolve_collection(collection_name)
    try:
        result = get_vector_store(collection).delete_document(
            os.path.basename(file_name)
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return {"status": "deleted", "file_name": file_name, **result}


@app.exception_handler(ValidationError)
async def validation_exception_handler(_request, exc: ValidationError):
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
