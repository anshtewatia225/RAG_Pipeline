import os
import shutil
import tempfile
from typing import Optional
from fastapi import FastAPI, File, UploadFile, Form, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from app.rag_pipeline import RAGPipeline
from app.vector_store import VectorStore
from app.config import DEFAULT_COLLECTION

app = FastAPI(
    title="RAG Pipeline API",
    description="PDF/Text ingestion and retrieval-augmented generation pipeline",
    version="1.0.0",
)


class QueryRequest(BaseModel):
    question: str
    top_k: int = 5
    collection_name: Optional[str] = None


@app.get("/health")
def health_check():
    return {"status": "healthy"}


@app.post("/ingest")
async def ingest_files(
    files: list[UploadFile] = File(...),
    chunk_size: int = Form(default=500),
    chunk_overlap: int = Form(default=50),
    collection_name: str = Form(default=DEFAULT_COLLECTION),
):
    allowed_types = {"application/pdf", "text/plain", "text/x-python", "text/markdown"}
    file_paths = []
    file_names = []

    tmp_dir = tempfile.mkdtemp()
    try:
        for file in files:
            if file.content_type not in allowed_types and not file.filename.endswith(
                (".pdf", ".txt", ".md", ".py")
            ):
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported file type: {file.filename}. Allowed: PDF, TXT, MD, PY",
                )

            file_path = os.path.join(tmp_dir, file.filename)
            with open(file_path, "wb") as f:
                content = await file.read()
                f.write(content)

            file_paths.append(file_path)
            file_names.append(file.filename)

        pipeline = RAGPipeline(collection_name=collection_name)
        result = pipeline.ingest_documents(
            file_paths=file_paths,
            file_names=file_names,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            collection_name=collection_name,
        )

        return JSONResponse(content=result)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@app.post("/query")
async def query_documents(request: QueryRequest):
    try:
        pipeline = RAGPipeline(
            collection_name=request.collection_name or DEFAULT_COLLECTION
        )
        result = pipeline.query(
            question=request.question,
            top_k=request.top_k,
            collection_name=request.collection_name,
        )
        return JSONResponse(content=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/collections")
def list_collections():
    store = VectorStore()
    return {"collections": store.list_collections()}


@app.get("/collections/{name}/stats")
def collection_stats(name: str):
    store = VectorStore(collection_name=name)
    return store.get_collection_stats()


@app.delete("/collections/{name}")
def delete_collection(name: str):
    store = VectorStore()
    store.delete_collection(name)
    return {"status": "deleted", "collection": name}


@app.post("/experiment/chunk-sizes")
async def run_chunk_experiment(
    files: list[UploadFile] = File(...),
    collection_prefix: str = Form(default="experiment"),
):
    configs = [
        {"chunk_size": 500, "chunk_overlap": 50},
        {"chunk_size": 1000, "chunk_overlap": 100},
    ]

    results = []

    for config in configs:
        suffix = f"{config['chunk_size']}_{config['chunk_overlap']}"
        collection_name = f"{collection_prefix}_{suffix}"

        tmp_dir = tempfile.mkdtemp()
        file_paths = []
        file_names = []
        try:
            for file in files:
                file_path = os.path.join(tmp_dir, file.filename)
                with open(file_path, "wb") as f:
                    content = await file.read()
                    f.write(content)
                file_paths.append(file_path)
                file_names.append(file.filename)

            pipeline = RAGPipeline(collection_name=collection_name)
            ingest_result = pipeline.ingest_documents(
                file_paths=file_paths,
                file_names=file_names,
                chunk_size=config["chunk_size"],
                chunk_overlap=config["chunk_overlap"],
                collection_name=collection_name,
            )

            results.append(
                {
                    "config": config,
                    "collection": collection_name,
                    "ingestion": ingest_result,
                }
            )
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    return {
        "status": "experiment_complete",
        "configs_tested": configs,
        "results": results,
        "message": "Collections created. Use /query with each collection_name to compare retrieval precision in LangSmith.",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
